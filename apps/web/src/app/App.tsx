import { PushSettings } from '../features/push/PushSettings.tsx';
import { PageBrand } from "../shared/ui/PageBrand.tsx";
import { VIEW_CACHE_KEY } from "../shared/api/viewCache.ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { EnvelopeSimple, HardDrives, GearSix } from "@phosphor-icons/react";
import { ApiClient, errorText } from "../shared/api/client.ts";
import { SessionController } from "../features/auth/session.ts";
import { PwaSettings } from "../pwa/PwaControls.tsx";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { InboxPage } from "../features/inbox/InboxPage.tsx";
import { DevicesPage } from "../features/devices/DevicesPage.tsx";
import { SendPage } from '../features/send/SendPage.tsx';
function useRoute() {
  const [path, setPath] = useState(location.hash.slice(1) || "/inbox");
  useEffect(() => {
    const changed = () => setPath(location.hash.slice(1) || "/inbox");
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return [
    path,
    (next: string) => {
      location.hash = next;
    },
  ] as const;
}
export function App() {
  const [auth] = useState(() => new SessionController(new ApiClient()));
  const state = useSyncExternalStore(auth.subscribe, auth.snapshot);
  const [path, go] = useRoute();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void auth.restore();
    const cleared=(event:StorageEvent)=>{if(event.key===VIEW_CACHE_KEY && event.newValue===null)auth.invalidate();};
    window.addEventListener("storage",cleared);
    const visible = () => {
      if (
        document.visibilityState === "visible" &&
        auth.snapshot().status !== "guest"
      )
        void auth.restore();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      window.removeEventListener("storage",cleared);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [auth]);
  if (state.status === "guest") return <LoginPage auth={auth} />;
  if (state.status !== "ready")
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="wordmark">SIMLink</div>
          {state.status === "unavailable" && <><h1>暂时无法连接服务器</h1><p role="status">登录凭证已保留。连接恢复后即可继续。</p></>}
          {state.status === "restoring" && <div className="startup-placeholder" aria-label="正在打开 SIMLink" role="status" /> }
          {state.status === "unavailable" && (
            <button className="primary" onClick={() => void auth.restore()}>
              重试连接
            </button>
          )}
        </div>
      </main>
    );
  const page = path.startsWith("/send") ? "send" : path.startsWith("/devices")
    ? "devices"
    : path.startsWith("/settings")
      ? "settings"
      : "inbox";
  let selected: string | null = null;
  if (path.startsWith("/inbox/")) {
    try {
      selected = decodeURIComponent(path.slice("/inbox/".length));
    } catch {
      /* Invalid deep link renders the list. */
    }
  }
  const links = [
    ["inbox", "短信", EnvelopeSimple],
    ["devices", "设备", HardDrives],
    ["settings", "设置", GearSix],
  ] as const;
  const nav = links.map(([id, label, Icon]) => (
    <a
      key={id}
      className={page === id ? "active" : ""}
      href={`#/${id}`}
      aria-current={page === id ? "page" : undefined}
    >
      <Icon size={24} />
      <span>{label}</span>
    </a>
  ));
  return (
    <div className="app-shell" key={state.session.id}>
      <aside className="sidebar">
        <a href="#/inbox" className="wordmark">
          SIMLink
        </a>
        <nav aria-label="主导航">{nav}</nav>
        <div className="sidebar-bottom">
          <span className="host">{location.host}</span>
        </div>
      </aside>
      <SendPage api={auth.api} path={path} visible={page === "send"} />
      {page === "inbox" && (
        <InboxPage api={auth.api} selected={selected} go={go} />
      )}
      {page === "devices" && <DevicesPage api={auth.api} />}
      {page === "settings" && (
        <main className="main live-page">
          <PageBrand /><div className="title-row"><h1>设置</h1></div>
          <PushSettings api={auth.api} />
          <PwaSettings />
          <section className="live-card">
            <h2>登录与数据</h2>
            <p>此设备默认保持登录，可主动退出。</p>
            <p className="field-help">
              近期短信、设备和发件记录会缓存在此浏览器，退出登录后清除。远程发送需在手机主动启用。
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await auth.logout();
                  go("/inbox");
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              退出登录
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </main>
      )}
      <nav className="bottom-nav" aria-label="移动导航" onContextMenu={event => event.preventDefault()}>
        {nav}
      </nav>
    </div>
  );
}
