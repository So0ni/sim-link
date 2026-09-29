import { ApiClient } from "../../shared/api/client.ts";
export type Session = { id: string; expiresAt: number; csrfToken: string };
export type AuthState =
  | { status: "restoring" | "guest" | "unavailable" }
  | { status: "ready"; session: Session };
export class SessionController {
  private current: AuthState = { status: "restoring" };
  private listeners = new Set<() => void>();
  private epoch = 0;
  readonly api: ApiClient;
  constructor(api: ApiClient) {
    this.api = api;
    api.onUnauthorized = () => this.invalidate();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.current;
  private set(state: AuthState) {
    this.current = state;
    this.listeners.forEach((fn) => fn());
  }
  private invalidate() {
    this.epoch++;
    this.api.clearSession();
    this.set({ status: "guest" });
  }
  async restore() {
    const epoch = ++this.epoch;
    const previous = this.current;
    // Foreground revalidation should keep the inbox mounted, including its cursor and selection.
    if (previous.status !== "ready") this.set({ status: "restoring" });
    try {
      const session = await this.api.request<Session>("/auth/session");
      if (epoch !== this.epoch) return;
      this.api.setSession(session.csrfToken);
      await this.api.request("/auth/resume", { method: "POST" });
      if (epoch === this.epoch) this.set({ status: "ready", session });
    } catch {
      // A 401 has already transitioned to guest. Network failures preserve the server cookie.
      if (epoch === this.epoch) this.set(previous.status === "ready" ? previous : { status: "unavailable" });
    }
  }
  async login(password: string) {
    const epoch = ++this.epoch;
    const result = await this.api.request<{ csrfToken: string }>(
      "/auth/login",
      { method: "POST", body: { password }, authenticated: false },
    );
    if (epoch !== this.epoch) return;
    this.api.setSession(result.csrfToken);
    await this.restore();
  }
  async logout() {
    await this.api.request("/auth/logout", { method: "POST" });
    this.invalidate();
  }
}
