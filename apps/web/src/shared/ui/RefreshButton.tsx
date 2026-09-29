import { useRef, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
export function RefreshButton({label='刷新',onRefresh}:{label?:string;onRefresh:()=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false);
  const running=useRef(false);
  return <button type="button" className="refresh-button" title={label} aria-label={label} aria-busy={busy} disabled={busy} onClick={async()=>{
    if(running.current)return;
    running.current=true;setBusy(true);
    try{await onRefresh();}finally{running.current=false;setBusy(false);}
  }}><ArrowClockwise size={22} className={busy?'refresh-spin':undefined}/></button>;
}
