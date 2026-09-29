import { useState, useSyncExternalStore } from "react";
import { pwa } from "./controller.ts";
export function PwaUpdateNotice() {
  const state = useSyncExternalStore(pwa.subscribe, pwa.snapshot);
  const [deferred, setDeferred] = useState(false);
  if (!state.update || deferred) return null;
  return <aside className="pwa-update" aria-label="应用更新" role="status">
    <strong>新版本已准备好</strong>
    <p>更新将刷新已打开的 SIMLink 页面，未提交草稿会丢失。请先处理尚未确认的发送请求。</p>
    <div><button className="primary" onClick={() => pwa.activate()}>更新并刷新</button>
      <button onClick={() => setDeferred(true)}>稍后</button></div>
  </aside>;
}
export function PwaSettings() {
  const state = useSyncExternalStore(pwa.subscribe, pwa.snapshot);
  return <section className="live-card">
    <h2>安装与更新</h2>
    <p>{state.installed ? "正在独立应用窗口中使用。" : "将 SIMLink 添加到主屏幕，便于日常打开。"}</p>
    {!state.installed && <>
      {state.installable && <button className="primary" onClick={() => void pwa.install()}>安装 SIMLink</button>}
      <p>iPhone：在 Safari 打开本站，点“分享”→“添加到主屏幕”，若有“作为网页 App 打开”选项请启用。</p>
      <p className="field-help">其他浏览器可使用菜单中的“安装应用”或“添加到主屏幕”。安装入口由浏览器提供；主屏幕应用首次打开时可能需要重新登录。</p>
    </>}
    <p>{state.ready ? "离线界面已准备好。" : "离线界面尚未准备好。"} 只保存应用界面，不保存短信或登录接口响应；离线重新打开时需恢复联网才能确认登录并读取短信。</p>
    <button className="secondary" disabled={state.checking} onClick={() => void pwa.check()}>{state.checking ? "正在检查…" : "检查更新"}</button>
    {state.update && <button className="primary" onClick={() => pwa.activate()}>更新并刷新</button>}
    {state.error && <p role="alert" className="live-error">{state.error}</p>}
  </section>;
}
