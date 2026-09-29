import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/shared/api/client.ts";
import { SessionController } from "../src/features/auth/session.ts";
import { conversations, mergeMessages } from "../src/features/inbox/model.ts";
const session = { id: "test-session", csrfToken: "fictional", expiresAt: 1 };

test("network failure preserves unavailable state, only 401 transitions to guest", async () => {
  const api = new ApiClient();
  const auth = new SessionController(api);
  api.request = async () => {
    throw new Error("offline");
  };
  await auth.restore();
  assert.equal(auth.snapshot().status, "unavailable");
  api.request = async () => {
    api.onUnauthorized();
    throw new Error("401");
  };
  await auth.restore();
  assert.equal(auth.snapshot().status, "guest");
});

test("late restore cannot resurrect logged-out session", async () => {
  const api = new ApiClient();
  const auth = new SessionController(api);
  let resolve;
  api.request = (path) =>
    path === "/auth/session"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({});
  const pending = auth.restore();
  await auth.logout();
  resolve(session);
  await pending;
  assert.equal(auth.snapshot().status, "guest");
});

test("successful restore obtains CSRF then resumes foreground session", async () => {
  const api = new ApiClient();
  const auth = new SessionController(api);
  const calls = [];
  api.request = async (path) => {
    calls.push(path);
    return session;
  };
  await auth.restore();
  assert.equal(auth.snapshot().status, "ready");
  assert.deepEqual(calls, ["/auth/session", "/auth/resume"]);
});

test("old request 401 does not invalidate a newer login; requests carry same-origin CSRF", async (t) => {
  const fetchBefore = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchBefore;
  });
  let resolve;
  let options;
  const api = new ApiClient();
  let unauthorized = 0;
  api.onUnauthorized = () => unauthorized++;
  api.setSession("old");
  globalThis.fetch = (_url, init) => {
    options = init;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const pending = api.request("/auth/logout", { method: "POST" });
  assert.equal(options.headers["X-CSRF-Token"], "old");
  assert.equal(options.credentials, "same-origin");
  api.setSession("new");
  resolve(new Response("{}", { status: 401 }));
  await assert.rejects(pending);
  assert.equal(unauthorized, 0);
});

test("inbox groups by device and subscription, deduplicates replay and orders by received time", () => {
  const base = {
    sequence: 1,
    deviceId: "a",
    eventId: "test",
    sender: "Example",
    body: "Fictional",
    subscriptionId: 1,
    receivedAt: 1000,
    syncedAt: 2000,
  };
  const items = [
    base,
    { ...base, sequence: 2, deviceId: "b" },
    { ...base, sequence: 3, subscriptionId: 2 },
    { ...base, sequence: 4, receivedAt: 500 },
  ];
  assert.equal(mergeMessages(items, [base]).length, 4);
  const groups = conversations(items);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.find((g) => g.messages.length === 2).messages.map((m) => m.sequence),
    [4, 1],
  );
});
