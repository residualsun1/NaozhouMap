import { getStore } from '@netlify/blobs';
import { changeEditorPassword, issueSession, json, resolveEditorAuth, sameOrigin, sessionCookie } from '../lib/auth.mjs';

export function createAuthHandler(storeFactory=()=>getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request=>{
    if (!['GET','POST','PUT','DELETE'].includes(request.method)) return json({error:'Method not allowed.'},405,{Allow:'GET, POST, PUT, DELETE'});
    if (request.method!=='GET'&&!sameOrigin(request)) return json({error:'请从地图页面操作。'},403);
    if (request.method==='DELETE') return json({editable:false},200,{'Set-Cookie':sessionCookie('',0)});
    try {
      const store=storeFactory(),auth=await resolveEditorAuth(store);
      if (request.method==='GET') return json({cloud:true,editable:auth.authorized(request),configured:auth.configured,canChangePassword:auth.canChangePassword});
      if (!auth.configured) return json({error:'云端尚未配置编辑口令。'},503);
      if (request.method==='PUT'&&!auth.authorized(request)) return json({error:'请先登录编辑后再修改口令。'},401);
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) return json({error:'Use application/json.'},415);
      if (Number(request.headers.get('content-length'))>8192) return json({error:'请求过长。'},413);
      const raw=await request.text();
      if (Buffer.byteLength(raw)>8192) return json({error:'请求过长。'},413);
      let body;
      try {body=JSON.parse(raw);if (!body||typeof body!=='object'||Array.isArray(body)) throw Error();}
      catch{return json({error:'无法读取登录信息。'},400);}
      if (request.method==='POST') {
        if (!await auth.verifyPassword(body.password)) return json({error:'编辑口令不正确。'},401);
        return json({editable:true},200,{'Set-Cookie':sessionCookie(issueSession(auth.sessionKey))});
      }
      if (typeof body.newPassword!=='string'||body.newPassword.length<8||body.newPassword.length>128) return json({error:'新口令须为 8–128 个字符。'},400);
      if (body.confirmation!==body.newPassword) return json({error:'两次输入的新口令不一致。'},400);
      if (!await auth.verifyPassword(body.currentPassword)) return json({error:'当前编辑口令不正确。'},401);
      const next=await changeEditorPassword(store,auth,body.newPassword);
      if (!next) return json({error:'口令已在其他页面修改，请重新登录后再试。'},409);
      return json({editable:true,changed:true},200,{'Set-Cookie':sessionCookie(issueSession(next.sessionKey))});
    } catch {
      // Never log submitted passwords, credential hashes or session keys.
      return json({error:'编辑权限暂时无法读取或更新，请稍后重试。'},503);
    }
  };
}
export default createAuthHandler();
export const config={path:'/api/auth'};
