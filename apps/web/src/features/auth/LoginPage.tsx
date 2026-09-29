import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../shared/api/client.ts";
import type { SessionController } from "./session.ts";
export function LoginPage({ auth }: { auth: SessionController }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAt) setRetryAt(0);
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  return (
    <main className="auth-screen">
      <form
        className="auth-card live-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || Date.now() < retryAt) return;
          setBusy(true);
          setError("");
          try {
            await auth.login(password);
            setPassword("");
          } catch (err) {
            if (err instanceof ApiError && err.status === 429 && err.retryAfter !== null) {
              const now = Date.now();
              setClock(now);
              setRetryAt(now + err.retryAfter * 1000);
              setError("登录尝试过于频繁，请等待后重试。");
            } else setError(
              err instanceof ApiError && err.status === 401
                ? "密码不正确，请重试。"
                : errorText(err),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="wordmark">SIMLink</div>
        <p className="eyebrow">你的 SIM，随时在身边</p>
        <h1>欢迎回来</h1>
        <p className="muted">登录后访问你的短信与设备。</p>
        <label htmlFor="password">管理员密码</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="login-error"
        />
        <p id="login-error" className="error" role="alert">
          {error}
        </p>
        <button className="primary full" disabled={busy || remaining > 0}>
          {busy ? "正在登录…" : remaining > 0 ? `${remaining} 秒后重试` : "登录"}
        </button>
        <p className="auth-hint">登录后将在此设备保持登录。</p>
        <p className="field-help">首次使用需由部署者初始化管理员密码。</p>
      </form>
    </main>
  );
}
