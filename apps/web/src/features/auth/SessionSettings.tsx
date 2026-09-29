import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, errorText } from '../../shared/api/client.ts';
import { RefreshButton } from '../../shared/ui/RefreshButton.tsx';

type LoginSession = { id: string; name: string; current: boolean; createdAt: number | null; lastActiveAt: number | null };
const date = (value: number | null) => value === null ? '未记录' : new Date(value).toLocaleString();

export function SessionSettings({ api }: { api: ApiClient }) {
  const [items, setItems] = useState<LoginSession[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState<LoginSession | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++epoch.current;
    try {
      const result = await api.request<{ sessions: LoginSession[] }>('/auth/sessions');
      if (version === epoch.current) { setItems(result.sessions); setError(''); }
    } catch (e) {
      if (version === epoch.current) setError(errorText(e));
    }
  }, [api]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible' && !running.current) void refresh(); };
    update();
    const timer = setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { ++epoch.current; clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);
  useEffect(() => { if (target) dialog.current?.showModal(); }, [target]);
  async function revoke() {
    if (!target || running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice(''); ++epoch.current;
    try {
      await api.request(`/auth/sessions/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      setItems(previous => previous?.filter(item => item.id !== target.id) ?? null);
      setNotice('已注销该登录会话。');
      dialog.current?.close(); setTarget(null);
    } catch (e) {
      // A timed-out deletion may have succeeded. Reconcile before allowing a retry.
      await refresh();
      setError(`${errorText(e)} 注销结果未确认，请核对列表后重试。`);
      dialog.current?.close(); setTarget(null);
    } finally { running.current = false; setBusy(false); }
  }
  return <section className="live-card session-settings">
    <div className="live-section-heading"><h2>已登录设备</h2><RefreshButton label="刷新登录设备" onRefresh={async () => { if (!running.current) await refresh(); }} /></div>
    <p className="field-help">按浏览器登录会话列出，同一设备可能有多个会话。最近访问指打开或返回应用，不包含后台检查。</p>
    {items === null && !error && <div className="session-placeholder" aria-label="正在加载登录设备" role="status" />}
    {items && <ul className="session-list">{items.map(item => <li key={item.id}>
      <div className="session-heading"><strong>{item.name}</strong>{item.current ? <span className="session-current">当前设备</span> :
        <button className="secondary" disabled={busy} onClick={() => { setTarget(item); setError(''); }}>注销</button>}</div>
      <dl><div><dt>初次登录</dt><dd>{date(item.createdAt)}</dd></div><div><dt>最近访问</dt><dd>{date(item.lastActiveAt)}</dd></div></dl>
    </li>)}</ul>}
    {items && !items.some(item => !item.current) && <p className="field-help">没有其他登录会话</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="live-error">{error}</p>}
    <dialog ref={dialog} className="session-dialog" aria-labelledby="session-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setTarget(null)}>
      <h2 id="session-dialog-title">注销此登录设备？</h2>
      <p><strong>{target?.name}</strong></p>
      <p>此会话及共享登录状态的窗口需要重新登录，关联通知会停止。短信和 Android 配对不受影响。</p>
      <div className="session-dialog-actions"><button className="secondary" disabled={busy} onClick={() => { dialog.current?.close(); setTarget(null); }}>取消</button>
        <button className="primary" disabled={busy} onClick={() => void revoke()}>{busy ? '正在注销…' : '确认注销'}</button></div>
    </dialog>
  </section>;
}
