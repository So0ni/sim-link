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


test("QR contains only versioned temporary pairing fields", async () => {
  const { pairingPayload } = await import("../src/features/devices/pairing.ts");
  const data = JSON.parse(pairingPayload({ server: "https://sim.example.com", pairingToken: "a".repeat(43), expiresAt: 2000, apiVersion: 1, deviceToken: "must-not-appear" }));
  assert.deepEqual(data, { type: "simlink.pairing", version: 1, server: "https://sim.example.com", pairingToken: "a".repeat(43), expiresAt: 2000, apiVersion: 1 });
});

test("foreground revalidation keeps inbox mounted on transient failure but exits on 401", async () => {
  const api = new ApiClient(); const auth = new SessionController(api);
  api.request = async path => path === '/auth/session' ? session : {};
  await auth.restore();
  const states = []; auth.subscribe(() => states.push(auth.snapshot().status));
  api.request = async () => { throw new Error('offline'); };
  await auth.restore();
  assert.equal(auth.snapshot().status,'ready'); assert.ok(!states.includes('restoring'));
  api.request = async () => { api.onUnauthorized(); throw new Error('401'); };
  await auth.restore(); assert.equal(auth.snapshot().status,'guest');
});
const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeClock() {
  let id = 0; const pending = new Map();
  return {
    pending,
    schedule: (fn, delay) => { pending.set(++id,{fn,delay}); return id; },
    cancel: handle => pending.delete(handle),
    fire: () => { const [handle, value] = pending.entries().next().value; pending.delete(handle); value.fn(); },
  };
}
test("poller is serial, sleeps while hidden and wakes on foreground", async () => {
  const { ForegroundPoller } = await import('../src/shared/api/polling.ts');
  const clock = fakeClock(); let visible = true, calls = 0, resolve;
  const poller = new ForegroundPoller(() => { calls++; return new Promise(r => resolve = r); }, () => visible, clock.schedule, clock.cancel);
  poller.start(); poller.wake(); poller.wake(); assert.equal(calls,1);
  resolve(true); await settle(); assert.equal([...clock.pending.values()][0].delay,5000);
  visible = false; poller.wake(); assert.equal(clock.pending.size,0);
  visible = true; poller.wake(); assert.equal(calls,2);
  poller.stop(); resolve(true); await settle(); assert.equal(clock.pending.size,0);
});
test("poller backs off failures, resets on success and safely restarts pending work", async () => {
  const { ForegroundPoller } = await import('../src/shared/api/polling.ts');
  const clock = fakeClock(); let success = false;
  const poller = new ForegroundPoller(async () => success, () => true, clock.schedule, clock.cancel);
  poller.start(); await settle();
  for (const delay of [10000,20000,40000,60000,60000]) {
    assert.equal([...clock.pending.values()][0].delay,delay); clock.fire(); await settle();
  }
  success = true; clock.fire(); await settle(); assert.equal([...clock.pending.values()][0].delay,5000);
  poller.stop(); assert.equal(clock.pending.size,0);
  poller.start(); await settle(); assert.equal([...clock.pending.values()][0].delay,5000); poller.stop();
  let release; let calls = 0;
  const restarted = new ForegroundPoller(() => { calls++; return new Promise(r => release = r); }, () => true,clock.schedule,clock.cancel);
  restarted.start(); restarted.stop(); restarted.start();
  release(true); await settle(); assert.equal(calls,2);
  restarted.stop(); release(true); await settle(); assert.equal(clock.pending.size,0);
});

import { simKey, simLabel } from '../src/features/inbox/model.ts';
import { mappingKey, simTitle } from '../src/features/sims/api.ts';
test('SIM phone labels change independently of immutable conversation and historical identity', () => {
  const sim = { id: 'id', deviceId: 'device', simKey: 'mapping-a', subscriptionId: 1, slotIndex: 0, carrier: 'Test', name: 'Backup', phoneNumber: '+12025550100', state: 'active', reportedAt: 1 };
  const message = { sequence: 1, deviceId: 'device', simKey: 'mapping-a', subscriptionId: 1, sender: 'Example', body: 'Test', receivedAt: 1, syncedAt: 1, eventId: 'e' };
  assert.equal(simKey(message), mappingKey(sim));
  assert.equal(simLabel(message, [sim]), 'Backup · +12025550100');
  assert.equal(simTitle({ ...sim, name: '' }), '+12025550100');
  const replaced = { ...message, sequence: 2, simKey: 'mapping-b' };
  assert.equal(conversations([message, replaced]).length, 2);
  assert.notEqual(simKey({ ...message, simKey: null }), simKey(message));
  assert.notEqual(simLabel({ ...message, simKey: null }, [sim]), simTitle(sim));
});

import { simTabs } from '../src/features/inbox/model.ts';
test('duplicate phone labels stay distinguishable without merging devices', () => {
  const sim = { id: 'a', deviceId: 'device-a', simKey: 'mapping-a', subscriptionId: 1, slotIndex: 0, carrier: 'Test', name: '', phoneNumber: '+12025550100', state: 'active', reportedAt: 1 };
  const tabs = simTabs([], [sim, { ...sim, id: 'b', deviceId: 'device-b' }]);
  assert.equal(tabs.length, 2);
  assert.notEqual(tabs[0][0], tabs[1][0]);
  assert.notEqual(tabs[0][1], tabs[1][1]);
});
