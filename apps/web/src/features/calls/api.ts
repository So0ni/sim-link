import type { ApiClient } from '../../shared/api/client.ts';
export type Call = {sequence:number;deviceId:string;number:string|null;outcome:'incoming'|'missed'|'rejected'|'blocked';startedAt:number;durationSeconds:number;simKey:string|null;syncedAt:number;viewedAt:number|null};
export type CallStatus = {deviceId:string;name:string;enabled:number|null;permission:number|null;checkedAt:number|null;pending:number|null;reportedAt:number|null};
export const outcomeLabel:Record<Call['outcome'],string>={incoming:'已接来电',missed:'未接来电',rejected:'已拒接',blocked:'已拦截'};
export const listCalls=(api:ApiClient,signal:AbortSignal,before?:string)=>api.request<{calls:Call[];nextCursor:string|null}>('/calls'+(before?'?before='+encodeURIComponent(before):''),{signal});
export const listCallStatus=(api:ApiClient,signal:AbortSignal)=>api.request<{devices:CallStatus[]}>('/calls/status',{signal});
export const getCall=(api:ApiClient,id:number,signal:AbortSignal)=>api.request<Call>(`/calls/${id}`,{signal});
export const viewCall=(api:ApiClient,id:number)=>api.request(`/calls/${id}/view`,{method:'POST'});
export const dialNumber=(number:string|null)=>number && /^\+?[0-9 ()-]{3,40}$/.test(number)?number.replace(/[ ()-]/g,''):null;
