import { ConversationTime } from "../../shared/ui/ConversationTime.tsx";
import { RefreshButton } from "../../shared/ui/RefreshButton.tsx";
import { PageBrand } from "../../shared/ui/PageBrand.tsx";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import type { ApiClient } from "../../shared/api/client.ts";
import { useVisibleReading } from "./useVisibleReading.ts";
import { useConversationScroll } from "./useConversationScroll.ts";
import { useInbox } from "./useInbox.ts";
import { simKey, simLabel, simTabs, senderAvatar } from "./model.ts";
import { threads, matchesThread } from './threads.ts';
import { useSendData } from '../send/useSendData.ts';
import { CommandCard } from '../send/SendPage.tsx';
import { ConversationComposer, type ReplyDraft } from '../send/ConversationComposer.tsx';
export function InboxPage({
  api,
  selected,
  go,
  visible,
}: {
  api: ApiClient;
  visible: boolean;
  selected: string | null;
  go: (path: string) => void;
}) {
  const [now,setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    const update = () => { if (!document.hidden) setNow(Date.now()); };
    update();
    const timer = window.setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [visible]);
  const inbox = useInbox(api,visible);
  const outgoing=useSendData(api,visible);
  const drafts=useRef(new Map<string,ReplyDraft>());
  const [sim, setSim] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const tabs = simTabs(inbox.messages, inbox.sims);
  const allThreads=threads(inbox.messages,outgoing.commands);
  const scoped = allThreads.filter(
    (c) => sim === "all" || simKey(c.anchor) === sim,
  );
  const active = allThreads.find((c) => matchesThread(c,selected));
  const activeId=useRef(active?.id);activeId.current=active?.id;
  const unreadCount = scoped.reduce((count, c) => count + c.messages.filter(m => !m.isRead).length, 0);
  const items = scoped.filter(c => !unreadOnly || c.messages.some(m => !m.isRead));
  const visibleReading = useVisibleReading(visible?active?.id:undefined, active?.messages ?? [], inbox.readingBusy, inbox.markReading);
  useConversationScroll(visibleReading.root, active?.id, active?.timeline.length ?? 0, active?.last.id);
  const originalSim=active?.anchor.simKey?inbox.sims.find(s=>s.deviceId===active.anchor.deviceId&&s.simKey===active.anchor.simKey):undefined;
  if(active&&!drafts.current.has(active.id))drafts.current.set(active.id,{body:'',attempt:null,busy:false,error:''});
  return (
    <main hidden={!visible} className={`main inbox-layout ${selected ? "has-detail" : ""}`}>
      <section className="inbox-list" aria-label="短信列表">
        <div className="list-top">
          <PageBrand />
          <div className="title-row">
            <h1>短信</h1>
            <a className="text-button" href="#/send">新建短信</a>
            <RefreshButton label="刷新短信" onRefresh={inbox.refresh} />
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
            <span>{`已加载 ${items.length} 个会话`}</span>
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
              <h2>{inbox.busy && !inbox.updatedAt ? "正在读取短信" : unreadOnly ? "没有未读短信" : "还没有同步的短信"}</h2>
              <p>{unreadOnly ? "当前 SIM 范围内没有已加载的未读短信。" : "设备上传的新短信会显示在这里。"}</p>
              {unreadOnly ? <button className="text-button" onClick={() => setUnreadOnly(false)}>查看全部</button> : (
                <a className="text-button" href="#/devices">查看设备</a>
              )}
            </div>
          )}
          {items.map((c) => {
            const last = {...c.anchor,body:c.last.message?.body??c.last.command!.body,receivedAt:c.last.at};
            const unread = c.messages.filter(m => !m.isRead).length;
            return (
              <article
                className={`conversation-row ${unread ? "is-unread" : "is-read"} ${active?.id === c.id ? "selected" : ""}`}
                key={c.id}
              >
                <a
                  className="row-open"
                  href={`#/inbox/${encodeURIComponent(c.id)}`}
                  aria-label={`查看 ${last.sender} 的短信`}
                >
                  <span className="avatar">{senderAvatar(last.sender)}</span>
                  <div className="row-content">
                    <div className="row-heading">
                      <strong>{last.sender}{unread > 0 && <span className="unread-label">未读 {unread}</span>}</strong>
                      <ConversationTime at={last.receivedAt} now={now}/>
                    </div>
                    <p>{last.body}</p>
                    <span className="sim-tag">{simLabel(last, inbox.sims)}</span>
                  </div>
                </a>
              </article>
            );
          })}
        </div>
      </section>
      <section className="detail-pane" aria-label="短信详情">
        {inbox.readingError && <p className="live-error reading-feedback" role="alert">{inbox.readingError} 请重新进入会话重试。</p>}
        {outgoing.error&&<p className="live-error reading-feedback" role="alert">{outgoing.error} 发件状态暂未更新。</p>}
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
                <h2>{active.anchor.sender}</h2>
                <p>{simLabel(active.anchor, inbox.sims)}</p>
              </div>
            </header>
            <div className="message-scroll" ref={visibleReading.root}>
              <div className="messages">
                {active.timeline.map((item) => item.command ? <CommandCard key={item.id} command={item.command} api={api} refresh={()=>void outgoing.refresh()} compact now={now}/> : (()=>{const m=item.message!;return (
                  <article className="message" key={m.sequence} data-sequence={m.sequence}>
                    <p className="bubble">{m.body}</p>
                    <div className="message-meta">
                      <ConversationTime at={m.receivedAt} now={now} detail/>
                    </div>
                  </article>
                );})())}
              </div>
            </div>
            <ConversationComposer key={active.id} api={api} draft={drafts.current.get(active.id)!} sim={originalSim} device={outgoing.devices.find(d=>d.id===active.anchor.deviceId)} sender={active.anchor.sender} onSent={command=>{outgoing.accept(command);const root=visibleReading.root.current;if(root&&activeId.current===active.id)requestAnimationFrame(()=>{root.scrollTop=root.scrollHeight;});}}/>
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
