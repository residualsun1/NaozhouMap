import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const cookieName = 'naozhou_editor';
export const sessionSeconds = 12 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest();
export const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export const editorPassword = () => process.env.NAOZHOU_EDITOR_PASSWORD || '';
export const sameOrigin = request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin;

function signature(expiry, password) {
  return createHmac('sha256', password).update('naozhou-editor:' + expiry).digest('base64url');
}
export function issueSession(password, now = Date.now()) {
  const expiry = String(Math.floor(now / 1000) + sessionSeconds);
  return expiry + '.' + signature(expiry, password);
}
export function authorized(request, password = editorPassword(), now = Date.now()) {
  if (!password) return false;
  const entry = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  if (!entry) return false;
  const value = entry.slice(cookieName.length + 1);
  if (value.split('.').length !== 2) return false;
  const [expiry, token] = value.split('.');
  const seconds = Math.floor(now / 1000);
  return /^\d{10,12}$/.test(expiry || '') && token?.length === 43 && Number(expiry) > seconds &&
    Number(expiry) <= seconds + sessionSeconds && equal(token, signature(expiry, password));
}
export function sessionCookie(value, maxAge = sessionSeconds) {
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers}});
}
