import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Login } from "./Login";
import { api, RequestError } from "./api";
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: vi.fn(),
}));
const mocked = vi.mocked(api);
beforeEach(() => {
  mocked.mockReset();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
describe("V4.3 authentication pages", () => {
  it('opens the explicitly simulated mail link on the reset-password screen', async () => {
    window.history.replaceState(null, '', '/#forgot');
    const token = 'b'.repeat(64);
    mocked.mockResolvedValue({ message: '模拟邮件已生成，未发送真实邮件。', simulatedResetUrl: '#reset?token=' + token });
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('用户名'), 'member');
    await userEvent.type(screen.getByLabelText('已绑定邮箱'), 'member@example.test');
    await userEvent.click(screen.getByRole('button', { name: '申请密码重置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('未发送真实邮件');
    await userEvent.click(screen.getByRole('link', { name: '打开模拟邮件中的重置链接' }));
    expect(await screen.findByRole('heading', { name: '设置新密码' })).toBeInTheDocument();
  });
  it("keeps the confirmed login/register/forgot pages and restores hash navigation", async () => {
    render(<Login onLogin={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "欢迎登录爱管理" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "注册账号" }));
    expect(
      screen.getByRole("heading", { name: "注册爱管理账号" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("管理员邀请码")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回登录" }));
    await userEvent.click(screen.getByRole("button", { name: "忘记密码？" }));
    expect(screen.getByLabelText("已绑定邮箱")).toBeInTheDocument();
    expect(screen.queryByLabelText("新密码")).not.toBeInTheDocument();
  });
  it("validates registration confirmation before submitting only the confirmed registration fields", async () => {
    window.history.replaceState(null, "", "/#register");
    mocked.mockResolvedValue({});
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("用户名"), "new_member");
    await userEvent.type(screen.getByLabelText("邮箱"), "new@example.test");
    await userEvent.type(
      screen.getByLabelText("设置密码"),
      "long-password-123",
    );
    await userEvent.type(
      screen.getByLabelText("确认密码"),
      "different-password",
    );
    await userEvent.type(
      screen.getByLabelText("管理员邀请码"),
      "private-invite",
    );
    await userEvent.click(screen.getByRole("button", { name: "提交注册申请" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(mocked).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("确认密码"));
    await userEvent.type(
      screen.getByLabelText("确认密码"),
      "long-password-123",
    );
    await userEvent.click(screen.getByRole("button", { name: "显示设置密码" }));
    expect(screen.getByLabelText("设置密码")).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "提交注册申请" }));
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/auth/register", "POST", {
        username: "new_member",
        email: "new@example.test",
        password: "long-password-123",
        inviteCode: "private-invite",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("账号注册成功");
  });
  it("shows disabled simulation errors without claiming a sent message", async () => {
    window.history.replaceState(null, "", "/#forgot");
    mocked.mockRejectedValue(
      new RequestError(503, "模拟密码找回尚未启用"),
    );
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("用户名"), "member");
    await userEvent.type(
      screen.getByLabelText("已绑定邮箱"),
      "member@example.test",
    );
    await userEvent.click(screen.getByRole("button", { name: "申请密码重置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模拟密码找回尚未启用",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("uses the reset email token and requires matching 12-character passwords", async () => {
    const token = "a".repeat(64);
    window.history.replaceState(null, "", "/#reset?token=" + token);
    mocked.mockResolvedValue({ message: "密码已重置，请使用新密码登录。" });
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("新密码"), "new-password-123");
    await userEvent.type(
      screen.getByLabelText("确认新密码"),
      "new-password-123",
    );
    await userEvent.click(screen.getByRole("button", { name: "重置密码" }));
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/auth/reset-password", "POST", {
        token,
        password: "new-password-123",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("密码已重置");
  });
  it("rejects direct resets without a token", async () => {
    window.history.replaceState(null, "", "/#reset");
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("新密码"), "new-password-123");
    await userEvent.type(
      screen.getByLabelText("确认新密码"),
      "new-password-123",
    );
    await userEvent.click(screen.getByRole("button", { name: "重置密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重置链接无效");
    expect(mocked).not.toHaveBeenCalled();
  });
});
