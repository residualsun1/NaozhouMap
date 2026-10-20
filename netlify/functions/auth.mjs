import { authorized, editorPassword, equal, issueSession, json, sameOrigin, sessionCookie } from '../lib/auth.mjs';

export default async request => {
  const password = editorPassword();
  if (request.method === 'GET') return json({cloud:true, editable:authorized(request), configured:password.length >= 20});
  if (!sameOrigin(request)) return json({error:'请从地图页面操作。'},403);
  if (request.method === 'DELETE') return json({editable:false},200, {'Set-Cookie':sessionCookie('',0)});
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405, {Allow:'GET, POST, DELETE'});
  if (password.length < 20) return json({error:'云端尚未配置编辑口令。'},503);
  if (Number(request.headers.get('content-length')) > 2048) return json({error:'请求过长。'},413);
  try {
    const text = await request.text();
    if (text.length > 2048) return json({error:'请求过长。'},413);
    const body = JSON.parse(text);
    if (typeof body.password !== 'string' || !equal(body.password,password)) return json({error:'编辑口令不正确。'},401);
    return json({editable:true},200, {'Set-Cookie':sessionCookie(issueSession(password))});
  } catch { return json({error:'无法读取登录信息。'},400); }
};

export const config = {path:'/api/auth'};
