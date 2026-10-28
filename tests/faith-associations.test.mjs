import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {recordsHandler} from '../netlify/lib/records.mjs';
import {createArchiveStore} from '../netlify/lib/archive-store.mjs';
import {issueSession} from '../netlify/lib/auth.mjs';
import {deitySeed} from '../netlify/lib/deities.mjs';
import {faithPlaceIndex} from '../netlify/lib/faith-associations.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://faith-test.example',stamp='2025-01-02T00:00:00.000Z',deityId='isolated-batch-deity';
const villages=faithPlaceIndex.places.filter(p=>p.placeKind==='natural_village'&&!p.parentVillageId);
const first=villages.find(p=>p.administrativeAreaId==='menggang');
const second=villages.find(p=>p.administrativeAreaId==='beigang');
const third=villages.find(p=>p.administrativeAreaId==='tanbei');
const existing={id:'rich-faith',villageId:first.id,villageKind:'reference',villageName:first.name,
  deities:['当地原称谓'],deityLinks:[{id:'rich-link',deityId,nameIndex:0,localName:'原称谓',localTitle:'军主'}],
  temple:'原有宫庙',festival:'正月十五',source:'访谈来源',visitedOn:'2025-01-02',note:'原始访谈正文\n原样保留',createdAt:stamp,updatedAt:stamp};
function memoryStore(){
  const entries=new Map();let sequence=0;
  return {entries,async getWithMetadata(key){return structuredClone(entries.get(key)||null);},
    async setJSON(key,data,options={}){const old=entries.get(key);if((options.onlyIfNew&&old)||(options.onlyIfMatch&&old?.etag!==options.onlyIfMatch))return{modified:false};const etag=String(++sequence);entries.set(key,{data:structuredClone(data),etag});return{modified:true,etag};}};
}
function post(body,authenticated=true){return new Request(origin+'/api/faith',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(authenticated?{Cookie:'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)}:{})},body:JSON.stringify(body)});}
const batch=(placeIds,action='link-villages')=>({version:1,action,deityId,placeIds});
async function fixture(records=[existing]){
  const store=memoryStore(),catalog=structuredClone(deitySeed);
  catalog.records=[{id:deityId,name:'隔离测试神明',aliases:[],titleIds:['jun-zhu'],description:'',identityNote:'',source:'',createdAt:stamp,updatedAt:stamp}];
  await store.setJSON('deities',catalog);
  await store.setJSON('faith',{version:1,revision:7,records:structuredClone(records)});
  await store.setJSON('people',{version:1,revision:3,records:[{id:'isolated-person',displayName:'人物资料保持原样',deityIds:[],placeLinks:[]}]});
  await store.setJSON('field_entries',{version:1,revision:4,records:[{id:'isolated-journal',placeId:first.id,placeKind:'reference',content:'田野原文',deityIds:[],peopleLinks:[]}]});
  return {store,handler:recordsHandler('faith',()=>store)};
}
const snapshot=async store=>(await createArchiveStore(store).getSnapshot()).states;
const browser={window:{}};
runInNewContext(await readFile(new URL('../deity-villages.js',import.meta.url),'utf8'),browser);
runInNewContext(await readFile(new URL('../deity-catalog.js',import.meta.url),'utf8'),browser);

test('village selection uses actual types and stable area IDs, and keeps cross-area pending choices',()=>{
  const selection=browser.window.DeityVillageLinks.createSelection(faithPlaceIndex,[existing],deityId);
  const menggang=selection.rows('menggang'),beigang=selection.rows('beigang');
  assert.ok(menggang.length>0&&beigang.length>0);
  assert.ok(menggang.every(p=>p.administrativeAreaId==='menggang'&&p.placeKind==='natural_village'&&!p.parentVillageId));
  selection.selectRows(menggang);assert.equal(selection.pending.size,menggang.length-1);
  assert.equal(selection.pending.has(first.id),false);assert.equal(selection.isExisting(first.id),true);
  const removed=menggang.find(p=>p.id!==first.id);selection.toggle(removed.id,false);
  selection.selectRows(beigang);assert.equal(selection.pending.size,menggang.length-2+beigang.length);
  assert.equal(selection.rows('beigang',second.name)[0].id,second.id);
  selection.clearRows(selection.rows('beigang',second.name));
  assert.equal(selection.pending.has(second.id),false);assert.equal(selection.pending.has(removed.id),false);
  assert.equal(selection.pending.size,menggang.length-2+beigang.length-1);
  selection.toggle(first.id,false);assert.equal(selection.isExisting(first.id),true);
  selection.rows('tanbei','无结果');assert.equal(selection.pending.size,menggang.length-2+beigang.length-1);
});

test('unassigned villages remain accessible, and sub-village localities are excluded',()=>{
  const index={administrativeAreas:[],places:[{id:'unknown',name:'无归属村',placeKind:'natural_village',administrativeAreaId:''},{id:'part',name:'子聚居点',placeKind:'locality',parentVillageId:'unknown'},{id:'seat',name:'驻地',placeKind:'administrative_seat'}]};
  const selection=browser.window.DeityVillageLinks.createSelection(index,[],deityId);
  assert.equal(selection.rows('__unassigned').length,1);assert.equal(selection.areaName(index.places[0]),'归属待完善');
  selection.toggle('part',true);selection.toggle('seat',true);assert.equal(selection.pending.size,0);
});

test('public index is read-only, while preview and save require the existing editor session',async()=>{
  const {store,handler}=await fixture();const before=store.entries.size;
  const response=await handler(new Request(origin+'/api/faith?view=places'));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),faithPlaceIndex);assert.equal(store.entries.size,before);
  for(const action of ['preview-villages','link-villages'])assert.equal((await handler(post(batch([second.id],action),false))).status,401);
  const foreign=post(batch([second.id]));foreign.headers.set('Origin','https://other.example');assert.equal((await handler(foreign)).status,401);
});

test('preview writes nothing; batch appends minimal records and preserves rich faith, people and journals',async()=>{
  const {store,handler}=await fixture(),before=await snapshot(store),size=store.entries.size;
  const preview=await (await handler(post(batch([first.id,second.id,third.id,second.id],'preview-villages')))).json();
  assert.deepEqual(preview.toAdd,[second.id,third.id]);assert.deepEqual(preview.existing,[first.id]);assert.equal(store.entries.size,size);
  const result=await (await handler(post(batch([first.id,second.id,third.id,second.id])))).json();
  assert.deepEqual(result.added,[second.id,third.id]);assert.deepEqual(result.existing,[first.id]);assert.deepEqual(result.failed,[]);
  const after=await snapshot(store);assert.deepEqual(after.faith.records[0],existing);
  assert.deepEqual(after.deities,before.deities);assert.deepEqual(after.people,before.people);assert.deepEqual(after.field_entries,before.field_entries);
  assert.equal(after.faith.revision,8);assert.equal(after.faith.records.length,3);
  for(const record of after.faith.records.slice(1)){assert.equal(record.deityLinks[0].deityId,deityId);assert.equal(record.deities[0],'隔离测试神明');assert.equal(record.visitedOn,'');assert.equal(browser.window.DeityAtlas.faithDetailsPending(record),true);}
  const related=browser.window.DeityAtlas.locatedVillagesFor(deityId,after.faith.records,(_kind,id)=>({id,lng:110.58,lat:20.9}));
  assert.equal(related.length,3);assert.ok(related.every(v=>v.point));
});

test('repeat submits and a second detailed observation do not duplicate or merge the basic link',async()=>{
  const richer={...existing,id:'other-temple',temple:'另一宫庙',deityLinks:[{...existing.deityLinks[0],id:'other-link'}]};
  const {store,handler}=await fixture([existing,richer]);
  await handler(post(batch([second.id])));const before=await snapshot(store);
  const result=await (await handler(post(batch([first.id,second.id,second.id])))).json();
  assert.deepEqual(result.added,[]);assert.deepEqual(result.existing,[first.id,second.id]);
  assert.deepEqual((await snapshot(store)).faith,before.faith);
  assert.equal(browser.window.DeityAtlas.villagesFor(deityId,before.faith.records).length,2);
  assert.equal(before.faith.records.filter(r=>r.villageId===first.id).length,2);
});

test('legacy names are preserved and never interpreted as a deity ID association',async()=>{
  const legacy={...existing,id:'legacy-name-only',deities:['隔离测试神明']};delete legacy.deityLinks;
  const {store,handler}=await fixture([legacy]);
  const result=await (await handler(post(batch([first.id])))).json();assert.deepEqual(result.added,[first.id]);
  const records=(await snapshot(store)).faith.records;assert.equal(records.length,2);assert.deepEqual(records[0],legacy);
});

test('invalid/non-natural targets have truthful per-item failures and valid targets still save',async()=>{
  const {store,handler}=await fixture(),seat=faithPlaceIndex.places.find(p=>p.placeKind==='administrative_seat');
  const result=await (await handler(post(batch(['missing-place',seat.id,second.id])))).json();
  assert.deepEqual(result.added,[second.id]);assert.deepEqual(result.failed.map(f=>f.placeId),['missing-place',seat.id]);
  assert.equal((await snapshot(store)).faith.records.length,2);
  assert.equal((await handler(post({...batch([]),placeIds:[null]}))).status,400);
  assert.equal((await handler(post({...batch([]),deityId:'missing-deity'}))).status,404);
});

test('another editor adding a previewed village is recognized at confirmation',async()=>{
  const {store,handler}=await fixture();await handler(post(batch([second.id,third.id],'preview-villages')));
  await recordsHandler('faith',()=>store)(post(batch([second.id])));
  const result=await (await handler(post(batch([second.id,third.id])))).json();
  assert.deepEqual(result.added,[third.id]);assert.deepEqual(result.existing,[second.id]);assert.equal((await snapshot(store)).faith.records.length,3);
});

test('simultaneous batches retry the manifest CAS without losing observations or duplicating a village',async()=>{
  const {store,handler}=await fixture();const other=recordsHandler('faith',()=>store);
  const responses=await Promise.all([handler(post(batch([second.id,third.id]))),other(post(batch([second.id])))]);
  assert.ok(responses.every(r=>r.status===200));const after=await snapshot(store);
  assert.equal(after.faith.records.length,3);assert.deepEqual(after.faith.records[0],existing);
  assert.equal(after.faith.records.filter(r=>r.villageId===second.id).length,1);
});

test('failed manifest commit or snapshot upload exposes no partial batch',async()=>{
  for(const failOn of ['archive_manifest_v1','archive_snapshots/']){
    const {store,handler}=await fixture(),before=await snapshot(store),write=store.setJSON;
    store.setJSON=async(key,...rest)=>{if(key===failOn||key.startsWith(failOn))throw Error('isolated storage failure');return write(key,...rest);};
    const response=await handler(post(batch([second.id,third.id])));assert.equal(response.status,503);
    assert.deepEqual(await snapshot(store),before);
  }
});

test('ordinary village edits can enrich a quick link, while stale full saves cannot remove batch additions',async()=>{
  const {store,handler}=await fixture(),stale=(await snapshot(store)).faith;
  await handler(post(batch([second.id])));assert.equal((await handler(post(stale))).status,409);
  const current=(await snapshot(store)).faith,record=current.records.find(r=>r.villageId===second.id);
  record.temple='补充的宫庙';record.note='后续走访原文';
  const response=await handler(post(current));assert.equal(response.status,200);
  const after=await snapshot(store);assert.equal(after.faith.records.length,2);assert.equal(after.faith.records[1].temple,'补充的宫庙');assert.deepEqual(after.faith.records[0],existing);
});

test('archived IDs cannot acquire new village associations',async()=>{
  const {store,handler}=await fixture();const catalog=(await snapshot(store)).deities;
  catalog.records[0].archivedAt=stamp;await store.setJSON('deities',catalog);
  assert.equal((await handler(post(batch([second.id])))).status,409);
  assert.equal((await snapshot(store)).faith.records.length,1);
});
