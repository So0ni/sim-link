import { ViewCache } from "./viewCache.ts";
export class ApiError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(status: number, retryAfter: number | null = null) {
    super(`API request failed (${status})`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export class ApiClient {
  readonly views = new ViewCache();
  private csrf = "";
  private generation = 0;
  onUnauthorized: () => void = () => {};
  setSession(csrf: string) {
    this.generation++;
    this.csrf = csrf;
  }
  clearSession() {
    this.setSession("");
  }
  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      authenticated?: boolean;
    } = {},
  ): Promise<T> {
    const epoch = this.generation;
    const method = options.method ?? "GET";
    const response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(method !== "GET" && this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      if (
        response.status === 401 &&
        options.authenticated !== false &&
        epoch === this.generation
      )
        this.onUnauthorized();
      throw new ApiError(response.status, parseRetryAfter(response.headers?.get("Retry-After") ?? null));
    }
    return response.json() as Promise<T>;
  }
}
export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 403)
      return "请求被拒绝，请检查服务器地址配置或刷新页面。";
    if (error.status === 429) return error.retryAfter === null ? "操作过于频繁，请稍后再试。" : `操作过于频繁，请 ${error.retryAfter} 秒后再试。`;
    if (error.status === 400) return "请求内容不符合要求，请检查后重试。";
  }
  return "暂时无法连接服务器，请重试。";
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
}
