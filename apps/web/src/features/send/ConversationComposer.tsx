import { useLayoutEffect, useReducer, useRef } from 'react';
import { ArrowUp } from '@phosphor-icons/react';
import { ApiError, errorText, type ApiClient } from '../../shared/api/client.ts';
import type { Sim } from '../sims/api.ts';
import type { Device } from '../devices/api.ts';
import { recipientNumber, reconcileSubmission, type Command, type SendRequest } from './model.ts';
export type ReplyDraft={body:string;attempt:SendRequest|null;busy:boolean;error:string};
export function ConversationComposer({api,draft,sim,device,sender,onSent}:{api:ApiClient;draft:ReplyDraft;sim:Sim|undefined;device:Device|undefined;sender:string;onSent:(c:Command)=>void}){
  const [,render]=useReducer(n=>n+1,0);const input=useRef<HTMLTextAreaElement>(null);
  const recipient=recipientNumber(sender);
  const reason=device&&device.sendCapability!==1?'未开启发送':!recipient?'此发件人不支持回复':!sim?'无法关联原 SIM，不能回复':sim.state!=='active'?'原 SIM 当前不可用':!device?'正在确认发送状态':'';
  useLayoutEffect(()=>{if(input.current){input.current.style.height='auto';input.current.style.height=Math.min(input.current.scrollHeight,128)+'px';}},[draft.body,reason]);
  async function submit(){
    if(draft.busy||(!draft.attempt&&(reason||!draft.body.trim())))return;
    draft.busy=true;draft.error='';const old=draft.attempt;
    const request=old??{requestId:crypto.randomUUID(),simId:sim!.id,recipient:recipient!,body:draft.body};draft.attempt=request;render();
    try{const command=old?await reconcileSubmission(api,request):await api.request<Command>('/commands',{method:'POST',body:request});
      draft.attempt=null;draft.body='';onSent(command);
    }catch(e){if(e instanceof ApiError&&[400,403,409,429].includes(e.status)){draft.attempt=null;draft.error=e.status===409?'发送条件已变化，请检查手机发送开关及原 SIM。':errorText(e);}
      else draft.error='提交结果尚未确认，请核对原请求，避免重复发送。';
    }finally{draft.busy=false;render();}
  }
  if(reason==='未开启发送')return <div className="conversation-composer composer-unavailable"><p className="composer-help">未开启发送</p></div>;
  return <form className="conversation-composer" onSubmit={e=>{e.preventDefault();void submit();}} aria-label="回复此会话">
    {draft.error&&<p role="alert" className="live-error">{draft.error}</p>}
    <div className="composer-row"><textarea ref={input} aria-label="短信正文" aria-describedby="reply-help" rows={1} maxLength={1600} placeholder={reason||'短信'} value={draft.body} disabled={!!reason||draft.busy||!!draft.attempt} onChange={e=>{draft.body=e.target.value;render();}}/>
      <button className="reply-send" type="submit" aria-label={draft.attempt?'核对原发送请求':'发送短信'} disabled={draft.busy||(!draft.attempt&&(!!reason||!draft.body.trim()))}><ArrowUp size={24} weight="bold"/></button>
    </div>
    <p id="reply-help" className="composer-help" role="status">{draft.busy?'正在提交…':draft.attempt?'发送结果待确认，点击箭头核对原请求':reason||`短信 · 使用原 SIM${draft.body?` · ${draft.body.length}/1600`:''}`}</p>
  </form>;
}
