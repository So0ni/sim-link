import { useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  Copy,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import type { ApiClient } from "../../shared/api/client.ts";
import { useVisibleReading } from "./useVisibleReading.ts";
import { useInbox } from "./useInbox.ts";
import { conversations, simKey, simLabel, simTabs } from "./model.ts";
export function InboxPage({
  api,
  selected,
  go,
}: {
  api: ApiClient;
  selected: string | null;
  go: (path: string) => void;
}) {
  const inbox = useInbox(api);
  const [sim, setSim] = useState("all");
  const [copyResult, setCopyResult] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const tabs = simTabs(inbox.messages, inbox.sims);
  const scoped = conversations(inbox.messages).filter(
    (c) => sim === "all" || simKey(c.messages[0]) === sim,
  );
  const active = scoped.find((c) => c.id === selected);
  const unreadCount = scoped.reduce((count, c) => count + c.messages.filter(m => !m.isRead).length, 0);
  const items = scoped.filter(c => !unreadOnly || c.messages.some(m => !m.isRead));
  const visibleReading = useVisibleReading(active?.id, active?.messages ?? [], inbox.readingBusy, inbox.markReading);
  return (
    <main className={`main inbox-layout ${selected ? "has-detail" : ""}`}>
      <section className="inbox-list" aria-label="短信列表">
        <div className="list-top">
          <div className="mobile-brand">SIMLink</div>
          <div className="title-row">
            <h1>短信</h1>
            <button
              aria-label="刷新短信"
              disabled={inbox.busy}
              onClick={() => void inbox.refresh()}
            >
              <ArrowClockwise size={22} />
            </button>
          </div>
          <div
            className="sim-tabs live-tabs"
            role="group"
            aria-label="筛选 SIM"
          >
            {[["all", "全部"], ...tabs].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={sim === id}
                onClick={() => {
                  setSim(id);
                  go("/inbox");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="reading-filter" role="group" aria-label="筛选阅读状态">
            <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>全部</button>
            <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>未读 {unreadCount}</button>
          </div>
          <div className="list-context">
            <span>{inbox.busy ? "正在刷新…" : `已加载 ${items.length} 个会话`}</span>
            <span>
              {inbox.updatedAt
                ? `刷新于 ${new Date(inbox.updatedAt).toLocaleTimeString()}`
                : "尚未刷新"}
            </span>
          </div>
          {inbox.error && (
            <p className="live-error" role="alert">
              {inbox.error} 已加载的短信仍可查看，连接恢复后会自动重试。{" "}
              <button onClick={() => void inbox.refresh()}>重试</button>
            </p>
          )}
        </div>
        <div className="rows">
          {!items.length && (
            <div className="empty">
              <EnvelopeSimple size={32} />
              <h2>{inbox.busy ? "正在读取短信" : unreadOnly ? "没有未读短信" : "还没有同步的短信"}</h2>
              <p>{unreadOnly ? "当前 SIM 范围内没有已加载的未读短信。" : "设备上传的新短信会显示在这里。"}</p>
              {unreadOnly ? <button className="text-button" onClick={() => setUnreadOnly(false)}>查看全部</button> : (
                <a className="text-button" href="#/devices">查看设备</a>
              )}
            </div>
          )}
          {items.map((c) => {
            const last = c.messages.at(-1)!;
            return (
              <article
                className={`conversation-row ${active?.id === c.id ? "selected" : ""}`}
                key={c.id}
              >
                <a
                  className="row-open"
                  href={`#/inbox/${encodeURIComponent(c.id)}`}
                  aria-label={`查看 ${last.sender} 的短信`}
                >
                  <span className="avatar">{last.sender.slice(0, 1)}</span>
                  <div className="row-content">
                    <div className="row-heading">
                      <strong>{last.sender}{c.messages.some(m => !m.isRead) && <span className="unread-label">未读 {c.messages.filter(m => !m.isRead).length}</span>}</strong>
                      <time>
                        {new Date(last.receivedAt).toLocaleDateString()}
                      </time>
                    </div>
                    <p>{last.body}</p>
                    <span className="sim-tag">{simLabel(last, inbox.sims)}</span>
                  </div>
                </a>
              </article>
            );
          })}
        </div>
        <p className="list-footnote">页面打开时每 5 秒自动检查新短信 · 可点击右上角刷新</p>
      </section>
      <section className="detail-pane" aria-label="短信详情">
        {inbox.readingError && <p className="live-error reading-feedback" role="alert">{inbox.readingError} 可用“标为已读 / 未读”重试。</p>}
        {active ? (
          <>
            <header className="detail-header">
              <button
                className="back"
                aria-label="返回短信"
                onClick={() => go("/inbox")}
              >
                <ArrowLeft size={24} />
              </button>
              <div>
                <h2>{active.messages[0].sender}</h2>
                <p>{simLabel(active.messages[0], inbox.sims)}</p>
              </div>
            </header>
            <div className="reading-actions">
              <button disabled={inbox.readingBusy} onClick={() => {
                visibleReading.suppress();
                void inbox.markReading(active.messages, false);
              }}>标为未读</button>
              <button disabled={inbox.readingBusy} onClick={() => void inbox.markReading(active.messages, true)}>标为已读</button>
              {inbox.readingBusy && <span role="status">正在保存…</span>}
            </div>
            <div className="message-scroll" ref={visibleReading.root}>
              <div className="messages">
                {active.messages.map((m) => (
                  <article className="message" key={m.sequence} data-sequence={m.sequence}>
                    <p className="bubble">{m.body}</p>
                    <div className="message-meta">
                      <time>{new Date(m.receivedAt).toLocaleString()}</time>
                      <span>{m.isRead ? "已读" : "未读"}</span>
                      <button
                        aria-label="复制短信正文"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(m.body);
                            setCopyResult("已复制正文");
                          } catch {
                            setCopyResult("复制失败，请手动选择正文。");
                          }
                        }}
                      >
                        <Copy size={16} />
                        复制
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <p role="status" className="field-help">
                {copyResult}
              </p>
            </div>
          </>
        ) : (
          <div className="empty">
            <button className="back" onClick={() => go("/inbox")}>
              返回短信
            </button>
            <EnvelopeSimple size={40} />
            <h2>{selected ? "暂未找到这条会话" : "选择一条会话"}</h2>
            <p>
              {selected
                ? "请刷新列表，或检查当前 SIM 筛选。"
                : "在这里查看完整短信。"}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
