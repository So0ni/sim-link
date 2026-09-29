/** Explicit view snapshots, never HTTP responses, credentials, pairing codes or drafts. */
export const VIEW_CACHE_KEY='simlink-view-cache-v1';
const MAX_AGE=24*60*60*1000;
const MAX_BYTES=2_000_000;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Entry={savedAt:number;value:unknown};
type Snapshot={scope:string;expiresAt:number;entries:Record<string,Entry>};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const array=(v:unknown,check:(v:Record<string,unknown>)=>boolean)=>Array.isArray(v)&&v.every(x=>record(x)&&check(x));
const sims=(v:unknown)=>array(v,x=>typeof x.id==='string'&&typeof x.deviceId==='string'&&typeof x.simKey==='string');
const devices=(v:unknown)=>array(v,x=>typeof x.id==='string'&&typeof x.name==='string');
function validView(key:string,value:unknown) {
  if(!record(value)||!sims(value.sims))return false;
  if(key==='inbox')return typeof value.updatedAt==='number'&&array(value.messages,x=>
    Number.isSafeInteger(x.sequence)&&typeof x.deviceId==='string'&&typeof x.sender==='string'&&typeof x.body==='string'&&typeof x.receivedAt==='number'&&typeof x.readVersion==='number'&&typeof x.isRead==='boolean');
  if(!devices(value.devices))return false;
  if(key==='devices')return typeof value.updatedAt==='number'&&devices(value.recoverable);
  if(key==='send')return array(value.commands,x=>typeof x.id==='string'&&typeof x.state==='string'&&typeof x.recipient==='string'&&typeof x.body==='string'&&Array.isArray(x.parts));
  return false;
}
export class ViewCache {
  private storage:StorageLike|undefined;
  private data:Snapshot|null=null;
  constructor(storage?:StorageLike) {
    try{this.storage=storage??(typeof window!=='undefined'?window.localStorage:undefined);}catch{/* Storage may be disabled. */}
  }
  activate(scope:string,expiresAt:number) {
    if(this.data?.scope===scope){this.data.expiresAt=expiresAt;return;}
    let saved:Snapshot|null=null;
    try{
      const raw=this.storage?.getItem(VIEW_CACHE_KEY);
      if(raw && raw.length<=MAX_BYTES){
        const parsed=JSON.parse(raw) as Snapshot;
        if(parsed.scope===scope && typeof parsed.expiresAt==='number' && parsed.expiresAt>Date.now() && parsed.entries && typeof parsed.entries==='object')saved=parsed;
      }
    }catch{/* Corrupt or unavailable storage falls back to fresh data. */}
    this.data=saved??{scope,expiresAt,entries:{}};
    this.data.expiresAt=expiresAt;
    if(!saved)try{this.storage?.setItem(VIEW_CACHE_KEY,JSON.stringify(this.data));}catch{/* Storage is optional. */}
  }
  get<T>(key:'inbox'|'devices'|'send'):T|undefined {
    const entry=this.data?.entries[key];
    if(!entry || !this.data || this.data.expiresAt<=Date.now() || !Number.isFinite(entry.savedAt) || Date.now()-entry.savedAt>MAX_AGE || !validView(key,entry.value))return;
    return entry.value as T;
  }
  set(key:'inbox'|'devices'|'send',value:unknown) {
    if(!this.data)return;
    this.data.entries[key]={savedAt:Date.now(),value};
    try{
      const entries={...this.data.entries};
      const inbox=entries.inbox;
      if(inbox && record(inbox.value) && Array.isArray(inbox.value.messages)) {
        entries.inbox={...inbox,value:{...inbox.value,messages:inbox.value.messages.slice(-500)}};
      }
      const json=JSON.stringify({...this.data,entries});
      if(json.length<=MAX_BYTES)this.storage?.setItem(VIEW_CACHE_KEY,json);
      // An oversized view remains memory-only; retain the last bounded disk snapshot.
    }catch{/* Quota failure must not break live access. */}
  }
  clear() {
    this.data=null;
    try{this.storage?.removeItem(VIEW_CACHE_KEY);}catch{/* Memory is already cleared. */}
  }
}
