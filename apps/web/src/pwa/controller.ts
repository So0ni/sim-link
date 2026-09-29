type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type PwaState = { ready: boolean; update: boolean; installable: boolean; installed: boolean; error: string; checking: boolean };
let state: PwaState = { ready: false, update: false, installable: false, installed: false, error: "", checking: false };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let prompt: InstallPrompt | undefined;
let started = false;
const publish = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};
export const pwa = {
  snapshot: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async check() {
    if (!registration) { publish({ error: "离线界面尚未准备好，请联网后刷新页面重试。" }); return; }
    publish({ checking: true, error: "" });
    try { await registration.update(); }
    catch { publish({ error: "暂时无法检查更新，现有页面仍可使用。" }); }
    finally { publish({ checking: false }); }
  },
  activate() { registration?.waiting?.postMessage({ type: "ACTIVATE_UPDATE" }); },
  async install() {
    if (!prompt) return;
    const current = prompt;
    prompt = undefined;
    publish({ installable: false });
    try { await current.prompt(); await current.userChoice; }
    catch { publish({ error: "请使用浏览器菜单安装或添加到主屏幕。" }); }
  },
};
export function startPwa() {
  if (started) return;
  started = true;
  const standalone = matchMedia("(display-mode: standalone)");
  const installed = () => publish({ installed: standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone) });
  installed();
  standalone.addEventListener("change", installed);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    publish({ installable: true });
  });
  window.addEventListener("appinstalled", () => { prompt = undefined; publish({ installed: true, installable: false }); });
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    publish({ error: "当前浏览器无法准备离线界面，请通过 HTTPS 使用支持的浏览器。" });
    return;
  }
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled && !reloading) { reloading = true; location.reload(); }
    controlled = true;
  });
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(reg => {
    registration = reg;
    const inspect = () => publish({ update: Boolean(reg.waiting && navigator.serviceWorker.controller) });
    inspect();
    const watch = () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated") inspect();
        if (worker.state === "redundant") publish({ error: "离线界面准备失败，请联网后检查更新。" });
      });
    };
    reg.addEventListener("updatefound", watch);
    watch();
    void navigator.serviceWorker.ready.then(() => publish({ ready: true }));
    let lastCheck = Date.now();
    const wake = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      void pwa.check();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }).catch(() => publish({ error: "离线界面准备失败，请联网后刷新页面重试。" }));
}
