import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAuthHandler } from '../netlify/functions/auth.mjs';
import { authorized, issueSession, resolveEditorAuth } from '../netlify/lib/auth.mjs';
import { recordsHandler } from '../netlify/lib/records.mjs';
import { peopleHandler } from '../netlify/lib/people.mjs';
import { fieldJournalHandler } from '../netlify/lib/field-journal.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://auth-password-test.example';
const legacyPassword=()=>process.env.NAOZHOU_EDITOR_PASSWORD;
const legacyCookie=()=>`naozhou_editor=${issueSession(legacyPassword())}`;
function memoryStore() {
  const entries=new Map();let sequence=0;
  return {
    async getWithMetadata(key){return structuredClone(entries.get(key)||null);},
    async setJSON(key,data,options={}) {
      const previous=entries.get(key);
      if ((options.onlyIfNew&&previous)||(options.onlyIfMatch&&options.onlyIfMatch!==previous?.etag)) return {modified:false};
      const etag=String(++sequence);entries.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
    }
  };
}
function request(method='GET',body,cookie='') {
  return new Request(origin+'/api/auth',{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
const replacement={currentPassword:'',newPassword:'12345678',confirmation:'12345678'};
test('legacy environment login and synchronous session helpers stay compatible before customization',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store),resolved=await resolveEditorAuth(store);
  assert.equal(resolved.configured,true);assert.equal(resolved.revision,0);
  assert.equal(resolved.authorized(request('GET',null,legacyCookie())),true);
  const response=await auth(request('POST',{password:legacyPassword()}));
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(authorized(request('GET',null,response.headers.get('set-cookie'))),true);
  assert.equal((await auth(request('POST',{password:'wrong'}))).status,401);
  assert.deepEqual(await(await auth(request())).json(),{cloud:true,editable:false,configured:true,canChangePassword:true});
  assert.match((await auth(request('DELETE'))).headers.get('set-cookie'),/Max-Age=0/);
});
test('only an authenticated same-origin editor with current password and matching confirmation may change it',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store),change={...replacement,currentPassword:legacyPassword()};
  assert.equal((await auth(request('PUT',change))).status,401);
  const cross=request('PUT',change,legacyCookie());cross.headers.set('Origin','https://other.example');
  assert.equal((await auth(cross)).status,403);
  assert.equal((await auth(request('PUT',{...change,currentPassword:'incorrect'},legacyCookie()))).status,401);
  assert.equal((await auth(request('PUT',{...change,confirmation:'different'},legacyCookie()))).status,400);
  assert.equal((await auth(request('PUT',{...change,newPassword:'1234567',confirmation:'1234567'},legacyCookie()))).status,400);
  assert.equal((await auth(request('PUT',{...change,newPassword:'x'.repeat(129),confirmation:'x'.repeat(129)},legacyCookie()))).status,400);
  assert.equal(await store.getWithMetadata('editor_credentials'),null);
});
test('eight-character passwords use salted scrypt; old environment login and old cookies are revoked',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store),business={version:1,revision:7,records:[{id:'keep-me'}]};
  await store.setJSON('people',business);
  const oldCookie=legacyCookie(),changed=await auth(request('PUT',{...replacement,currentPassword:legacyPassword()},oldCookie));
  assert.equal(changed.status,200);
  assert.deepEqual(await changed.clone().json(),{editable:true,changed:true});
  const newCookie=changed.headers.get('set-cookie'),stored=(await store.getWithMetadata('editor_credentials')).data;
  assert.equal(stored.algorithm,'scrypt-v1');assert.equal(stored.revision,1);
  assert.equal(Buffer.from(stored.salt,'base64url').length,32);assert.equal(Buffer.from(stored.hash,'base64url').length,64);
  assert.equal(JSON.stringify(stored).includes(replacement.newPassword),false);
  assert.equal(JSON.stringify(stored).includes(legacyPassword()),false);
  const resolved=await resolveEditorAuth(store);
  assert.equal(resolved.authorized(request('GET',null,oldCookie)),false);
  assert.equal(resolved.authorized(request('GET',null,newCookie)),true);
  assert.equal(await resolved.verifyPassword(legacyPassword()),false);
  assert.equal(await resolved.verifyPassword(replacement.newPassword),true);
  assert.equal((await auth(request('POST',{password:legacyPassword()}))).status,401);
  const login=await auth(request('POST',{password:replacement.newPassword}));assert.equal(login.status,200);
  const anonymousState=await(await auth(request())).json();assert.equal(anonymousState.sessionKey,undefined);assert.equal(anonymousState.hash,undefined);
  assert.equal((await(await auth(request('GET',null,oldCookie))).json()).editable,false);
  assert.equal((await(await auth(request('GET',null,newCookie))).json()).editable,true);
  assert.deepEqual((await store.getWithMetadata('people')).data,business);
});
test('credential CAS prevents concurrent changes and every successful change revokes the prior session',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store),cookie=legacyCookie();
  const responses=await Promise.all(['11111111','22222222'].map(password=>auth(request('PUT',{currentPassword:legacyPassword(),newPassword:password,confirmation:password},cookie))));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  const accepted=responses.findIndex(response=>response.status===200),firstPassword=['11111111','22222222'][accepted],firstCookie=responses[accepted].headers.get('set-cookie');
  const first=(await store.getWithMetadata('editor_credentials')).data;
  const second=await auth(request('PUT',{currentPassword:firstPassword,newPassword:'33333333',confirmation:'33333333'},firstCookie));assert.equal(second.status,200);
  const latest=(await store.getWithMetadata('editor_credentials')).data;
  assert.equal(latest.revision,2);assert.notEqual(latest.salt,first.salt);assert.notEqual(latest.hash,first.hash);
  const resolved=await resolveEditorAuth(store);assert.equal(resolved.authorized(request('GET',null,firstCookie)),false);
  assert.equal((await auth(request('POST',{password:firstPassword}))).status,401);
  assert.equal((await auth(request('POST',{password:'33333333'}))).status,200);
});
test('unreadable or malformed custom credentials fail closed instead of reverting to the environment password',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store);
  await store.setJSON('editor_credentials',{version:1,revision:1,algorithm:'scrypt-v1',salt:'broken',hash:'broken'});
  assert.equal((await auth(request('POST',{password:legacyPassword()}))).status,503);
  assert.equal((await auth(request('GET',null,legacyCookie()))).status,503);
  const failed=createAuthHandler(()=>({getWithMetadata:async()=>{throw Error('storage offline');}}));
  assert.equal((await failed(request('POST',{password:legacyPassword()}))).status,503);
  assert.equal((await failed(request('DELETE'))).status,200);
});

test('all data APIs honor the custom session and reject the revoked cookie',async()=>{
  const store=memoryStore(),auth=createAuthHandler(()=>store),oldCookie=legacyCookie();
  const change=await auth(request('PUT',{...replacement,currentPassword:legacyPassword()},oldCookie));assert.equal(change.status,200);
  const newCookie=change.headers.get('set-cookie');
  for(const [route,handler] of [['points',recordsHandler('points',()=>store)],['faith',recordsHandler('faith',()=>store)],['deities',recordsHandler('deities',()=>store)],['archives',recordsHandler('archives',()=>store)],['people',peopleHandler(()=>store)],['field-entries',fieldJournalHandler(()=>store)]]){
    const apiRequest=cookie=>new Request(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
    assert.equal((await handler(apiRequest(oldCookie))).status,401,route+' must reject old sessions');
    assert.equal((await handler(apiRequest(newCookie))).status,400,route+' must authorize the new session before validating the body');
    if(['people','field-entries'].includes(route)){
      const old=await(await handler(new Request(origin+'/api/'+route,{headers:{Cookie:oldCookie}}))).json();assert.equal(old.editable,false);
      const current=await(await handler(new Request(origin+'/api/'+route,{headers:{Cookie:newCookie}}))).json();assert.equal(current.editable,true);
    }
  }
});
