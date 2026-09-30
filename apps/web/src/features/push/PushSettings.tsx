import { pwa } from '../../pwa/controller.ts';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiClient, errorText } from '../../shared/api/client.ts';
import { RefreshButton } from '../../shared/ui/RefreshButton.tsx';
type Delivery = { id: string; createdAt: number; acceptedAt: number | null; workerReceivedAt: number | null; notificationShownAt: number | null; state: string; attempts: number; attemptedAt: number | null; result: string | null };
type Status = { publicKey: string; subscriptions: { id: string; previewLength?: number; lastDelivery: Delivery | null; deliveries?: Delivery[] }[] };
export function PushSettings({api}:{api:ApiClient}) {
  const pwaState = useSyncExternalStore(pwa.subscribe,pwa.snapshot);
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [config,setConfig] = useState<Status|null>(null);
  const [binding,setBinding] = useState<string|null>(null);
  const [registration,setRegistration] = useState<ServiceWorkerRegistration|null>(null);
  const [permission,setPermission] = useState<NotificationPermission>(supported?Notification.permission:'default');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const refresh = useCallback(async()=>{
    const status = await api.request<Status>('/push');
    const reg = supported ? await navigator.serviceWorker.getRegistration('/') : undefined;
    const sub = await reg?.pushManager.getSubscription();
    const found = sub ? await api.request<{id:string|null}>('/push/lookup',{method:'POST',body:{endpoint:sub.endpoint}}) : {id:null};
    setConfig(status);setBinding(found.id);setRegistration(reg??null);
    if(supported)setPermission(Notification.permission);
  },[api,supported]);
  useEffect(()=>{
    const update=()=>{if(document.visibilityState==='visible')void refresh().catch(e=>setError(errorText(e)));};
    update();const timer=setInterval(update,5000);window.addEventListener('focus',update);
    return()=>{clearInterval(timer);window.removeEventListener('focus',update);};
  },[refresh]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();await refresh();}catch(e){setError(e instanceof Error&&!(e.name==='Error')&&!(e.name==='ApiError')?e.message:errorText(e));}finally{setBusy(false);}};
  const enable=()=>void run(async()=>{
    // Request permission directly in the user's click, before any network await.
    const allowed=await Notification.requestPermission();setPermission(allowed);
    if(allowed!=='granted')return;
    if(!registration||!config)return;
    let sub=await registration.pushManager.getSubscription();
    const publicKey=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    if(sub){
      const old=new Uint8Array(sub.options.applicationServerKey??new ArrayBuffer(0));
      if(old.length!==publicKey.length||old.some((n,i)=>n!==publicKey[i])){await sub.unsubscribe();sub=null;}
    }
    sub??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
    const json=sub.toJSON();
    await api.request('/push/subscriptions',{method:'POST',body:{endpoint:json.endpoint,keys:json.keys}});
    setNotice('新短信通知已开启。');
  });
  const delivery=config?.subscriptions.find(s=>s.id===binding)?.lastDelivery;
  const labels:Record<string,string>={pending:'等待投递，失败时自动重试',accepted:'推送服务已接收',failed:'投递失败，可发送测试通知重试',expired:'已过期，未继续投递'};
  return <section className="live-card push-settings">
    <div className="live-section-heading"><h2>此设备通知</h2><RefreshButton label="刷新通知状态" onRefresh={refresh}/></div>
    <p>{binding&&permission==='granted'?'已开启新短信提醒':!config?'新短信通知':'新短信提醒未开启'}</p>
    <p className="field-help">通知标题显示发件人，正文预览默认关闭。关闭通知仍可正常查看短信。</p>
    {!supported&&<p>当前浏览器不支持推送。iPhone 请在 Safari 将本站添加到主屏幕，再从主屏幕打开。</p>}
    {permission==='denied'&&<p>通知权限已被关闭，请在系统或浏览器设置中允许通知，再回到此页面。</p>}
    {pwaState.update&&<p>请先在下方完成应用更新，再开启通知。</p>}
    {supported&&!registration&&config&&<p>应用尚未准备好，请完成应用更新或刷新页面后重试。</p>}
    <div className="push-actions" aria-busy={busy}>
      {supported&&permission!=='denied'&&(!binding||permission!=='granted')&&<button className="primary" disabled={busy||!registration||!config||pwaState.update} onClick={enable}>开启通知</button>}
      {binding&&<>
        {permission==='granted'&&<button className="secondary" disabled={busy} onClick={()=>void run(async()=>{await api.request(`/push/subscriptions/${binding}/test`,{method:'POST'});setNotice('测试通知已加入队列，请查看系统通知。');})}>发送测试通知</button>}
        <button className="secondary" disabled={busy} onClick={()=>void run(async()=>{
          await api.request(`/push/subscriptions/${binding}`,{method:'DELETE'});setBinding(null);
          setNotice('通知已关闭。');
        })}>关闭通知</button>
      </>}
    </div>
    {binding&&<label className="push-preview">短信正文预览
      <select aria-label="短信正文预览" disabled={busy||pwaState.update||config?.subscriptions.find(s=>s.id===binding)?.previewLength===undefined}
        value={config?.subscriptions.find(s=>s.id===binding)?.previewLength??0}
        onChange={event=>{const previewLength=Number(event.target.value);void run(async()=>{
          await api.request(`/push/subscriptions/${binding}`,{method:'PATCH',body:{previewLength}});
          setNotice(previewLength?`正文预览已设为前 ${previewLength} 个字符。`:'正文预览已关闭。');
        });}}>
        <option value={0}>不显示正文</option><option value={50}>前 50 个字符</option>
        <option value={100}>前 100 个字符</option><option value={200}>前 200 个字符</option>
      </select>
      <span className="field-help">仅用于此设备的新通知，预览可能显示在锁屏上。</span>
    </label>}
    {delivery&&<p className="field-help">最近投递：{labels[delivery.state]??delivery.state}{delivery.attemptedAt?` · ${new Date(delivery.attemptedAt).toLocaleString()}`:''}。推送服务接收不代表此设备已显示。</p>}
    {config?.subscriptions.find(s=>s.id===binding)?.deliveries?.length ? <details>
      <summary>最近通知的投递记录</summary>
      <p className="field-help">服务端受理与设备回报使用各自时钟。显示调用完成不代表用户看到；没有回报也可能是设备断网。</p>
      <ol>{config.subscriptions.find(s=>s.id===binding)!.deliveries!.map(item=><li key={item.id}>
        <p>{new Date(item.createdAt).toLocaleString()} · {labels[item.state]??item.state} · 尝试 {item.attempts} 次</p>
        <p className="field-help">推送受理：{item.acceptedAt?new Date(item.acceptedAt).toLocaleTimeString():'尚无确认'}；设备收到：{item.workerReceivedAt?new Date(item.workerReceivedAt).toLocaleTimeString():'尚无回报'}；显示调用完成：{item.notificationShownAt?new Date(item.notificationShownAt).toLocaleTimeString():'尚无回报'}</p>
      </li>)}</ol>
    </details>:null}
    <p className="field-help">支持的主屏幕 PWA 会显示全部未读短信数角标；可在系统通知设置里关闭角标。</p>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="live-error">{error}</p>}
  </section>;
}
