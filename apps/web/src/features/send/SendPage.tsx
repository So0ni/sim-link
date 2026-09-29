import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, ApiError, errorText } from '../../shared/api/client.ts';
import { ForegroundPoller } from '../../shared/api/polling.ts';
import { listSims, simTitle, type Sim } from '../sims/api.ts';
import { listDevices, type Device } from '../devices/api.ts';
import { recipientNumber, reconcileSubmission, stateLabel, reasonLabel, type Command, type SendRequest } from './model.ts';

function CommandCard({command:c,api,refresh}:{command:Command;api:ApiClient;refresh:()=>void}) {
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <article className="live-card command-card">
    <strong>{c.recipient}</strong><p className="command-body">{c.body}</p>
    <p role="status">{stateLabel[c.state] ?? c.state}</p>
    {c.reason && <p>{reasonLabel[c.reason] ?? '请检查手机状态'}</p>}
    <p className="field-help">提交：{new Date(c.createdAt).toLocaleString()} · 有效至 {new Date(c.expiresAt).toLocaleTimeString()}</p>
    {c.claimedAt && <p className="field-help">手机领取：{new Date(c.claimedAt).toLocaleString()}</p>}
    {c.parts.length>0 && <details><summary>分段结果（{c.parts.length} 段）</summary><ol>{c.parts.map((result,i)=><li key={i}>{result===null?'尚未确认':result===-1?'系统已发送':`系统失败（代码 ${result}）`}</li>)}</ol></details>}
    {['unknown','partial'].includes(c.state) && <p className="field-help">请先向收件人核对，系统不会自动重发。</p>}
    {c.state==='pending' && <button className="secondary command-cancel" disabled={busy} onClick={async()=>{
      setBusy(true);setError('');try{await api.request(`/commands/${c.id}/cancel`,{method:'POST'});refresh();}
      catch(e){setError(e instanceof ApiError && e.status===409?'手机已领取或任务已结束，无法取消。请刷新状态。':errorText(e));refresh();}finally{setBusy(false);}
    }}>取消待发任务</button>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>;
}
export function CommandHistory({api,commands,refresh,sims}:{api:ApiClient;commands:Command[];refresh:()=>void;sims:Sim[]}) {
  return <section className="send-history" aria-label="发件记录"><div className="send-history-heading"><h2>发件记录</h2><button className="secondary" onClick={refresh}>刷新发件状态</button></div>{commands.length===0 && <p className="field-help">暂无发件记录</p>}{commands.map(c=><div key={c.id}><p className="field-help">发送 SIM：{sims.find(s=>s.id===c.simId) ? simTitle(sims.find(s=>s.id===c.simId)!) : '原 SIM（已不可用）'}</p><CommandCard command={c} api={api} refresh={refresh}/></div>)}</section>;
}
export function SendPage({api,path,visible}:{api:ApiClient;path:string;visible:boolean}) {
  const [sims,setSims]=useState<Sim[]>([]);const [devices,setDevices]=useState<Device[]>([]);const [commands,setCommands]=useState<Command[]>([]);
  const [simId,setSim]=useState('');const [recipient,setRecipient]=useState('');const [body,setBody]=useState('');const [waitOffline,setWait]=useState(false);
  const [error,setError]=useState('');const [loadError,setLoadError]=useState('');const [busy,setBusy]=useState(false);const [attempt,setAttempt]=useState<SendRequest|null>(null);
  const drafts=useRef(new Map<string,string>());const context=useRef('new');const lastRoute=useRef('');const routeDrafts=useRef(new Map<string,{simId:string;recipient:string;body:string;waitOffline:boolean}>());const inFlight=useRef(false);
  const loading=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    if(loading.current)return true;const controller=new AbortController();loading.current=controller;
    try{const [ss,dd,cc]=await Promise.all([listSims(api,controller.signal),listDevices(api,controller.signal),api.request<{commands:Command[]}>('/commands',{signal:controller.signal})]);if(controller.signal.aborted)return false;setSims(ss.sims);setDevices(dd.devices);setCommands(cc.commands);setLoadError('');return true;}
    catch(e){if(!controller.signal.aborted)setLoadError(errorText(e));return false;}finally{if(loading.current===controller)loading.current=null;}
  },[api]);
  useEffect(()=>{if(!visible)return;const poller=new ForegroundPoller(refresh,()=>document.visibilityState==='visible'&&navigator.onLine);poller.start();document.addEventListener('visibilitychange',poller.wake);window.addEventListener('online',poller.wake);return()=>{poller.stop();loading.current?.abort();loading.current=null;document.removeEventListener('visibilitychange',poller.wake);window.removeEventListener('online',poller.wake);};},[visible,refresh]);
  useEffect(()=>{
    if(!visible || attempt)return;
    if(lastRoute.current===path)return;
    if(lastRoute.current)routeDrafts.current.set(lastRoute.current,{simId,recipient,body,waitOffline});
    lastRoute.current=path;
    const params=new URLSearchParams(path.split('?')[1]??'');const saved=routeDrafts.current.get(path);
    const sim=saved?.simId??params.get('sim')??'';const to=saved?.recipient??params.get('to')??'';
    const next=JSON.stringify([sim,to]);drafts.current.set(context.current,body);context.current=next;setSim(sim);setRecipient(to);setBody(saved?.body??drafts.current.get(next)??'');setError('');setWait(saved?.waitOffline??false);
  },[path,visible]);
  const selected=sims.find(s=>s.id===simId);const device=devices.find(d=>d.id===selected?.deviceId);
  const enabled=device?.sendCapability===1 && selected?.state==='active';
  const recent=enabled && device?.sendCapabilityAt!=null && (device.serverTime??Date.now())-device.sendCapabilityAt<=60000;
  async function submit() {
    if(inFlight.current)return;
    const normalized=recipientNumber(recipient);
    if(!attempt && (!normalized||!body.trim()||!selected)){setError('请选择发送 SIM，填写带国家区号的号码和正文。');return;}
    inFlight.current=true;setBusy(true);setError('');
    const request=attempt??{requestId:crypto.randomUUID(),simId,recipient:normalized!,body,waitOffline};setAttempt(request);
    try{
      if(attempt)await reconcileSubmission(api,request);else await api.request<Command>('/commands',{method:'POST',body:request});
      setAttempt(null);setBody('');drafts.current.delete(context.current);await refresh();
    }catch(e){
      if(e instanceof ApiError && [400,403,409,429].includes(e.status)){setAttempt(null);setError(e.status===409?'发送条件已变化：请检查手机已启用远程发送、SIM 状态和最近连接；如需等待上线请勾选。':errorText(e));}
      else setError('提交结果尚未确认。请核对原请求，勿另建相同短信；草稿已保留。');
    }finally{inFlight.current=false;setBusy(false);}
  }
  return <main className="main live-page send-page" hidden={!visible}><div className="send-content">
    <div className="title-row send-heading"><h1>发送短信</h1><a className="send-back" href="#/inbox">返回收件箱</a></div>
    <section className="live-card"><h2>新建 / 回复</h2>
      <p className="field-help">使用实体 SIM 发送，可能产生运营商费用。手机后台可能延迟，系统可能要求确认发送。</p>
      <label>发送 SIM<select value={simId} disabled={busy||!!attempt} onChange={e=>{drafts.current.set(JSON.stringify([simId,recipient]),body);const next=JSON.stringify([e.target.value,recipient]);setSim(e.target.value);setBody(drafts.current.get(next)??'');context.current=next;}}><option value="">请选择发送卡</option>{sims.map(s=><option value={s.id} key={s.id}>{simTitle(s)} · {devices.find(d=>d.id===s.deviceId)?.name??'原设备'}{s.state==='active'?'':'（不可用）'}</option>)}</select></label>
      <label>收件号码<input type="tel" autoComplete="off" value={recipient} placeholder="+8613800000000" disabled={busy||!!attempt} onChange={e=>setRecipient(e.target.value)}/></label>
      <label>短信正文<textarea value={body} maxLength={1600} rows={5} disabled={busy||!!attempt} onChange={e=>setBody(e.target.value)}/></label>
      <p className="field-help">{body.length}/1600 字符 · 实际分段由手机确定</p>
      {!enabled && <p className="field-help">请先升级 Android 网关，在手机权限页启用远程发送并授权，然后保持手机界面打开完成同步。</p>}
      {enabled && !recent && <p className="field-help">手机近期未检查发件，默认保留草稿。</p>}
      <div className="send-actions"><label className="send-wait"><input type="checkbox" checked={waitOffline} disabled={busy||!!attempt} onChange={e=>setWait(e.target.checked)}/><span>等待手机上线发送<small>提交后 5 分钟有效，过期不执行</small></span></label>
      <button className="primary send-submit" type="button" disabled={busy||(!attempt&&(!enabled||(!recent&&!waitOffline)))} onClick={()=>void submit()}>{busy?'正在核对…':attempt?'核对原请求并继续提交':`使用 ${selected?simTitle(selected):'所选 SIM'} 发送`}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    {loadError && <p role="alert" className="error">{loadError} 已有记录保留。</p>}
    <CommandHistory api={api} commands={commands} sims={sims} refresh={()=>void refresh()}/>
    <p className="field-help">展示最近 200 条发件。刷新只查询状态，不会重新发送。</p>
  </div></main>;
}
