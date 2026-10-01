import { useState } from 'react';
import { useCalls } from './useCalls.ts';
import { Phone, ArrowLeft } from '@phosphor-icons/react';
import { ApiClient } from '../../shared/api/client.ts';
import { PageBrand } from '../../shared/ui/PageBrand.tsx';
import { simTitle } from '../sims/api.ts';
import { outcomeLabel, dialNumber, type Call } from './api.ts';
import './calls.css';

export function CallsPage({api,path}:{api:ApiClient;path:string}) {
  const {calls,devices,sims,error,loaded,before,filter,setFilter,busy,selectedId,selected,loadMore}=useCalls(api,path);
  const [notice,setNotice]=useState('');
  const simLabel=(call:Call)=>{const sim=sims.find(s=>s.deviceId===call.deviceId&&s.simKey===call.simKey);return sim?simTitle(sim):'SIM 未知';};
  const shown=calls.filter(c=>filter==='all'||filter==='missed'&&c.outcome==='missed'||filter==='unknown'&&c.simKey===null||filter===JSON.stringify([c.deviceId,c.simKey]));
  return <main className={`main live-page calls-page ${selectedId?'call-detail-open':''}`}>
    <PageBrand/><div className="title-row"><h1>来电</h1><span className="field-help">电话结束后同步</span></div>
    <div className="sim-tabs" role="tablist" aria-label="来电筛选">{[['all','全部'],['missed','未接'],...(calls.some(c=>!c.simKey)?[['unknown','SIM 未知']]:[]),...sims.map(s=>[JSON.stringify([s.deviceId,s.simKey]),simTitle(s)])].map(([key,label])=><button key={key} role="tab" aria-selected={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="calls-layout"><section className="calls-list" aria-label="来电记录">
      {!loaded&&!error&&<p role="status">正在读取来电…</p>}
      {loaded&&shown.length===0&&<div className="call-empty"><Phone size={36}/><h2>暂无来电记录</h2><p>在 Android 设置中启用「来电同步」后，新来电会显示在这里。</p></div>}
      {shown.map(c=><a key={c.sequence} href={`#/calls/${c.sequence}`} className={`call-row ${String(c.sequence)===selectedId?'selected':''}`} aria-current={String(c.sequence)===selectedId?'true':undefined}>
        <Phone size={24}/><div><strong>{c.number??'号码未提供'}</strong><p>{outcomeLabel[c.outcome]}{c.viewedAt===null?' · 未查看':''}</p><small>{new Date(c.startedAt).toLocaleString()} · {simLabel(c)}</small></div>
      </a>)}
      {before&&<button className="secondary" disabled={busy} onClick={()=>void loadMore()}>更早记录</button>}
    </section><section className="call-detail" aria-label="来电详情">
      {selected?<><a href="#/calls" className="call-back"><ArrowLeft size={20}/>返回来电</a><p className="field-help">{outcomeLabel[selected.outcome]}</p><h2>{selected.number??'号码未提供'}</h2>
        <dl><dt>来电时间</dt><dd>{new Date(selected.startedAt).toLocaleString()}</dd><dt>留守设备</dt><dd>{devices.find(d=>d.deviceId===selected.deviceId)?.name??'原设备'}</dd><dt>接收 SIM</dt><dd>{simLabel(selected)}</dd>{selected.outcome==='incoming'&&<><dt>通话时长</dt><dd>{selected.durationSeconds} 秒</dd></>}<dt>同步时间</dt><dd>{new Date(selected.syncedAt).toLocaleString()}</dd></dl>
        <div className="call-actions">{selected.number&&<button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(selected.number!);setNotice('号码已复制');}catch{setNotice('复制失败，请长按号码复制。');}}}>复制号码</button>}{dialNumber(selected.number)&&<a className="primary" href={`tel:${dialNumber(selected.number)}`}>用当前手机拨打</a>}</div><p className="field-help">通过当前设备的拨号应用回拨。查看记录不代表已回电。</p><p role="status">{notice}</p></>:<p className="field-help">{selectedId?'正在读取记录…':'选择一条来电查看详情'}</p>}
    </section></div>
    <details className="call-status"><summary>来电同步状态</summary>{devices.map(d=><p key={d.deviceId}><strong>{d.name}</strong> · {d.enabled===null?'尚未上报（请升级 Android）':!d.enabled?'未启用':!d.permission?'权限需要处理':'已启用'}<br/><span className="field-help">最近检查：{d.checkedAt?new Date(d.checkedAt).toLocaleString():'尚未检查'} · 上报待同步：{d.pending??'未知'}<br/>状态上报：{d.reportedAt?new Date(d.reportedAt).toLocaleString():'未知'}</span></p>)}<p className="field-help">以上为手机最后上报的状态。服务器心跳正常不代表来电检查成功。无法确认接收卡的记录显示“SIM 未知”。</p></details>
  </main>;
}
