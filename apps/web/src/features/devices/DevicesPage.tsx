import { DeviceCard } from "./DeviceCard.tsx";
import { RefreshButton } from "../../shared/ui/RefreshButton.tsx";
import { PageBrand } from "../../shared/ui/PageBrand.tsx";
import { listSims, type Sim } from "../sims/api.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { pairingPayload } from "./pairing.ts";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import {
  listDevices,
  createRecoveryPairing,
  listRecoverableDevices,
  createPairing,
  revokeDevice,
  type Device,
  type Pairing,
} from "./api.ts";
export function DevicesPage({ api }: { api: ApiClient }) {
  const cached=api.views.get<{sims:Sim[];devices:Device[];recoverable:Pick<Device,"id"|"name">[];updatedAt:number}>("devices");
  const [sims, setSims] = useState<Sim[]>(cached?.sims??[]);
  const [recoverable, setRecoverable] = useState<Pick<Device, "id" | "name">[]>(cached?.recoverable??[]);
  const [adding,setAdding]=useState(false);
  const pairingPanel=useRef<HTMLDetailsElement>(null);
  const [pairingTarget, setPairingTarget] = useState("");
  const [devices, setDevices] = useState<Device[]>(cached?.devices??[]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  useEffect(()=>{if(pairing)pairingPanel.current?.scrollIntoView({behavior:"smooth",block:"start"});},[pairing]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [updatedAt,setUpdatedAt]=useState<number|null>(cached?.updatedAt??null);
  const active=useRef<AbortController|null>(null);
  const pending=useRef<Promise<void>|null>(null);
  const refresh=useCallback(():Promise<void>=>{
    if(pending.current)return pending.current;
    const controller=new AbortController();active.current=controller;setLoading(true);
    const task=Promise.all([listDevices(api,controller.signal),listSims(api,controller.signal),listRecoverableDevices(api,controller.signal)])
      .then(([result,inventory,retired])=>{
        if(controller.signal.aborted)return;
        const stamp=Date.now();setDevices(result.devices);setSims(inventory.sims);setRecoverable(retired.devices);setUpdatedAt(stamp);setError("");
        api.views.set("devices",{devices:result.devices,sims:inventory.sims,recoverable:retired.devices,updatedAt:stamp});
      }).catch(err=>{if(!controller.signal.aborted)setError(errorText(err));})
      .finally(()=>{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setLoading(false);}if(pending.current===task)pending.current=null;});
    pending.current=task;return task;
  },[api]);
  useEffect(()=>{
    void refresh();
    return ()=>{active.current?.abort();active.current=null;pending.current=null;};
  },[refresh,reload]);
  useEffect(()=>{
    const wake=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();};
    const timer=setInterval(wake,30000);
    document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);};
  },[refresh]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => setPairing(null),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);
  async function recover(device: Pick<Device, "id" | "name">) {
    if (!window.confirm(`为“${device.name}”恢复绑定？请仅让原安装扫描。配对成功后将替换旧凭证，保留设备、SIM 名称和短信记录。`)) return;
    setBusy(true); setError(""); setPairing(null);
    try { setPairing(await createRecoveryPairing(api, device.id)); setPairingTarget(device.name); setAdding(true); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return (
    <main className="main live-page devices-page">
      <PageBrand />
      <div className="title-row">
        <h1>设备</h1>
        <RefreshButton label="刷新设备" onRefresh={refresh}/>

      </div>
      <p className="field-help refresh-time">{updatedAt ? `刷新于 ${new Date(updatedAt).toLocaleTimeString()}` : "尚未刷新"}</p>
      <section className="paired-devices" aria-label="已配对设备">
        <div className="paired-heading"><h2>已配对设备</h2><span>{devices.length} 台</span></div>
        {loading && !updatedAt ? <p className="field-help">正在加载…</p> : !devices.length && <p className="field-help">还没有已配对设备，请在下方添加。</p>}
        {devices.map(device=><DeviceCard key={device.id} device={device} sims={sims.filter(s=>s.deviceId===device.id)} api={api} busy={busy}
          saved={()=>setReload(v=>v+1)} recover={()=>void recover(device)} revoke={async()=>{
            if(!window.confirm(`解除“${device.name}”的配对并移除设备条目？凭证立即失效，已保存短信保留。`))return;
            setBusy(true);setError("");
            try{await revokeDevice(api,device.id);setReload(v=>v+1);}catch(err){setError(errorText(err));}finally{setBusy(false);}
          }}/>) }
      </section>
      <details ref={pairingPanel} className="live-card device-add" open={adding||!!pairing} onToggle={e=>setAdding(e.currentTarget.open)}>
        <summary>添加设备</summary>
        <p>
          使用 Android 的「服务器与同步 → 扫码配对」扫描二维码。凭证有效期五分钟，
          使用一次后失效；确认服务器后，仅上传后续新短信。
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setPairingTarget("");
              setPairing(await createPairing(api));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          生成配对二维码
        </button>
        {pairing && (
          <div className="live-form">
            {pairingTarget && <p role="status">恢复绑定：{pairingTarget} · 扫描成功后旧凭证失效</p>}
            <div className="pairing-qr" role="img" aria-label="一次性设备配对二维码">
              <QRCodeSVG value={pairingPayload(pairing)} size={256} level="M" marginSize={4} />
            </div>
            <p className="field-help">二维码包含服务器地址和一次性凭证，请勿分享。也可手动输入以下信息。</p>
            <label htmlFor="pair-server">服务器地址</label>
            <input id="pair-server" readOnly value={pairing.server} />
            <label htmlFor="pair-token">一次性配对凭证</label>
            <textarea id="pair-token" readOnly value={pairing.pairingToken} />
            <p className="field-help">
              有效至 {new Date(pairing.expiresAt).toLocaleTimeString()} ·
              使用后立即失效
            </p>
            <button onClick={() => setPairing(null)}>隐藏凭证</button>
          </div>
        )}
      </details>
      {recoverable.length > 0 && <details className="live-card">
        <summary>恢复已解除配对的设备</summary>
        <p className="field-help">这些设备当前没有访问权限。仅保留安装身份与历史归属，恢复需要管理员生成专用二维码。</p>
        {recoverable.map(device => <div className="live-device" key={device.id}><span>{device.name} · {device.id.slice(0, 8)}</span>
          <button disabled={busy} onClick={() => void recover(device)}>恢复绑定二维码</button></div>)}
      </details>}
      {error && (
        <p className="live-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
