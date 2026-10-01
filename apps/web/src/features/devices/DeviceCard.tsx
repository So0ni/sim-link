import { DeviceMobile } from '@phosphor-icons/react';
import type { ApiClient } from '../../shared/api/client.ts';
import { SimEditor } from '../sims/SimEditor.tsx';
import type { Sim } from '../sims/api.ts';
import type { Device } from './api.ts';
export function DeviceCard({device:d,sims,api,busy,saved,recover,revoke}:{device:Device;sims:Sim[];api:ApiClient;busy:boolean;saved:()=>void;recover:()=>void;revoke:()=>Promise<void>}) {
  const online=d.lastSeenAt!=null && Date.now()-d.lastSeenAt<=35*60*1000;
  const current=sims.filter(s=>s.state==='active'||s.state==='unknown');
  const historical=sims.filter(s=>s.state==='inactive'||s.state==='detached');
  const warning=d.inventoryStatus==='permission_required'?'请在手机授权读取 SIM':d.inventoryStatus==='unavailable'?'暂时无法读取 SIM 清单':d.inventoryStatus==null?'等待手机上报 SIM 清单':null;
  return <article className="device-card" aria-label={`设备：${d.name}`}>
    <header className="device-card-heading">
      <span className="device-icon" aria-hidden="true"><DeviceMobile size={24}/></span>
      <div className="device-identity"><h3>{d.name}</h3><p>最近联系：{d.lastSeenAt==null?'暂无记录':new Date(d.lastSeenAt).toLocaleString()}</p></div>
      <span className={`device-presence ${online?'is-online':''}`}>{online?'近期在线':d.lastSeenAt!=null?'长时间未通信':'未联系'}</span>
    </header>
    <div className="device-sims">
      <p className="device-sims-label">SIM 卡 <span>· 上次上报状态</span></p>
      {warning && <p className="device-notice">{warning}</p>}
      {current.length===0 && !warning && <p className="device-notice">未检测到在用 SIM</p>}
      {current.sort((a,b)=>a.slotIndex-b.slotIndex).map(sim=><SimEditor key={sim.id} sim={sim} api={api} saved={saved}/>)}
      {historical.length>0 && <details className="historical-sims"><summary>历史 SIM · {historical.length} 张</summary>{historical.map(sim=><SimEditor key={sim.id} sim={sim} api={api} saved={saved}/>)}</details>}
    </div>
    <details className="device-management"><summary>设备详情与管理</summary>
      <dl><div><dt>设备编号</dt><dd>{d.id}</dd></div><div><dt>SIM 清单更新</dt><dd>{d.inventoryAt==null?'暂无记录':new Date(d.inventoryAt).toLocaleString()}</dd></div></dl>
      <p className="field-help">近期在线表示 35 分钟内有通信；长时间未通信可能是省电休眠，不代表短信接收失效，也不保证此刻可达。</p>
      <div className="device-management-actions"><button disabled={busy} onClick={recover}>恢复绑定</button>{!d.revokedAt&&<button className="device-unpair" disabled={busy} onClick={()=>void revoke()}>解除配对</button>}</div>
    </details>
  </article>;
}
