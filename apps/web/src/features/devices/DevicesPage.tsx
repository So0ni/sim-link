import { SimEditor } from "../sims/SimEditor.tsx";
import { listSims, type Sim } from "../sims/api.ts";
import { useEffect, useState } from "react";
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
  const [sims, setSims] = useState<Sim[]>([]);
  const [recoverable, setRecoverable] = useState<Pick<Device, "id" | "name">[]>([]);
  const [pairingTarget, setPairingTarget] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([listDevices(api, controller.signal), listSims(api, controller.signal), listRecoverableDevices(api, controller.signal)])
      .then(([result, inventory, retired]) => {
        if (!controller.signal.aborted) {
          setDevices(result.devices);
          setSims(inventory.sims);
          setRecoverable(retired.devices);
          setError("");
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, reload]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") setReload(v => v + 1); }, 30000);
    const refresh = () => { if (document.visibilityState === "visible") setReload(v => v + 1); };
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
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
    try { setPairing(await createRecoveryPairing(api, device.id)); setPairingTarget(device.name); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return (
    <main className="main live-page">
      <div className="title-row">
        <h1>设备</h1>
        <button disabled={loading} onClick={() => setReload((v) => v + 1)}>
          刷新
        </button>
      </div>
      <p className="muted">将 Android 设备连接到这台服务器。</p>
      <section className="live-card">
        <h2>添加设备</h2>
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
      </section>
      <section className="live-card">
        <h2>已配对设备</h2>
        <p className="field-help">状态按服务器最近联系时间判断。后台省电可能延迟心跳，离线不代表手机已关机。</p>
        {loading ? (
          <p role="status">正在加载…</p>
        ) : (
          !devices.length && <p>还没有已配对设备。</p>
        )}
        {devices.map((device) => (
          <div className="live-device" key={device.id}>
            <div>
              <strong>{device.name}</strong>
              <p className="field-help">
                {device.presence === "online" ? "在线 · 最近有联系" : device.presence === "offline" ? "离线 · 超过 35 分钟未联系" : "等待首次联系"}
              </p>
              <p className="field-help">最近联系：{device.lastSeenAt == null ? "暂无记录" : new Date(device.lastSeenAt).toLocaleString()}</p>
              <p className="field-help">设备编号 {device.id.slice(0, 8)}</p>
              <button disabled={busy} onClick={() => void recover(device)}>恢复绑定二维码</button>
              <p className="field-help">{device.inventoryStatus === "permission_required" ? "请在 Android 授权读取 SIM" : device.inventoryStatus === "unavailable" ? "暂时无法读取 SIM 清单" : device.inventoryStatus == null ? "等待网关上报 SIM 清单" : "SIM 清单已上报"}</p>
              {device.inventoryAt != null && <p className="field-help">清单更新于 {new Date(device.inventoryAt).toLocaleString()}</p>}
              {device.inventoryStatus === "available" && !sims.some(s => s.deviceId === device.id && s.state === "active") && <p className="field-help">未检测到在用 SIM。</p>}
              {sims.filter(s => s.deviceId === device.id).map(sim => <SimEditor key={sim.id} sim={sim} api={api} saved={() => setReload(v => v + 1)} />)}
            </div>
            {!device.revokedAt && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `解除“${device.name}”的配对并移除设备条目？凭证立即失效，已保存短信保留。`,
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await revokeDevice(api, device.id);
                    setReload((v) => v + 1);
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                解除配对
              </button>
            )}
          </div>
        ))}
      </section>
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
