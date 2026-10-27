import type { ApiError } from '@spm/shared';
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-SPM-Request': '1' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  if (!response.ok) {
    const body = await response.json() as ApiError;
    throw new RequestError(response.status, Array.isArray(body.message) ? body.message.join('；') : body.message);
  }
  return response.json() as Promise<T>;
}
