import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getStore } from '@netlify/blobs';

export const cookieName = 'naozhou_editor';
export const sessionSeconds = 12 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest();
export const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export const editorPassword = () => process.env.NAOZHOU_EDITOR_PASSWORD || '';
export const sameOrigin = request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin;
const scryptAsync=promisify(scrypt);
const credentialKey='editor_credentials';
const credentialStore=()=>getStore({name:'naozhou-field-atlas',consistency:'strong'});

function validCredential(value) {
  return value?.version===1 && value.algorithm==='scrypt-v1' && Number.isInteger(value.revision) && value.revision>0 && value.revision<2147483647 &&
    typeof value.salt==='string' && /^[A-Za-z0-9_-]{43}$/.test(value.salt) && Buffer.from(value.salt,'base64url').length===32 &&
    typeof value.hash==='string' && /^[A-Za-z0-9_-]{86}$/.test(value.hash) && Buffer.from(value.hash,'base64url').length===64;
}
// Resolve once per request against the same strong-consistency store as other handlers.
// sessionKey is server-only and must never be returned in API responses or logs.
export async function resolveEditorAuth(store) {
  const secret=editorPassword();
  if (secret.length<20) return {configured:false,canChangePassword:false,sessionKey:'',revision:0,etag:undefined,authorized:()=>false,verifyPassword:async()=>false};
  const entry=await (store||credentialStore()).getWithMetadata(credentialKey,{type:'json'});
  const credential=entry?.data;
  if (entry&&!validCredential(credential)) throw Error('Invalid editor credential state.');
  const sessionKey=credential ? createHmac('sha256',secret).update('naozhou-editor-credentials:'+credential.revision+':'+credential.salt+':'+credential.hash).digest('base64url') : secret;
  return {
    configured:true,canChangePassword:true,sessionKey,revision:credential?.revision||0,etag:entry?.etag,
    authorized:(request,now=Date.now())=>authorized(request,sessionKey,now),
    verifyPassword:async candidate=>{
      if (typeof candidate!=='string' || candidate.length>2048) return false;
      if (!credential) return equal(candidate,secret);
      const derived=await scryptAsync(candidate,Buffer.from(credential.salt,'base64url'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
      return timingSafeEqual(derived,Buffer.from(credential.hash,'base64url'));
    }
  };
}
export async function changeEditorPassword(store,current,password) {
  if (!current?.configured || !Number.isInteger(current.revision) || current.revision<0 || current.revision>=2147483646) throw Error('Editor credentials cannot be updated.');
  if (typeof password!=='string' || password.length<8 || password.length>128) throw Error('编辑口令须为 8–128 个字符。');
  const salt=randomBytes(32);
  const hash=await scryptAsync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const credential={version:1,algorithm:'scrypt-v1',revision:current.revision+1,salt:salt.toString('base64url'),hash:hash.toString('base64url'),updatedAt:new Date().toISOString()};
  const saved=await store.setJSON(credentialKey,credential,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
  if (!saved.modified) return null;
  return resolveEditorAuth(store);
}

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
