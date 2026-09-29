/** Serial foreground polling; each interval starts after the previous request settles. */
export class ForegroundPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;
  private failures = 0;
  private epoch = 0;
  private readonly request: () => Promise<boolean>;
  private readonly available: () => boolean;
  private readonly schedule: typeof setTimeout;
  private readonly cancel: typeof clearTimeout;
  constructor(
    request: () => Promise<boolean>,
    available: () => boolean,
    schedule: typeof setTimeout = (handler, timeout, ...args) => setTimeout(handler, timeout, ...args),
    cancel: typeof clearTimeout = handle => clearTimeout(handle),
  ) {
    this.request = request; this.available = available;
    this.schedule = schedule; this.cancel = cancel;
  }
  start() { this.stopped = false; this.wake(); }
  stop() { this.stopped = true; this.epoch++; this.clear(); }
  private clear() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  wake = () => {
    this.clear();
    if (!this.stopped && this.available() && !this.running) void this.run();
  };
  private async run() {
    this.running = true;
    const epoch = this.epoch;
    let ok = false;
    try { ok = await this.request(); } catch { /* The caller reports errors. */ }
    finally {
      this.running = false;
      if (epoch !== this.epoch) {
        // React StrictMode may stop/start while an aborted request is settling.
        if (!this.stopped) this.wake();
        return;
      }
      this.failures = ok ? 0 : this.failures + 1;
      if (!this.stopped && this.available()) {
        const delay = ok ? 5000 : Math.min(60000, 5000 * 2 ** Math.min(this.failures, 4));
        this.timer = this.schedule(this.wake, delay);
      }
    }
  }
}
