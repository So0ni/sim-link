import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, type ApiClient } from '../../shared/api/client.ts';
import { ForegroundPoller } from '../../shared/api/polling.ts';
import { listDevices, type Device } from '../devices/api.ts';
import type { Sim } from '../sims/api.ts';
import type { Command } from './model.ts';
export function useSendData(api:ApiClient,visible:boolean) {
  const cached=api.views.get<{devices:Device[];commands:Command[]}>('send');
  const [devices,setDevices]=useState(cached?.devices??[]),[commands,setCommands]=useState(cached?.commands??[]),[error,setError]=useState('');
  const pending=useRef<Promise<boolean>|null>(null),controller=useRef<AbortController|null>(null);
  const save=useCallback((devices:Device[],commands:Command[])=>{
    const sims=api.views.get<{sims:Sim[]}>('inbox')?.sims??api.views.get<{sims:Sim[]}>('send')?.sims??[];
    api.views.set('send',{sims,devices,commands});
  },[api]);
  const refresh=useCallback(()=>{
    if(pending.current)return pending.current;
    const abort=new AbortController();controller.current=abort;
    const task=(async()=>{try{
      const [d,c]=await Promise.all([listDevices(api,abort.signal),api.request<{commands:Command[]}>('/commands',{signal:abort.signal})]);
      if(!abort.signal.aborted){setDevices(d.devices);setCommands(c.commands);save(d.devices,c.commands);setError('');return true;}return false;
    }catch(e){if(!abort.signal.aborted)setError(errorText(e));return false;}})();
    pending.current=task;void task.finally(()=>{if(pending.current===task)pending.current=null;});return task;
  },[api,save]);
  useEffect(()=>{if(!visible)return;const poller=new ForegroundPoller(refresh,()=>document.visibilityState==='visible'&&navigator.onLine);poller.start();
    document.addEventListener('visibilitychange',poller.wake);window.addEventListener('online',poller.wake);
    return()=>{poller.stop();controller.current?.abort();pending.current=null;document.removeEventListener('visibilitychange',poller.wake);window.removeEventListener('online',poller.wake);};
  },[visible,refresh]);
  return {devices,commands,error,refresh,accept:(command:Command)=>setCommands(old=>{const next=[command,...old.filter(c=>c.id!==command.id)];save(devices,next);return next;})};
}
