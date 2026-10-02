import { BackLink } from '../../shared/ui/BackLink.tsx';
import { ConversationTime } from '../../shared/ui/ConversationTime.tsx';
import { CallOutcomeIcon } from './CallOutcomeIcon.tsx';
import { useState } from 'react';
import { useCalls } from './useCalls.ts';
import { Phone } from '@phosphor-icons/react';
import { ApiClient } from '../../shared/api/client.ts';
import { PageBrand } from '../../shared/ui/PageBrand.tsx';
import { simTitle } from '../sims/api.ts';
import { outcomeLabel, dialNumber, type Call } from './api.ts';
import './calls.css';

export function CallsPage({api,path}:{api:ApiClient;path:string}) {
  const {calls,devices,sims,error,loaded,before,filter,setFilter,busy,selectedId,selected,loadMore}=useCalls(api,path);
  const [notice,setNotice]=useState('');
  const [missedOnly,setMissedOnly]=useState(false);
  const simLabel=(call:Call)=>{const sim=sims.find(s=>s.deviceId===call.deviceId&&s.simKey===call.simKey);return sim?simTitle(sim):'SIM 未知';};
  const scoped=calls.filter(c=>filter==='all'||filter===JSON.stringify([c.deviceId,c.simKey]));
  const missedCount=scoped.filter(c=>c.outcome==='missed').length;
  const shown=scoped.filter(c=>!missedOnly||c.outcome==='missed');
  return <main className={`main live-page calls-page ${selectedId?'call-detail-open':''}`}>
    <PageBrand/><div className="title-row"><h1>来电</h1><span className="field-help">电话结束后同步</span></div>
    <div className="sim-tabs live-tabs" role="group" aria-label="筛选 SIM">{[['all','全部'],...sims.map(s=>[JSON.stringify([s.deviceId,s.simKey]),simTitle(s)])].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <div className="reading-filter" role="group" aria-label="筛选来电状态">
      <button aria-pressed={!missedOnly} onClick={()=>setMissedOnly(false)}>全部</button>
      <button aria-pressed={missedOnly} onClick={()=>setMissedOnly(true)}>未接 {missedCount}</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="calls-layout"><section className="calls-list" aria-label="来电记录">
      {!loaded&&!error&&<p role="status">正在读取来电…</p>}
      {loaded&&shown.length===0&&<div className="call-empty"><Phone size={36}/><h2>{missedOnly?'没有未接来电':'暂无来电记录'}</h2><p>{missedOnly?'当前 SIM 范围内没有已加载的未接来电。':'在 Android 设置中启用「来电同步」后，新来电会显示在这里。'}</p>{missedOnly&&<button className="text-button" onClick={()=>setMissedOnly(false)}>查看全部</button>}</div>}
      {shown.map(c=><a key={c.sequence} href={`#/calls/${c.sequence}`} className={`call-row ${String(c.sequence)===selectedId?'selected':''}`} aria-current={String(c.sequence)===selectedId?'true':undefined}>
        <CallOutcomeIcon outcome={c.outcome}/><div className="row-content"><div className="row-heading"><strong>{c.number??'号码未提供'}</strong><ConversationTime at={c.startedAt} now={Date.now()}/></div><p>{outcomeLabel[c.outcome]}</p><span className="sim-tag">{simLabel(c)}</span></div>
      </a>)}
      {before&&<button className="secondary" disabled={busy} onClick={()=>void loadMore()}>更早记录</button>}
    </section><section className="call-detail" aria-label="来电详情">
      {selected?<><BackLink href="#/calls">返回来电</BackLink><p className="field-help">{outcomeLabel[selected.outcome]}</p><h2>{selected.number??'号码未提供'}</h2>
        <dl><dt>来电时间</dt><dd>{new Date(selected.startedAt).toLocaleString()}</dd><dt>留守设备</dt><dd>{devices.find(d=>d.id===selected.deviceId)?.name??'原设备'}</dd><dt>接收 SIM</dt><dd>{simLabel(selected)}</dd>{selected.outcome==='incoming'&&<><dt>通话时长</dt><dd>{selected.durationSeconds} 秒</dd></>}<dt>同步时间</dt><dd>{new Date(selected.syncedAt).toLocaleString()}</dd></dl>
        <div className="call-actions">{selected.number&&<button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(selected.number!);setNotice('号码已复制');}catch{setNotice('复制失败，请长按号码复制。');}}}>复制号码</button>}{dialNumber(selected.number)&&<a className="primary" href={`tel:${dialNumber(selected.number)}`}>用当前手机拨打</a>}</div><p className="field-help">通过当前设备的拨号应用回拨。查看记录不代表已回电。</p><p role="status">{notice}</p></>:<p className="field-help">{selectedId?'正在读取记录…':'选择一条来电查看详情'}</p>}
    </section></div>
  </main>;
}
