import { useState } from "react";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import { simTitle, updateSim, type Sim } from "./api.ts";

export function SimEditor({ sim, api, saved }: { sim: Sim; api: ApiClient; saved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sim.name);
  const [phone, setPhone] = useState(sim.phoneNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="sim-editor">
    <strong>{simTitle(sim)}</strong>
    <p className="field-help">卡槽 {sim.slotIndex + 1} · {sim.carrier || "运营商未知"} · {
      sim.state === "active" ? "最近上报在用" : sim.state === "inactive" ? "已不在当前清单" : sim.state === "detached" ? "设备已解绑" : "当前状态未知"
    }</p>
    {editing ? <form className="live-form" onSubmit={async e => {
      e.preventDefault();
      const normalized = phone.replace(/[ ()-]/g, "");
      if (normalized && !/^\+?[0-9]{6,20}$/.test(normalized)) { setError("号码需为 6–20 位数字，可带 +、空格、括号或连字符。"); return; }
      setBusy(true); setError("");
      try { await updateSim(api, sim.id, name, phone); setEditing(false); saved(); }
      catch (err) { setError(errorText(err)); }
      finally { setBusy(false); }
    }}>
      <label htmlFor={`sim-name-${sim.id}`}>备注名</label>
      <input id={`sim-name-${sim.id}`} maxLength={40} value={name} placeholder="例如：备用卡" disabled={busy} onChange={e => setName(e.target.value)} />
      <label htmlFor={`sim-phone-${sim.id}`}>这张卡的电话号码（可选）</label>
      <input id={`sim-phone-${sim.id}`} type="tel" autoComplete="off" maxLength={32} value={phone} placeholder="建议包含国家或地区代码" disabled={busy} onChange={e => setPhone(e.target.value)} />
      <p className="field-help">手动确认号码用于区分卡片，不代表运营商验证。新卡映射需要重新填写；旧短信保留原归属。</p>
      <div className="sim-actions"><button type="submit" className="primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>取消</button></div>
      {error && <p className="live-error" role="alert">{error}</p>}
    </form> : <button onClick={() => { setName(sim.name); setPhone(sim.phoneNumber); setEditing(true); }}>设置名称与号码</button>}
  </div>;
}
