import { useEffect, useRef, useState } from 'react';
import { ApiClient, ApiError, errorText } from '../../shared/api/client.ts';
import { ForegroundPoller } from '../../shared/api/polling.ts';
import { listSims, type Sim } from '../sims/api.ts';
import { listCalls, listCallStatus, getCall, viewCall, type Call, type CallStatus } from './api.ts';
import { mergeCalls } from './model.ts';

export function useCalls(api:ApiClient,path:string) {
  const [calls,setCalls]=useState<Call[]>([]),[devices,setDevices]=useState<CallStatus[]>([]),[sims,setSims]=useState<Sim[]>([]);
  const [error,setError]=useState(''),[loaded,setLoaded]=useState(false),[before,setBefore]=useState<string|null>(null),[filter,setFilter]=useState('all');
  const [busy,setBusy]=useState(false);
  const initial=useRef(true);
  const selectedId=/^\/calls\/(\d+)$/.exec(path)?.[1];
  const selected=calls.find(c=>String(c.sequence)===selectedId);
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();abort.current=controller;

    const poller=new ForegroundPoller(async()=>{
      try {
        const [result,status,inventory]=await Promise.all([listCalls(api,controller.signal),listCallStatus(api,controller.signal),listSims(api,controller.signal)]);
        let detail:Call|undefined;
        if(selectedId&&!result.calls.some(c=>String(c.sequence)===selectedId))detail=await getCall(api,Number(selectedId),controller.signal);
        if(controller.signal.aborted)return false;
        setCalls(previous=>mergeCalls(previous,[...result.calls,...(detail?[detail]:[])]));
        setDevices(status.devices);setSims(inventory.sims);if(initial.current){setBefore(result.nextCursor);initial.current=false;}setError('');setLoaded(true);return true;
      }catch(e){if(!controller.signal.aborted)setError(e instanceof ApiError&&e.status===404?'服务器尚未支持来电功能，或此记录不存在。':errorText(e));return false;}
    },()=>document.visibilityState==='visible'&&navigator.onLine);
    poller.start();document.addEventListener('visibilitychange',poller.wake);window.addEventListener('online',poller.wake);
    return()=>{controller.abort();poller.stop();document.removeEventListener('visibilitychange',poller.wake);window.removeEventListener('online',poller.wake);};
  },[api,selectedId]);
  useEffect(()=>{
    if(!selected || selected.viewedAt!==null)return;
    let active=true, running=false;
    const mark=()=>{
      if(document.visibilityState!=='visible'||!navigator.onLine||running)return;
      running=true;
      void viewCall(api,selected.sequence).then(()=>{
        if(active)setCalls(previous=>previous.map(c=>c.sequence===selected.sequence?{...c,viewedAt:Date.now()}:c));
      }).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{running=false;});
    };
    mark();document.addEventListener('visibilitychange',mark);window.addEventListener('online',mark);
    return()=>{active=false;document.removeEventListener('visibilitychange',mark);window.removeEventListener('online',mark);};
  },[api,selected]);
  async function loadMore() {
    if(!abort.current||!before||busy)return;
    const signal=abort.current.signal;
    setBusy(true);
    try {
      const result=await listCalls(api,signal,before);
      if(signal.aborted)return;
      setCalls(previous=>mergeCalls(previous,result.calls));setBefore(result.nextCursor);
    } catch(e) { if(!signal.aborted)setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return {calls,devices,sims,error,loaded,before,filter,setFilter,busy,selectedId,selected,loadMore};
}
