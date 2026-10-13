import { hashPassword, verifyPassword } from '../src/auth/password';
describe('Password storage', () => {
  it('hashes with random salts and verifies only correct passwords', async () => {
    const a = await hashPassword('test-password-strong');
    const b = await hashPassword('test-password-strong');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('test-password-strong');
    expect(await verifyPassword('test-password-strong', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('anything', 'invalid')).toBe(false);
  });
});
