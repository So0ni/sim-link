import type { CallStatus } from '../calls/api.ts';

const time=(value:number|null|undefined)=>value==null?'尚未上报':new Date(value).toLocaleString();

/** Device contact and per-feature progress are different observations. */
export function DeviceSyncStatus({calls,error,loading}:{loading:boolean;calls:CallStatus|undefined;error:string}) {
  const label=loading?'正在读取':error?'暂不可用':calls?.enabled==null?'尚未上报':!calls.enabled?'未启用':!calls.permission?'权限需要处理':'已启用';
  return <details className="device-sync-status">
    <summary>同步状态 <span>来电 · {label}</span></summary>
    {loading?<p className="field-help">正在读取来电同步状态…</p>:error?<p className="device-notice">{error}</p>:<>
      <dl>
        <div><dt>来电同步</dt><dd>{label}</dd></div>
        <div><dt>最近检查来电</dt><dd>{time(calls?.checkedAt)}</dd></div>
        <div><dt>上报待上传来电</dt><dd>{calls?.pending==null?'未知':`${calls.pending} 条`}</dd></div>
        <div><dt>来电状态上报</dt><dd>{time(calls?.reportedAt)}</dd></div>
      </dl>
      {calls?.enabled==null&&<p className="field-help">请在 Android 中检查版本与来电同步设置。</p>}
    </>}
    <p className="field-help">以上为手机最后上报的状态。设备近期在线，不代表短信或来电已全部同步。</p>
  </details>;
}
