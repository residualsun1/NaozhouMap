import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import auth from '../netlify/functions/auth.mjs';
import { issueSession, authorized } from '../netlify/lib/auth.mjs';
import { recordsHandler } from '../netlify/lib/records.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://atlas.example';
const cookie=()=>`naozhou_editor=${issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)}`;
function request(kind, body, authenticated=true) {
  return new Request(`${origin}/api/${kind}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(authenticated?{Cookie:cookie()}:{})},body:JSON.stringify(body)});
}
function memoryStore() {
  const entries=new Map();let sequence=0;
  return {
    async getWithMetadata(key) {return structuredClone(entries.get(key)||null);},
    async setJSON(key,data,options) {
      const previous=entries.get(key);
      if ((options.onlyIfNew&&previous)||(options.onlyIfMatch&&options.onlyIfMatch!==previous?.etag)) return {modified:false};
      const etag=String(++sequence);entries.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
    }
  };
}
const point={id:'isolated-test-point',name:'隔离测试',lng:110.58,lat:20.9,source:'test',note:'',createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z'};

test('only a valid, unexpired editor session can write',async()=>{
  const handler=recordsHandler('points',()=>memoryStore());
  assert.equal((await handler(request('points',{revision:5,points:[]},false))).status,401);
  const expired=issueSession(process.env.NAOZHOU_EDITOR_PASSWORD,Date.now()-13*60*60*1000);
  assert.equal(authorized(new Request(origin,{headers:{Cookie:`naozhou_editor=${expired}`}})),false);
  const wrongOrigin=request('points',{revision:5,points:[]});
  wrongOrigin.headers.set('Origin','https://other.example');
  assert.equal((await handler(wrongOrigin)).status,401);
});
test('login uses an HTTP-only cookie and logout clears it',async()=>{
  assert.equal((await auth(request('auth',{password:'wrong'}))).status,401);
  const response=await auth(request('auth',{password:process.env.NAOZHOU_EDITOR_PASSWORD}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(authorized(new Request(origin,{headers:{Cookie:response.headers.get('set-cookie')}})),true);
  assert.match((await auth(new Request(origin+'/api/auth',{method:'DELETE'}))).headers.get('set-cookie'),/Max-Age=0/);
});
test('existing deity IDs and records are available before first cloud save',async()=>{
  const handler=recordsHandler('faith',()=>memoryStore());
  const current=await (await handler(new Request(origin+'/api/faith'))).json();
  assert.equal(current.records[0].id,'d990865b-472c-4726-8c36-024347afca04');
  assert.equal(current.records[0].deities.length,6);
});
test('saved records persist and stale revisions cannot overwrite them',async()=>{
  const store=memoryStore(),handler=recordsHandler('points',()=>store);
  const initial=await (await handler(new Request(origin+'/api/points'))).json();
  const saved=await handler(request('points',{revision:initial.revision,points:[point]}));
  assert.equal(saved.status,200);
  const stale=await handler(request('points',{revision:initial.revision,points:[]}));
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).points[0].id,point.id);
  const persisted=await (await handler(new Request(origin+'/api/points'))).json();
  assert.equal(persisted.points[0].name,point.name);
});
test('concurrent first saves retain exactly one revision',async()=>{
  const store=memoryStore(),handler=recordsHandler('points',()=>store);
  const current=await (await handler(new Request(origin+'/api/points'))).json();
  const results=await Promise.all([handler(request('points',{revision:current.revision,points:[point]})),handler(request('points',{revision:current.revision,points:[]}))]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
});
test('invalid coordinates and retired IDs cannot enter cloud records',async()=>{
  const store=memoryStore(),handler=recordsHandler('points',()=>store);
  const current=await (await handler(new Request(origin+'/api/points'))).json();
  assert.equal((await handler(request('points',{revision:current.revision,points:[{...point,lat:100}]}))).status,400);
  assert.equal((await handler(request('points',{revision:current.revision,points:[{...point,id:current.deletedIds[0]}]}))).status,422);
});
test('village introduction and notes persist independently without a deity record',async()=>{
  const store=memoryStore(),handler=recordsHandler('archives',()=>store);
  const initial=await (await handler(new Request(origin+'/api/archives'))).json();
  assert.equal(initial.records.length,0);
  const record={id:'isolated-archive',villageId:'isolated-village',villageKind:'reference',villageName:'隔离测试村庄',introduction:'隔离测试简介\n第二段',note:'隔离测试田野笔记'};
  assert.equal((await handler(request('archives',{version:1,revision:initial.revision,records:[record]},false))).status,401);
  const first=await (await handler(request('archives',{version:1,revision:initial.revision,records:[record]}))).json();
  assert.equal(first.records[0].introduction,record.introduction);
  const second=await handler(request('archives',{version:1,revision:first.revision,records:[{...first.records[0],note:'仅修改笔记'}]}));
  assert.equal(second.status,200);
  const reopened=await (await handler(new Request(origin+'/api/archives'))).json();
  assert.equal(reopened.records[0].note,'仅修改笔记');
  assert.equal(reopened.records[0].introduction,record.introduction);
  assert.equal((await handler(request('archives',{version:1,revision:first.revision,records:[]}))).status,409);
  assert.equal((await (await recordsHandler('faith',()=>store)(new Request(origin+'/api/faith'))).json()).records[0].deities.length,6);
});
test('village archives reject oversized text and duplicate place links',async()=>{
  const store=memoryStore(),handler=recordsHandler('archives',()=>store);
  const record={id:'archive-a',villageId:'same-village',villageKind:'reference',villageName:'隔离测试',introduction:'',note:''};
  assert.equal((await handler(request('archives',{version:1,revision:0,records:[{...record,note:'a'.repeat(20001)}]}))).status,400);
  assert.equal((await handler(request('archives',{version:1,revision:0,records:[record,{...record,id:'archive-b'}]}))).status,400);
});
