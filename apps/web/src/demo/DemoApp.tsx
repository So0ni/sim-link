import { useEffect, useRef, useState } from "react";
import {
  EnvelopeSimple,
  HardDrives,
  GearSix,
  SimCard,
  NotePencil,
  Copy,
  ArrowLeft,
  PaperPlaneTilt,
  Check,
  WarningCircle,
  ArrowClockwise,
  X,
  SignOut,
  CaretRight,
  User,
  ShieldCheck,
  WifiSlash,
  SlidersHorizontal,
  ChatCircleDots,
} from "@phosphor-icons/react";
import tokens from "../../../../design/tokens/tokens.json";
import {
  initialConversations,
  sims,
  filterConversations,
  validRecipient,
  canSubmit,
  deliveryLabel,
} from "./model";
import type { Conversation, SimId } from "./model";

Object.entries(tokens.color).forEach(([k, v]) =>
  document.documentElement.style.setProperty(`--${k}`, v),
);
document.documentElement.style.setProperty("--font", tokens.font.webSans);
const DEMO_KEY = "simlink.prototype.session.v1";
function storedSession() {
  try {
    return localStorage.getItem(DEMO_KEY) === "active";
  } catch {
    return false;
  }
}
function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/inbox");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "/inbox");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return [
    route,
    (next: string) => {
      location.hash = next;
    },
  ] as const;
}
function SimTabs({
  value,
  onChange,
  compose = false,
  offline = false,
}: {
  value: SimId | "all";
  onChange: (v: SimId | "all") => void;
  compose?: boolean;
  offline?: boolean;
}) {
  const values: (SimId | "all")[] = compose
    ? ["home", "work"]
    : ["all", "home", "work"];
  return (
    <div
      className="sim-tabs"
      role="tablist"
      aria-label={compose ? "发送 SIM" : "短信 SIM"}
    >
      {values.map((v, i) => (
        <button
          key={v}
          role="tab"
          aria-controls={compose ? "compose-sim-panel" : "inbox-sim-panel"}
          aria-selected={value === v}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            let n = i;
            if (e.key === "ArrowRight") n = (i + 1) % values.length;
            else if (e.key === "ArrowLeft")
              n = (i + values.length - 1) % values.length;
            else if (e.key === "Home") n = 0;
            else if (e.key === "End") n = values.length - 1;
            else return;
            e.preventDefault();
            (e.currentTarget.parentElement!.children[n] as HTMLElement).focus();
          }}
        >
          <SimCard size={23} />
          <span>
            {v === "all" ? "全部" : sims[v].name}
            {v !== "all" && (
              <small className={offline ? "warning" : "online"}>
                <i />
                {offline ? "离线" : "在线"}
              </small>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
export function DemoApp() {
  const [route, go] = useRoute();
  const [authenticated, setAuthenticated] = useState(storedSession);
  const [restoring, setRestoring] = useState(true);
  const [items, setItems] = useState<Conversation[]>(initialConversations);
  const [sim, setSim] = useState<SimId | "all">("work");
  const [unread, setUnread] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [sendSim, setSendSim] = useState<SimId>("work");
  const [recipient, setRecipient] = useState("");
  const [newText, setNewText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resend, setResend] = useState<{ cid: string; mid: string } | null>(
    null,
  );
  const messageScroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const demoDialog = useRef<HTMLDialogElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const page = route.startsWith("/devices")
    ? "devices"
    : route.startsWith("/settings")
      ? "settings"
      : "inbox";
  const composing = route === "/compose";
  const active = items.find((c) => route === `/inbox/${c.id}`);
  const selectedId = active?.id;
  useEffect(() => {
    const t = setTimeout(() => setRestoring(false), 250);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (authenticated && !restoring && selectedId)
      setItems((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, unread: false } : c)),
      );
  }, [selectedId, authenticated, restoring]);
  useEffect(() => {
    if (resend) dialog.current?.showModal();
    else dialog.current?.close();
  }, [resend]);
  useEffect(() => {
    if (demoOpen) demoDialog.current?.showModal();
    else demoDialog.current?.close();
  }, [demoOpen]);
  useEffect(() => {
    const el = messageScroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, active?.messages.length, active?.messages.at(-1)?.status]);
  const visible = filterConversations(items, sim, unread);
  function login() {
    try {
      localStorage.setItem(DEMO_KEY, "active");
    } catch {
      setToast("浏览器无法保存演示会话，下次打开需重新进入");
    }
    setAuthenticated(true);
  }
  function logout() {
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {}
    setAuthenticated(false);
    setDemoOpen(false);
    setResend(null);
    setDrafts({});
    setNewText("");
    go("/inbox");
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setToast("已复制");
    } catch {
      setToast(`复制失败，请手动选择：${code}`);
    }
  }
  function openCompose() {
    if (!newText && !recipient) setSendSim(sim === "all" ? "work" : sim);
    setError("");
    go("/compose");
  }
  function send(cid: string, text: string) {
    if (!canSubmit(text, !offline && !serverDown, busy)) return;
    const mid = crypto.randomUUID();
    setBusy(true);
    setItems((prev) =>
      prev.map((c) =>
        c.id === cid
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: mid,
                  text: text.trim(),
                  time: new Date().toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                  outgoing: true,
                  status: "processing",
                },
              ],
            }
          : c,
      ),
    );
    setDrafts((p) => ({ ...p, [cid]: "" }));
    const outcome = unknown ? "unknown" : "sent";
    timers.current.push(
      setTimeout(() => {
        setItems((prev) =>
          prev.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === mid ? { ...m, status: outcome } : m,
            ),
          })),
        );
        setBusy(false);
      }, 850),
    );
  }
  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!validRecipient(recipient)) {
      setError("请输入带国家区号的号码，例如 +65 8123 4567");
      document.getElementById("recipient")?.focus();
      return;
    }
    if (!canSubmit(newText, !offline && !serverDown, busy)) return;
    const normalized = recipient.replace(/[\s()-]/g, "");
    const existing = items.find(
      (c) => c.sim === sendSim && c.sender.replace(/\s/g, "") === normalized,
    );
    const cid = existing?.id || crypto.randomUUID();
    if (!existing)
      setItems((prev) => [
        {
          id: cid,
          sender: recipient,
          sim: sendSim,
          unread: false,
          reply: true,
          messages: [],
        },
        ...prev,
      ]);
    send(cid, newText);
    setNewText("");
    setRecipient("");
    setError("");
    go(`/inbox/${cid}`);
  }
  const nav = (
    <>
      {(
        [
          { id: "inbox", label: "短信", Icon: EnvelopeSimple },
          { id: "devices", label: "设备", Icon: HardDrives },
          { id: "settings", label: "设置", Icon: GearSix },
        ] as const
      ).map(({ id, label, Icon }) => (
        <a
          key={id}
          href={`#/${id}`}
          aria-current={page === id ? "page" : undefined}
        >
          <Icon size={24} weight={page === id ? "fill" : "regular"} />
          <span>{label}</span>
        </a>
      ))}
    </>
  );
  const connectionWarning = serverDown ? (
    <div className="status warning">
      <WifiSlash size={22} />
      <div>
        <strong>当前无法连接服务器</strong>
        <p>已加载的短信仍可查看，草稿已保留。</p>
        <button
          className="text-button"
          onClick={() => setToast("仍无法连接。可在原型演示中恢复连接。")}
        >
          重新连接
        </button>
      </div>
    </div>
  ) : offline ? (
    <div className="status warning">
      <WarningCircle size={22} />
      <div>
        <strong>手机已离线</strong>
        <p>最后在线 14:32，仍可查看历史短信。</p>
        <a href="#/devices">
          查看设备 <CaretRight size={14} />
        </a>
      </div>
    </div>
  ) : null;
  if (restoring)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="wordmark">SIMLink</div>
          <p role="status">正在恢复会话…</p>
        </div>
      </div>
    );
  if (!authenticated)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="wordmark">SIMLink</div>
          <p className="eyebrow">你的 SIM，随时在身边</p>
          <h1>欢迎回来</h1>
          <p className="muted">登录后，安全访问你的短信与设备。</p>
          <div className="demo-note">
            <ShieldCheck size={24} />
            <div>
              <strong>交互演示</strong>
              <p>此原型只使用虚构数据，无需输入真实账号或密码。</p>
            </div>
          </div>
          <button className="primary full" onClick={login}>
            进入演示收件箱 <CaretRight size={20} />
          </button>
          <p className="auth-hint">
            此浏览器会记住演示登录状态。
            <br />
            再次打开，直接回到短信。
          </p>
          <div className="auth-footer">自托管 · 为你掌控的连接</div>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#/inbox" className="wordmark">
          SIMLink
        </a>
        <nav aria-label="主导航">{nav}</nav>
        <div className="sidebar-bottom">
          <button className="demo-trigger" onClick={() => setDemoOpen(true)}>
            <SlidersHorizontal size={18} />
            <span>原型演示</span>
          </button>
          <span className="host">
            <HardDrives size={16} /> sim.example.com
          </span>
        </div>
      </aside>
      <main
        className={`main ${page === "inbox" ? "inbox-layout" : ""} ${active || composing ? "has-detail" : ""}`}
      >
        {page === "inbox" && (
          <>
            <section className="inbox-list" aria-label="短信列表">
              <div className="list-top">
                <div className="mobile-brand">
                  <span>SIMLink</span>
                  <button
                    aria-label="打开原型演示"
                    onClick={() => setDemoOpen(true)}
                  >
                    <SlidersHorizontal size={20} />
                  </button>
                </div>
                <div className="title-row">
                  <h1>短信</h1>
                  <button
                    className="text-button new-button"
                    onClick={openCompose}
                  >
                    <NotePencil size={24} />
                    新建
                  </button>
                </div>
                <SimTabs value={sim} offline={offline} onChange={setSim} />
                <div className="list-context">
                  <span>
                    {sim === "all"
                      ? "全部 SIM"
                      : `${sims[sim].name} · 尾号 ${sims[sim].tail}`}
                  </span>
                  <span>
                    {serverDown
                      ? "连接中断"
                      : offline
                        ? "同步已暂停"
                        : "刚刚同步"}
                  </span>
                </div>
                {connectionWarning}
                <div className="read-filter" role="group" aria-label="阅读状态">
                  <button
                    aria-pressed={!unread}
                    onClick={() => setUnread(false)}
                  >
                    全部
                  </button>
                  <button aria-pressed={unread} onClick={() => setUnread(true)}>
                    未读
                  </button>
                </div>
              </div>
              <div
                className="rows"
                role="tabpanel"
                id="inbox-sim-panel"
                aria-label={
                  sim === "all" ? "全部 SIM 的短信" : `${sims[sim].name}的短信`
                }
              >
                {visible.length === 0 ? (
                  <div className="empty">
                    <Check size={32} />
                    <h2>没有未读短信</h2>
                    <p>这张卡的消息都已查看。</p>
                    <button
                      className="text-button"
                      onClick={() => setUnread(false)}
                    >
                      查看全部短信
                    </button>
                  </div>
                ) : (
                  visible.map((c) => (
                    <article
                      key={c.id}
                      className={`conversation-row ${selectedId === c.id ? "selected" : ""}`}
                    >
                      <a
                        href={`#/inbox/${c.id}`}
                        className="row-open"
                        aria-label={`${c.unread ? "未读，" : ""}${c.sender}，${sims[c.sim].name}`}
                      >
                        <span
                          className={`unread-dot ${c.unread ? "visible" : ""}`}
                        />
                        <span className="avatar">
                          {c.reply ? (
                            <User size={21} weight="fill" />
                          ) : (
                            c.sender.slice(0, 1)
                          )}
                        </span>
                        <div className="row-content">
                          <div className="row-heading">
                            <strong>{c.sender}</strong>
                            <time>{c.messages.at(-1)?.time}</time>
                          </div>
                          <p>{c.messages.at(-1)?.text}</p>
                          {sim === "all" && (
                            <span className="sim-tag">{sims[c.sim].name}</span>
                          )}
                        </div>
                        <CaretRight className="row-chevron" size={18} />
                      </a>
                      {c.code && (
                        <button
                          className="copy-chip"
                          onClick={() => copy(c.code!)}
                          aria-label={`复制验证码 ${c.code}`}
                        >
                          <Copy size={17} />
                          复制 {c.code}
                        </button>
                      )}
                    </article>
                  ))
                )}
              </div>
              <p className="list-footnote">演示数据 · 未连接真实设备</p>
            </section>
            <section
              className="detail-pane"
              aria-label={
                composing ? "新建短信" : active ? "短信详情" : "会话预览"
              }
            >
              {composing ? (
                <>
                  <header className="detail-header">
                    <button
                      className="back"
                      onClick={() => go("/inbox")}
                      aria-label="返回短信"
                    >
                      <ArrowLeft size={24} />
                    </button>
                    <div>
                      <h2>新建短信</h2>
                      <p>选择 SIM，发送一条消息。</p>
                    </div>
                    <button
                      className="desktop-close"
                      onClick={() => go("/inbox")}
                      aria-label="关闭新建短信"
                    >
                      <X size={22} />
                    </button>
                  </header>
                  <form className="compose-form" onSubmit={submitNew}>
                    <label className="field-label">发送 SIM</label>
                    <SimTabs
                      compose
                      value={sendSim}
                      offline={offline}
                      onChange={(v) => {
                        if (v !== "all") setSendSim(v);
                      }}
                    />
                    <div
                      role="tabpanel"
                      id="compose-sim-panel"
                      aria-label={`${sims[sendSim].name}发件表单`}
                    >
                      <p className="field-help">
                        {sims[sendSim].name} · 尾号 {sims[sendSim].tail}
                      </p>
                      <label htmlFor="recipient">收件号码</label>
                      <input
                        id="recipient"
                        value={recipient}
                        onChange={(e) => {
                          setRecipient(e.target.value);
                          setError("");
                        }}
                        inputMode="tel"
                        placeholder="+65 8123 4567"
                        aria-invalid={!!error}
                        aria-describedby="recipient-help"
                      />
                      <p
                        id="recipient-help"
                        className={error ? "error" : "field-help"}
                      >
                        {error || "请包含国家或地区区号。"}
                      </p>
                      <label htmlFor="new-text">短信正文</label>
                      <textarea
                        id="new-text"
                        value={newText}
                        onChange={(e) => setNewText(e.target.value)}
                        placeholder="输入短信内容"
                      />
                      <p className="field-help">
                        {newText.length} 个字符 · 仅模拟发送，不产生费用
                      </p>
                      {connectionWarning}
                      <button
                        className="primary full"
                        disabled={
                          !canSubmit(newText, !offline && !serverDown, busy)
                        }
                      >
                        <PaperPlaneTilt size={20} />
                        使用{sims[sendSim].name}发送
                      </button>
                      {(offline || serverDown) && (
                        <p className="field-help">
                          连接恢复前保留草稿，暂时无法发送。
                        </p>
                      )}
                    </div>
                  </form>
                </>
              ) : active ? (
                <>
                  <header className="detail-header">
                    <button
                      className="back"
                      onClick={() => go("/inbox")}
                      aria-label="返回短信"
                    >
                      <ArrowLeft size={24} />
                    </button>
                    <div>
                      <h2>{active.sender}</h2>
                      <p>
                        {sims[active.sim].name} · 尾号 {sims[active.sim].tail}
                      </p>
                    </div>
                    <button
                      className="desktop-close"
                      onClick={() => go("/inbox")}
                      aria-label="关闭会话"
                    >
                      <X size={20} />
                    </button>
                  </header>
                  <div className="message-scroll" ref={messageScroll}>
                    {connectionWarning}
                    <div className="date-divider">今天 · 9 月 28 日</div>
                    {active.code ? (
                      <div className="otp-detail">
                        <div className="code-panel">
                          <span>验证码</span>
                          <strong>{active.code}</strong>
                          <button
                            className="primary"
                            onClick={() => copy(active.code!)}
                          >
                            <Copy size={19} />
                            复制验证码
                          </button>
                        </div>
                        <h3>短信原文</h3>
                        <p className="original-text">
                          {active.messages[0].text}
                        </p>
                        <dl className="metadata">
                          <div>
                            <dt>接收 SIM</dt>
                            <dd>
                              {sims[active.sim].name} · {sims[active.sim].tail}
                            </dd>
                          </div>
                          <div>
                            <dt>接收时间</dt>
                            <dd>2026-09-28 {active.messages[0].time}</dd>
                          </div>
                        </dl>
                        <p className="field-help">
                          验证码仅为自动识别结果，请以短信原文为准。
                        </p>
                      </div>
                    ) : (
                      <div className="messages">
                        {active.messages.map((m) => (
                          <div
                            key={m.id}
                            className={`message ${m.outgoing ? "outgoing" : ""}`}
                          >
                            <p className="bubble">{m.text}</p>
                            <div className="message-meta">
                              {m.time}
                              {m.outgoing && (
                                <span
                                  className={
                                    m.status === "unknown" ? "warning" : ""
                                  }
                                >
                                  {m.status === "unknown" ? (
                                    <WarningCircle size={14} />
                                  ) : m.status === "sent" ? (
                                    <Check size={14} />
                                  ) : null}
                                  {deliveryLabel(m.status)}
                                </span>
                              )}
                            </div>
                            {m.status === "unknown" && (
                              <div className="unknown-panel">
                                <strong>这条短信可能已经发出</strong>
                                <p>请先核对收件方或手机，避免重复发送。</p>
                                <button
                                  className="primary"
                                  onClick={() =>
                                    setToast(
                                      "已查询：结果仍未确认，没有重发短信",
                                    )
                                  }
                                >
                                  <ArrowClockwise size={18} />
                                  刷新状态
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setResend({ cid: active.id, mid: m.id })
                                  }
                                >
                                  核对后重新发送
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {active.reply ? (
                    <form
                      className="reply-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        send(active.id, drafts[active.id] || "");
                      }}
                    >
                      <label htmlFor="reply">
                        <SimCard size={19} />
                        使用{sims[active.sim].name}回复{" "}
                        <span>· 尾号 {sims[active.sim].tail}</span>
                      </label>
                      <div className="reply-controls">
                        <textarea
                          id="reply"
                          placeholder="输入回复…"
                          value={drafts[active.id] || ""}
                          onChange={(e) =>
                            setDrafts((p) => ({
                              ...p,
                              [active.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          className="primary"
                          disabled={
                            !canSubmit(
                              drafts[active.id] || "",
                              !offline && !serverDown,
                              busy,
                            )
                          }
                          aria-label={`使用${sims[active.sim].name}发送回复`}
                        >
                          <PaperPlaneTilt size={22} />
                          <span>{busy ? "发送中" : "发送"}</span>
                        </button>
                      </div>
                      {(offline || serverDown) && (
                        <p className="field-help">暂时无法发送，草稿已保留。</p>
                      )}
                    </form>
                  ) : (
                    <div className="read-only-note">
                      <ShieldCheck size={18} />
                      此发件人不支持回复
                    </div>
                  )}
                </>
              ) : (
                <div className="empty detail-empty">
                  <ChatCircleDots size={44} weight="light" />
                  <h2>你的短信，就在这里</h2>
                  <p>选择一条会话，查看内容或回复。</p>
                  <span>每张 SIM，都有清晰的归属。</span>
                </div>
              )}
            </section>
          </>
        )}
        {page === "devices" && (
          <section className="simple-page">
            <div className="mobile-brand">SIMLink</div>
            <h1>设备</h1>
            <p className="muted">手机的连接与短信状态</p>
            <div className={`device-summary ${offline ? "warning" : "online"}`}>
              <HardDrives size={30} />
              <div>
                <h2>家中的 Android</h2>
                <p>
                  {offline ? "离线 · 最后在线 14:32" : "在线 · 刚刚收到心跳"}
                </p>
              </div>
            </div>
            <dl className="settings-list">
              <div>
                <dt>系统版本</dt>
                <dd>Android 14</dd>
              </div>
              <div>
                <dt>短信权限</dt>
                <dd>已授予（演示）</dd>
              </div>
              <div>
                <dt>最近同步</dt>
                <dd>{offline ? "14:32" : "刚刚"}</dd>
              </div>
              <div>
                <dt>电量</dt>
                <dd>{offline ? "未知" : "86% · 正在充电"}</dd>
              </div>
            </dl>
            <h2 className="section-heading">SIM 卡</h2>
            {Object.entries(sims).map(([key, s]) => (
              <div className="sim-device" key={key}>
                <SimCard size={25} />
                <div>
                  <strong>{s.name}</strong>
                  <p>尾号 {s.tail}</p>
                </div>
                <span>{offline ? "状态未知" : "已就绪（演示）"}</span>
              </div>
            ))}
            {offline && (
              <div className="status warning">
                <WarningCircle size={23} />
                <div>
                  <strong>在手机检查连接</strong>
                  <p>确认手机已联网，然后打开 SIMLink Gateway 查看运行状态。</p>
                </div>
              </div>
            )}
            <p className="field-help">此页为状态演示，不代表真实设备验证。</p>
          </section>
        )}
        {page === "settings" && (
          <section className="simple-page">
            <div className="mobile-brand">SIMLink</div>
            <h1>设置</h1>
            <p className="muted">让 SIMLink 以适合你的方式工作。</p>
            <h2 className="section-heading">通知</h2>
            <div className="settings-list">
              <div>
                <span>此设备通知</span>
                <span className="muted">未开启</span>
              </div>
              <div>
                <span>Telegram</span>
                <span className="muted">未配置</span>
              </div>
            </div>
            <p className="field-help">
              关闭全部通知，仍可正常查看短信。渠道配置将在后续原型中补充。
            </p>
            <h2 className="section-heading">登录会话</h2>
            <div className="session-card">
              <ShieldCheck size={25} />
              <div>
                <strong>此浏览器</strong>
                <p>演示会话 · 保持登录</p>
                <small>重新打开或刷新页面后直接进入短信。</small>
              </div>
            </div>
            <button className="secondary" onClick={logout}>
              <SignOut size={20} />
              退出此设备
            </button>
            <h2 className="section-heading">关于</h2>
            <p className="muted">SIMLink · 交互原型 0.1</p>
            <button className="text-button" onClick={() => setDemoOpen(true)}>
              <SlidersHorizontal size={20} />
              打开原型演示
            </button>
          </section>
        )}
      </main>
      {!(active || composing) && (
        <nav className="bottom-nav" aria-label="手机导航" onContextMenu={event => event.preventDefault()}>
          {nav}
        </nav>
      )}
      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast}
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setResend(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setResend(null);
        }}
      >
        <div className="dialog-content">
          <WarningCircle className="warning" size={32} />
          <h2>重新发送这条短信？</h2>
          <p>
            原短信可能已经发出。继续将创建一次新的发送，收件人可能收到两条相同短信。
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setResend(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={offline || serverDown || busy}
              onClick={() => {
                if (resend) {
                  const m = items
                    .find((c) => c.id === resend.cid)
                    ?.messages.find((m) => m.id === resend.mid);
                  if (m) send(resend.cid, m.text);
                }
                setResend(null);
              }}
            >
              确认重新发送
            </button>
          </div>
        </div>
      </dialog>
      <dialog
        ref={demoDialog}
        onCancel={() => setDemoOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDemoOpen(false);
        }}
      >
        <div className="dialog-content">
          <div className="title-row">
            <h2>原型演示</h2>
            <button
              aria-label="关闭原型演示"
              onClick={() => setDemoOpen(false)}
            >
              <X size={22} />
            </button>
          </div>
          <p>以下开关只模拟界面状态，不连接真实设备或发送短信。</p>
          <label className="toggle-row">
            <span>手机离线</span>
            <input
              type="checkbox"
              checked={offline}
              onChange={(e) => setOffline(e.target.checked)}
            />
          </label>
          <label className="toggle-row">
            <span>服务器连接中断</span>
            <input
              type="checkbox"
              checked={serverDown}
              onChange={(e) => setServerDown(e.target.checked)}
            />
          </label>
          <label className="toggle-row">
            <span>下一次发送结果未确认</span>
            <input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
          </label>
          <p className="field-help">
            结果未确认状态会持续保留；刷新只查询，不会重发。开关关闭后，新发送模拟成功。
          </p>
          <button className="secondary full" onClick={logout}>
            查看登录入口
          </button>
          <button className="primary full" onClick={() => setDemoOpen(false)}>
            完成
          </button>
        </div>
      </dialog>
    </div>
  );
}
