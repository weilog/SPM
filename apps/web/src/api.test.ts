import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, RequestError } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('REST client contract', () => {
  it('uses same-origin cookies and the anti-CSRF custom header', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetch);
    await api('/auth/logout', 'POST', {});
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ 'X-SPM-Request': '1' }), method: 'POST', body: '{}' }));
  });
  it('preserves error status and validation messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: ['required', 'invalid'] }) }));
    await expect(api('/projects', 'POST', {})).rejects.toEqual(new RequestError(400, 'required；invalid'));
  });
});
