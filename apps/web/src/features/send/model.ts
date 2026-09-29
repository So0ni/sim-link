import { ApiClient, ApiError } from '../../shared/api/client.ts';
export type SendRequest = { requestId: string; simId: string; recipient: string; body: string };
export type Command = SendRequest & { id: string; deviceId: string; simKey: string; state: string; createdAt: number; expiresAt: number; claimedAt: number | null; reportedAt: number | null; parts: (number | null)[]; reason: string | null };
export const recipientNumber = (text: string) => {
  const value=text.replace(/[\s()-]/g,'');
  return /^\+[1-9][0-9]{6,14}$/.test(value) ? value : null;
};
export const stateLabel: Record<string,string> = {pending:'等待手机处理',claimed:'手机已领取，等待结果',unknown:'结果未确认，可能已发出',sent:'已发送 · 暂无送达报告',failed:'发送失败',partial:'部分分段已发送，请核对',expired:'等待超时，已自动取消',cancelled:'已取消，未发送',rejected:'未发送，手机拒绝执行'};
export const reasonLabel: Record<string,string> = {permission_required:'请在手机授权并启用远程发送',sim_changed:'SIM 已变化，请在手机检查',expired:'等待超时，已自动取消，未发送',connection_changed:'配对或同步状态已改变',execution_interrupted:'手机执行准备中断',device_revoked:'设备已解除配对'};
// Retry only the exact original request, never mint a new key after an ambiguous response.
export async function reconcileSubmission(api: ApiClient, request: SendRequest): Promise<Command> {
  try { return await api.request<Command>(`/commands/request/${request.requestId}`); }
  catch(error) { if (!(error instanceof ApiError) || error.status!==404) throw error; }
  return api.request<Command>('/commands',{method:'POST',body:request});
}
