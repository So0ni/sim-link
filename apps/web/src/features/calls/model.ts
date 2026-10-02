import type { Call } from './api.ts';
/** Viewed is monotonic: a stale poll must not undo a confirmed view. */
export function mergeCalls(previous:Call[],incoming:Call[]):Call[] {
  const records=new Map(previous.map(call=>[call.sequence,call]));
  for(const call of incoming) {
    const old=records.get(call.sequence);
    records.set(call.sequence,{...call,simKey:call.simKey??old?.simKey??null,viewedAt:call.viewedAt??old?.viewedAt??null});
  }
  return Array.from(records.values()).sort((a,b)=>b.startedAt-a.startedAt||b.sequence-a.sequence);
}
