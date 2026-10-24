import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAuthHandler } from '../netlify/functions/auth.mjs';
import { issueSession, authorized } from '../netlify/lib/auth.mjs';
import { recordsHandler } from '../netlify/lib/records.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

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
  const auth=createAuthHandler(()=>memoryStore());
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
test('deity catalog retains local titles, multi-title references and same-name identities',async()=>{
  const store=memoryStore(),handler=recordsHandler('deities',()=>store);
  const initial=await (await handler(new Request(origin+'/api/deities'))).json();
  assert.deepEqual(initial.titles.map(title=>title.name),['会主','境主','军主','营主','埠主','福主','褐主','案主']);
  const deity={id:'deity-one',name:'同名测试神明',aliases:['地方别称'],titleIds:['hui-zhu','jing-zhu'],description:'隔离测试',identityNote:'甲村身份',source:'test'};
  const body={...initial,records:[deity,{...deity,id:'deity-two',identityNote:'乙村不同身份'}]};
  assert.equal((await handler(request('deities',body,false))).status,401);
  const saved=await (await handler(request('deities',body))).json();
  assert.equal(saved.records.length,2);assert.equal(saved.records[0].name,saved.records[1].name);assert.notEqual(saved.records[0].id,saved.records[1].id);
  assert.deepEqual(saved.records[0].titleIds,['hui-zhu','jing-zhu']);
  assert.equal((await handler(request('deities',body))).status,409);
  assert.equal((await handler(request('deities',{...saved,titles:saved.titles.filter(title=>title.id!=='he-zhu')}))).status,400);
  assert.equal((await handler(request('deities',{...saved,records:[saved.records[0]]}))).status,400);
  const archived=await (await handler(request('deities',{...saved,records:saved.records.map(record=>record.id==='deity-one'?{...record,archivedAt:new Date().toISOString()}:record)}))).json();
  assert.equal(archived.records.length,2);assert.ok(archived.records[0].archivedAt);
});
test('ID links span villages without merging names, and old clients cannot erase links',async()=>{
  const store=memoryStore(),gods=recordsHandler('deities',()=>store),faith=recordsHandler('faith',()=>store);
  const catalog=await (await gods(new Request(origin+'/api/deities'))).json();
  await gods(request('deities',{...catalog,records:[{id:'god-a',name:'同名神明',aliases:[],titleIds:[]},{id:'god-b',name:'同名神明',aliases:[],titleIds:['bu-zhu']}]}));
  const initial=await (await faith(new Request(origin+'/api/faith'))).json();
  const first={id:'faith-a',villageId:'village-a',villageKind:'reference',villageName:'测试甲村',deities:['当地同名','当地同名'],temple:'测试宫庙',festival:'测试祭期',source:'隔离测试',note:'原笔记',deityLinks:[{id:'link-a',deityId:'god-a',nameIndex:0,localName:'地方称谓甲',localTitle:'会主'},{id:'link-b',deityId:'god-b',nameIndex:1,localName:'地方称谓乙',localTitle:'埠主'}]};
  const second={...first,id:'faith-b',villageId:'village-b',villageName:'测试乙村',deities:['别称'],deityLinks:[{id:'link-c',deityId:'god-a',nameIndex:0,localName:'乙村别称',localTitle:'境主'}]};
  let saved=await (await faith(request('faith',{...initial,records:initial.records.concat(first,second)}))).json();
  assert.deepEqual(saved.records[0].deities,initial.records[0].deities);assert.equal(saved.records[0].deityLinks,undefined);
  assert.deepEqual(saved.records.find(item=>item.id==='faith-a').deities,['当地同名','当地同名']);
  const context={window:{}};runInNewContext(await readFile(new URL('../deity-catalog.js',import.meta.url),'utf8'),context);
  const villages=context.window.DeityAtlas.villagesFor('god-a',saved.records);
  assert.equal(villages.length,2);assert.equal(villages[0].records.length,1);
  assert.equal(villages.flatMap(v=>v.records.flatMap(item=>item.links)).length,2);
  const legacy=saved.records.map(item=>{const {deityLinks,...rest}=item;return {...rest,note:'仅修改旧字段'};});
  saved=await (await faith(request('faith',{...saved,records:legacy}))).json();
  assert.equal(saved.records.find(item=>item.id==='faith-a').deityLinks[0].deityId,'god-a');
  assert.equal((await faith(request('faith',{...saved,records:legacy.map(item=>item.id==='faith-a'?{...item,deities:['改名']}:item)}))).status,400);
  assert.equal((await faith(request('faith',{...saved,records:saved.records.map(item=>item.id==='faith-a'?{...item,deityLinks:[{id:'bad-link',deityId:'missing-god',nameIndex:0}]}:item)}))).status,400);
  const catalogNow=await (await gods(new Request(origin+'/api/deities'))).json();
  await gods(request('deities',{...catalogNow,records:catalogNow.records.map(record=>({...record,archivedAt:new Date().toISOString()}))}));
  const reopened=await (await faith(new Request(origin+'/api/faith'))).json();
  assert.equal(reopened.records.find(item=>item.id==='faith-a').deityLinks.length,2);
});
test('deity map relations deduplicate stable places and retain records without coordinates',async()=>{
  const context={window:{},URLSearchParams};runInNewContext(await readFile(new URL('../deity-catalog.js',import.meta.url),'utf8'),context);
  const A=context.window.DeityAtlas;
  const record={id:'map-record-a',villageId:'village-a',villageKind:'reference',villageName:'同名村',deities:['当地称谓'],deityLinks:[{id:'map-link-a',deityId:'deity-map',nameIndex:0}]};
  const records=[record,{...record,id:'map-record-b',deityLinks:[{id:'map-link-b',deityId:'deity-map',nameIndex:0}]},{...record,id:'map-record-c',villageId:'village-b'},{...record,id:'map-record-missing',villageId:'missing-village'},{...record,id:'other-god',villageId:'other-village',deityLinks:[{id:'other-link',deityId:'other-deity',nameIndex:0}]}];
  const before=JSON.stringify(records);
  const result=A.locatedVillagesFor('deity-map',records,(_kind,id)=>id==='village-a'?{id,lat:20.9,lng:110.58}:id==='village-b'?{id,lat:NaN,lng:110.6}:null);
  assert.equal(result.length,3);assert.equal(result.filter(village=>village.point).length,1);
  assert.equal(result.find(village=>village.id==='village-a').records.length,2);
  assert.equal(JSON.stringify(records),before);
  assert.equal(A.locatedVillagesFor('unknown',records,()=>null).length,0);
  const profile=new URL(A.profileURL('stable deity','return-token'),'https://atlas.example');
  assert.equal(profile.searchParams.get('id'),'stable deity');assert.equal(profile.searchParams.get('mapReturn'),'return-token');
  const map=new URL(A.exploreURL('stable deity','return-token'),'https://atlas.example');
  assert.equal(map.searchParams.get('deity'),'stable deity');assert.equal(map.searchParams.get('mapReturn'),'return-token');
});
