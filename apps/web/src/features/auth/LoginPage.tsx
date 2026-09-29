import { useState } from "react";
import { ApiError, errorText } from "../../shared/api/client.ts";
import type { SessionController } from "./session.ts";
export function LoginPage({ auth }: { auth: SessionController }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-screen">
      <form
        className="auth-card live-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await auth.login(password);
            setPassword("");
          } catch (err) {
            setError(
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
        <button className="primary full" disabled={busy}>
          {busy ? "正在登录…" : "登录"}
        </button>
        <p className="auth-hint">登录后将在此设备保持登录。</p>
        <p className="field-help">首次使用需由部署者初始化管理员密码。</p>
      </form>
    </main>
  );
}
