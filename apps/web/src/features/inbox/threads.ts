import type { ReceivedMessage } from './api.ts';
import { conversations } from './model.ts';
import { recipientNumber, type Command } from '../send/model.ts';
export function threads(messages:ReceivedMessage[], commands:Command[]) {
  const result=conversations(messages).map(c=>({...c,anchor:c.messages[0],commands:[] as Command[]}));
  for(const command of commands){
    let thread=result.find(c=>c.anchor.deviceId===command.deviceId && c.anchor.simKey===command.simKey && recipientNumber(c.anchor.sender)===command.recipient);
    if(!thread){
      const anchor:ReceivedMessage={sequence:0,isRead:true,readVersion:0,deviceId:command.deviceId,eventId:'',sender:command.recipient,body:'',subscriptionId:null,simKey:command.simKey,receivedAt:command.createdAt,syncedAt:command.createdAt};
      thread={id:JSON.stringify([command.deviceId,command.simKey,command.recipient]),anchor,messages:[],commands:[]};result.push(thread);
    }
    thread.commands.push(command);
  }
  return result.map(c=>{
    const timeline=[...c.messages.map(message=>({id:`in:${message.sequence}`,at:message.receivedAt,message,command:null as Command|null})),...c.commands.map(command=>({id:`out:${command.id}`,at:command.createdAt,command,message:null as ReceivedMessage|null}))].sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id));
    return {...c,timeline,last:timeline.at(-1)!};
  }).sort((a,b)=>b.last.at-a.last.at || a.id.localeCompare(b.id));
}

export function matchesThread(thread:{id:string;anchor:ReceivedMessage},selected:string|null) {
  if(thread.id===selected)return true;
  try{const parts=JSON.parse(selected??'null');return Array.isArray(parts)&&parts.length===3&&parts[0]===thread.anchor.deviceId&&parts[1]===thread.anchor.simKey&&typeof parts[2]==='string'&&recipientNumber(parts[2])!==null&&recipientNumber(parts[2])===recipientNumber(thread.anchor.sender);}catch{return false;}
}
