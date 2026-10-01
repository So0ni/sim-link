import { conversationTime } from './time.ts';

export function ConversationTime({at,now,detail=false}:{at:number;now:number;detail?:boolean}) {
  const date = new Date(at);
  const valid = Number.isFinite(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined} title={valid ? date.toLocaleString() : undefined}>{conversationTime(at,now,detail)}</time>;
}
