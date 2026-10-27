import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@spm/shared";
import { api } from "./api";

type Mode = "login" | "register" | "forgot" | "reset";
type Field = "username" | "email" | "password" | "confirm" | "inviteCode";
const readMode = (): Mode => {
  const mode = window.location.hash.slice(1).split("?")[0];
  return mode === "register" || mode === "forgot" || mode === "reset"
    ? mode
    : "login";
};
const labels: Record<Field, string> = {
  username: "用户名",
  email: "邮箱",
  password: "密码",
  confirm: "确认密码",
  inviteCode: "管理员邀请码",
};
export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>(readMode);
  const [values, setValues] = useState<Record<Field, string>>({
    username: "",
    email: "",
    password: "",
    confirm: "",
    inviteCode: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [notice, setNotice] = useState("");
  const [simulatedResetUrl, setSimulatedResetUrl] = useState('');
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const version = useRef(0);
  const section = useRef<HTMLElement>(null);
  function clear() {
    version.current++;
    setErrors({});
    setNotice("");
    setSimulatedResetUrl('');
    setError("");
    setBusy(false);
    setVisible({});
    setValues((v) => ({ ...v, password: "", confirm: "", inviteCode: "" }));
  }
  function navigate(next: Mode) {
    clear();
    setMode(next);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
  }
  useEffect(() => {
    const onHash = () => {
      clear();
      setMode(readMode());
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      version.current++;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  useEffect(() => {
    section.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [mode]);
  const title = {
    login: "欢迎登录爱管理",
    register: "注册爱管理账号",
    forgot: "找回登录密码",
    reset: "设置新密码",
  }[mode];
  const fields: Field[] =
    mode === "login"
      ? ["username", "password"]
      : mode === "register"
        ? ["username", "email", "password", "confirm", "inviteCode"]
        : mode === "forgot"
          ? ["username", "email"]
          : ["password", "confirm"];
  function fieldLabel(field: Field) {
    if (field === "email" && mode === "forgot") return "已绑定邮箱";
    if (field === "password")
      return mode === "register"
        ? "设置密码"
        : mode === "reset"
          ? "新密码"
          : "密码";
    if (field === "confirm" && mode === "reset") return "确认新密码";
    return labels[field];
  }
  function placeholder(field: Field) {
    if (field === "username")
      return mode === "register"
        ? "设置用于登录的用户名"
        : mode === "forgot"
          ? "请输入注册时使用的用户名"
          : "请输入用户名";
    if (field === "email")
      return mode === "forgot"
        ? "请输入该账号已绑定的邮箱"
        : "用于接收账号验证和密码重置通知";
    if (field === "password")
      return mode === "login" ? "请输入登录密码" : "至少12位字符";
    if (field === "confirm")
      return mode === "reset" ? "再次输入新密码" : "请再次输入密码";
    return "请输入管理员发放的邀请码";
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid: Partial<Record<Field, string>> = {};
    for (const field of fields) {
      const value = values[field];
      if (!value.trim()) invalid[field] = `请输入${fieldLabel(field)}`;
      else if (
        field === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
      )
        invalid[field] = "请输入有效的邮箱地址";
      else if (field === "password" && mode !== "login" && value.length < 12)
        invalid[field] = "密码至少12位";
      else if (field === "confirm" && value !== values.password)
        invalid[field] = "两次输入的密码不一致";
      else if (
        field === "username" &&
        mode === "register" &&
        value.trim().length < 3
      )
        invalid[field] = "用户名至少3位";
    }
    setErrors(invalid);
    setError("");
    setNotice("");
    setSimulatedResetUrl('');
    const first = fields.find((f) => invalid[f]);
    if (first) {
      document.getElementById(`${mode}-${first}`)?.focus();
      return;
    }
    const current = ++version.current;
    setBusy(true);
    try {
      if (mode === "login") {
        const user = await api<User>("/auth/login", "POST", {
          username: values.username.trim(),
          password: values.password,
        });
        if (current === version.current) onLogin(user);
      } else if (mode === "register") {
        await api("/auth/register", "POST", {
          username: values.username.trim(),
          email: values.email.trim(),
          password: values.password,
          inviteCode: values.inviteCode.trim(),
        });
        if (current !== version.current) return;
        setValues((v) => ({ ...v, password: "", confirm: "", inviteCode: "" }));
        setNotice("账号注册成功，请返回登录。");
      } else {
        const token = new URLSearchParams(
          window.location.hash.split("?")[1] || "",
        ).get("token");
        if (mode === "reset" && !token)
          throw new Error("重置链接无效，请从找回密码页面重新申请");
        const result = await api<{ message: string; simulatedResetUrl?: string }>(
          `/auth/${mode === "forgot" ? "forgot-password" : "reset-password"}`,
          "POST",
          mode === "forgot"
            ? { username: values.username.trim(), email: values.email.trim() }
            : { token, password: values.password },
        );
        if (current !== version.current) return;
        setNotice(result.message);
        if (mode === 'forgot' && /^#reset\?token=[a-f0-9]{64}$/.test(result.simulatedResetUrl || '')) setSimulatedResetUrl(result.simulatedResetUrl!);
        if (mode === "reset")
          setValues((v) => ({ ...v, password: "", confirm: "" }));
      }
    } catch (error) {
      if (current === version.current) setError((error as Error).message);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <main className="layout">
        <section className="brand-side" aria-label="爱管理平台品牌介绍">
          <header className="brand-header">
            <span className="brand-mark">爱</span>
            <span>爱管理</span>
          </header>
          <div className="hero">
            <h1>
              让项目管理
              <br />
              更清晰、更高效
            </h1>
            <p>
              统一管理项目、需求与任务，
              <br />
              让团队协作与进度跟踪井然有序。
            </p>
            <div className="preview-board" aria-hidden="true">
              <div className="board-toolbar">
                <i className="dot" />
                <i className="dot" />
                <i className="dot" />
                <span className="board-label">爱管理 / 项目工作区</span>
              </div>
              <div className="board-body">
                <div className="board-nav">
                  {[
                    "项目概览",
                    "需求管理",
                    "任务管理",
                    "项目计划",
                    "多视图工作台",
                  ].map((name, i) => (
                    <div
                      key={name}
                      className={`navrow${i === 0 ? " active" : ""}`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
                <div className="board-main">
                  <div className="board-title">
                    项目概览 <span className="pill">工作台</span>
                  </div>
                  <div className="board-sub">计划 · 协作 · 可视化</div>
                  <div className="mini-stats">
                    {["项目计划", "正式需求", "团队任务"].map((name) => (
                      <div className="stat" key={name}>
                        <b>{name}</b>
                        <div className="stat-line" />
                      </div>
                    ))}
                  </div>
                  <div className="mini-flow">
                    <div className="flow-title">项目工作视图 · 视觉示意</div>
                    <div className="flow-bars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span className="bar" key={n} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="login-side" aria-label="账户登录">
          <div className="mobile-brand">
            <span className="brand-mark">爱</span>爱管理
          </div>
          <div className="login-main">
            <section
              ref={section}
              className={`auth-view active${mode === "register" ? " compact" : ""}`}
              aria-labelledby="auth-title"
            >
              {(mode === "register" || mode === "forgot") && (
                <p className="login-label">
                  {mode === "register" ? "注册账号" : "找回密码"}
                </p>
              )}
              <h2 id="auth-title">{title}</h2>
              {(mode === "login" || mode === "register") && (
                <p className="intro">
                  {mode === "login"
                    ? "请输入账号信息，进入你的项目工作空间。"
                    : "加入团队，开始协作管理项目。"}
                </p>
              )}
              <form noValidate onSubmit={submit}>
                {fields.map((field) => {
                  const password = field === "password" || field === "confirm";
                  const id = `${mode}-${field}`;
                  return (
                    <div className="field" key={id}>
                      <label htmlFor={id}>
                        {fieldLabel(field)}
                        {mode === "register" && (
                          <span className="req-star" aria-hidden="true">
                            {" "}
                            *
                          </span>
                        )}
                      </label>
                      <div className={`control${password ? " password" : ""}`}>
                        <input
                          id={id}
                          aria-label={fieldLabel(field)}
                          name={field}
                          type={
                            password
                              ? visible[field]
                                ? "text"
                                : "password"
                              : field === "email"
                                ? "email"
                                : "text"
                          }
                          value={values[field]}
                          onChange={(e) => {
                            setValues((v) => ({
                              ...v,
                              [field]: e.target.value,
                            }));
                            setErrors((v) => ({ ...v, [field]: undefined }));
                            setNotice("");
                            setSimulatedResetUrl('');
                            setError("");
                          }}
                          placeholder={placeholder(field)}
                          maxLength={
                            field === "username"
                              ? mode === "register"
                                ? 40
                                : 80
                              : field === "email"
                                ? 254
                                : field === "inviteCode"
                                  ? 256
                                  : 128
                          }
                          autoComplete={
                            password
                              ? mode === "login"
                                ? "current-password"
                                : "new-password"
                              : field === "inviteCode"
                                ? "off"
                                : field
                          }
                          aria-invalid={!!errors[field]}
                          aria-describedby={
                            errors[field] ? `${id}-error` : undefined
                          }
                          required
                          disabled={busy}
                        />
                        {password && (
                          <button
                            type="button"
                            className="eye-btn"
                            aria-label={`${visible[field] ? "隐藏" : "显示"}${fieldLabel(field)}`}
                            aria-pressed={!!visible[field]}
                            onClick={() =>
                              setVisible((v) => ({ ...v, [field]: !v[field] }))
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {errors[field] && (
                        <div
                          id={`${id}-error`}
                          className="field-error visible"
                          role="alert"
                        >
                          {errors[field]}
                        </div>
                      )}
                    </div>
                  );
                })}
                {mode === "login" && (
                  <div className="link-row">
                    <span />
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => navigate("forgot")}
                    >
                      忘记密码？
                    </button>
                  </div>
                )}
                <button className="submit" type="submit" disabled={busy}>
                  {busy
                    ? "提交中…"
                    : {
                        login: "登 录",
                        register: "提交注册申请",
                        forgot: "申请密码重置",
                        reset: "重置密码",
                      }[mode]}
                </button>
                {mode === "login" && (
                  <div className="signup-row">
                    <span>还没有账号？</span>
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => navigate("register")}
                    >
                      注册账号
                    </button>
                  </div>
                )}
                {error && (
                  <div className="notice caution visible" role="alert">
                    {error}
                  </div>
                )}
                {notice && (
                  <div
                    className="notice visible"
                    role="status"
                    aria-live="polite"
                  >
                    {notice}
                    {simulatedResetUrl && <div className="reset-demo-link"><a className="inline-link" href={simulatedResetUrl}>打开模拟邮件中的重置链接</a></div>}
                  </div>
                )}
              </form>
              {mode !== "login" && (
                <div className="auth-actions">
                  {mode === "register" && <span>已有账号？</span>}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => navigate("login")}
                  >
                    {mode === "register" ? "" : "← "}返回登录
                  </button>
                </div>
              )}
              {mode === "register" && (
                <div className="login-hint">
                  没有邀请码？请联系项目或系统管理员
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
