import { useEffect, useState } from "react";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import {
  listDevices,
  createPairing,
  revokeDevice,
  type Device,
  type Pairing,
} from "./api.ts";
export function DevicesPage({ api }: { api: ApiClient }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listDevices(api, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setDevices(result.devices);
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
    if (!pairing) return;
    const timer = setTimeout(
      () => setPairing(null),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);
  return (
    <main className="main live-page">
      <div className="title-row">
        <h1>设备</h1>
        <button disabled={loading} onClick={() => setReload((v) => v + 1)}>
          刷新
        </button>
      </div>
      <p className="muted">将 Android 留守设备连接到这台服务器。</p>
      <section className="live-card">
        <h2>添加设备</h2>
        <p>
          生成一次性配对凭证，有效期五分钟。Android
          配对界面仍在开发中，当前可用于接口联调。
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setPairing(await createPairing(api));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          生成配对凭证
        </button>
        {pairing && (
          <div className="live-form">
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
                {device.revokedAt ? "已撤销" : "已配对 · 连接状态未知"}
              </p>
              <p className="field-help">设备编号 {device.id.slice(0, 8)}</p>
            </div>
            {!device.revokedAt && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `撤销“${device.name}”？此设备将无法继续上传，已保存短信会保留。`,
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
                撤销设备
              </button>
            )}
          </div>
        ))}
      </section>
      {error && (
        <p className="live-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
