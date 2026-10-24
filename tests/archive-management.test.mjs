import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { archiveManagementHandler } from '../netlify/lib/archive-management.mjs';
import { createArchiveStore } from '../netlify/lib/archive-store.mjs';
import { peopleHandler,normalizePerson } from '../netlify/lib/people.mjs';
import { fieldJournalHandler } from '../netlify/lib/field-journal.mjs';
import { recordsHandler } from '../netlify/lib/records.mjs';
import { deitySeed } from '../netlify/lib/deities.mjs';
import { issueSession } from '../netlify/lib/auth.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://archive-test.example';
function memoryStore(){const entries=new Map();let sequence=0;return {
  failSnapshot:false,rejectManifest:false,
  async getWithMetadata(key){return structuredClone(entries.get(key)||null);},
  async setJSON(key,data,options={}){
    if(this.failSnapshot&&key.startsWith('archive_snapshots/'))throw Error('Injected storage failure');
    if(this.rejectManifest&&key==='archive_manifest_v1'){this.rejectManifest=false;return {modified:false};}
    const old=entries.get(key);if((options.onlyIfNew&&old)||(options.onlyIfMatch&&options.onlyIfMatch!==old?.etag))return {modified:false};
    const etag=String(++sequence);entries.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
  }
};}
const headers=()=>({'Content-Type':'application/json',Origin:origin,Cookie:'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)});
function request(path,body,editor=true){return new Request(origin+path,{method:body?'POST':'GET',headers:editor?headers():{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
const management=(handler,body)=>handler(request('/api/archive-management',body));
async function jsonOk(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
const choices=preview=>Object.fromEntries(preview.conflicts.map(conflict=>[conflict.field,'both']));
async function fixture(){
  const store=memoryStore(),now='2026-01-01T00:00:00.000Z';
  const makePerson=(id,visibility,notes)=>normalizePerson({id,displayName:'同名人物',visibility,biography:notes,source:id,publishIdentity:true,publishOralHistory:true,roles:['访谈对象'],placeLinks:[{id:'place-'+id,placeId:'village-a',placeKind:'reference',relationType:'活动',notes:'共同活动依据',source:'同一来源',public:visibility==='public'}],deityIds:['god-source']},null,now);
  const people={version:1,revision:2,records:[makePerson('person-source','editors','源人物简介'),makePerson('person-target','public','目标人物简介')]};
  const deities={...structuredClone(deitySeed),revision:3,records:['source','target'].map(id=>({id:'god-'+id,name:'同名神明',aliases:[id],titleIds:[],description:id+'正文',identityNote:'身份相同待人工核对',source:id,createdAt:now,updatedAt:now,archivedAt:''}))};
  const faith={version:1,revision:4,records:[{id:'faith-a',villageId:'village-a',villageKind:'reference',villageName:'测试村',deities:['来源称谓','目标称谓'],deityLinks:[{id:'link-source',deityId:'god-source',nameIndex:0,localName:'源当地称谓',localTitle:'会主'},{id:'link-target',deityId:'god-target',nameIndex:1,localName:'目标当地称谓',localTitle:'境主'}],note:'不可改写的原始访谈正文',source:'原来源',createdAt:now,updatedAt:now}]};
  const journal={version:1,revision:5,records:[{id:'journal-a',placeId:'village-a',placeKind:'reference',title:'原始观察',content:'完整原文不得被合并改写。',observedAt:'',datePrecision:'unknown',recordType:'other',tags:[],visibility:'editors',deityIds:['god-source','god-target'],peopleLinks:[{personId:'person-source',roleInEntry:'叙述者',notes:'源口述材料',public:false},{personId:'person-target',roleInEntry:'叙述者',notes:'目标口述材料',public:true}],createdAt:now,updatedAt:now}]};
  for(const [key,data] of Object.entries({people,deities,faith,field_entries:journal}))await store.setJSON(key,data);
  return {store,initial:{people,deities,faith,field_entries:journal},handler:archiveManagementHandler(()=>store)};
}
async function snapshot(store){return (await createArchiveStore(store).getSnapshot()).states;}
test('maintenance authentication and same-origin checks expose no private records or logs',async()=>{
  const {store,handler}=await fixture();
  const denied=await handler(request('/api/archive-management?kind=people&id=person-source',null,false));assert.equal(denied.status,401);assert.equal((await denied.json()).record,undefined);
  const cross=request('/api/archive-management',{action:'archive',kind:'people',id:'person-source',confirm:true});cross.headers.set('Origin','https://other.example');assert.equal((await handler(cross)).status,403);
  const overview=await jsonOk(await handler(request('/api/archive-management')));assert.equal(overview.stats.people,2);assert.equal(overview.stats.deities,2);assert.equal(overview.stats.duplicatePairs,2);
  const anonymous=await jsonOk(await peopleHandler(()=>store)(request('/api/people',null,false)));assert.deepEqual(anonymous.records.map(record=>record.id),['person-target']);assert.equal(anonymous.operations,undefined);
});
test('archive and restore retain all references and preserve metadata for older clients',async()=>{
  const {store,handler,initial}=await fixture();
  let detail=await jsonOk(await handler(request('/api/archive-management?kind=people&id=person-source')));
  await jsonOk(await management(handler,{kind:'people',id:'person-source',action:'archive',confirm:true,snapshotToken:detail.snapshotToken}));
  let state=await snapshot(store);assert.ok(state.people.records[0].archivedAt);assert.deepEqual(state.field_entries,initial.field_entries);
  const older={...state.people.records[0]};delete older.archivedAt;delete older.mergedFromIds;
  const saved=await jsonOk(await peopleHandler(()=>store)(request('/api/people',{version:1,revision:state.people.revision,action:'save',record:older,baseUpdatedAt:older.updatedAt})));assert.ok(saved.records[0].archivedAt);
  detail=await jsonOk(await handler(request('/api/archive-management?kind=people&id=person-source')));
  await jsonOk(await management(handler,{kind:'people',id:'person-source',action:'restore',confirm:true,snapshotToken:detail.snapshotToken}));
  state=await snapshot(store);assert.equal(state.people.records[0].archivedAt,'');assert.equal(state.people.records[0].placeLinks.length,1);
});
test('explicit person merge atomically transfers references, retains distinct oral contexts and does not expand privacy',async()=>{
  const {store,handler,initial}=await fixture();
  const preview=await jsonOk(await management(handler,{action:'preview',kind:'people',sourceId:'person-source',targetId:'person-target'}));
  assert.ok(preview.conflicts.some(item=>item.field==='biography'));
  assert.equal((await management(handler,{action:'merge',kind:'people',sourceId:'person-source',targetId:'person-target',snapshotToken:preview.snapshotToken,confirm:true,choices:{}})).status,400);
  await jsonOk(await management(handler,{action:'merge',kind:'people',sourceId:'person-source',targetId:'person-target',snapshotToken:preview.snapshotToken,confirm:true,choices:choices(preview)}));
  const state=await snapshot(store),target=state.people.records[0];assert.equal(state.people.records.length,1);assert.equal(target.id,'person-target');assert.equal(target.visibility,'editors');assert.match(target.biography,/源人物简介/);assert.match(target.biography,/目标人物简介/);assert.match(target.source,/person-source/);
  assert.deepEqual(target.mergedFromIds,['person-source']);assert.equal(target.placeLinks.length,1);assert.equal(target.placeLinks[0].public,false);
  assert.deepEqual(state.field_entries.records[0].peopleLinks.map(link=>link.personId),['person-target','person-target']);assert.deepEqual(state.field_entries.records[0].peopleLinks.map(link=>link.notes),['源口述材料','目标口述材料']);assert.equal(state.field_entries.records[0].content,initial.field_entries.records[0].content);
  assert.deepEqual((await store.getWithMetadata('people')).data,initial.people);
  const publicState=await jsonOk(await peopleHandler(()=>store)(request('/api/people?id=person-source',null,false)));assert.deepEqual(publicState.records,[]);assert.deepEqual(publicState.redirects,{});
  const editorState=await jsonOk(await peopleHandler(()=>store)(request('/api/people?id=person-source')));assert.equal(editorState.records[0].id,'person-target');assert.equal(editorState.redirects['person-source'],'person-target');
  const journal=state.field_entries.records[0];const edited=await jsonOk(await fieldJournalHandler(()=>store)(request('/api/field-entries',{version:1,revision:state.field_entries.revision,action:'save',record:{...journal,title:'合并后只改标题'},baseUpdatedAt:journal.updatedAt})));assert.equal(edited.records[0].peopleLinks.length,2);
  const resurrect=await peopleHandler(()=>store)(request('/api/people',{version:1,revision:state.people.revision,action:'save',record:initial.people.records[0],baseUpdatedAt:null}));assert.equal(resurrect.status,409);
});
test('deity merge changes only ID references; original local names and journal prose remain intact',async()=>{
  const {store,handler,initial}=await fixture();
  const preview=await jsonOk(await management(handler,{action:'preview',kind:'deities',sourceId:'god-source',targetId:'god-target'}));
  await jsonOk(await management(handler,{action:'merge',kind:'deities',sourceId:'god-source',targetId:'god-target',snapshotToken:preview.snapshotToken,confirm:true,choices:choices(preview)}));
  const state=await snapshot(store);assert.equal(state.deities.records.length,1);assert.deepEqual(state.faith.records[0].deities,initial.faith.records[0].deities);assert.equal(state.faith.records[0].note,initial.faith.records[0].note);
  assert.deepEqual(state.faith.records[0].deityLinks.map(link=>link.deityId),['god-target','god-target']);assert.deepEqual(state.field_entries.records[0].deityIds,['god-target']);assert.deepEqual(state.people.records[0].deityIds,['god-target']);
  const old=await jsonOk(await recordsHandler('deities',()=>store)(request('/api/deities?id=god-source')));assert.equal(old.records[0].id,'god-target');assert.equal(old.redirects['god-source'],'god-target');
  const editedFaith=await jsonOk(await recordsHandler('faith',()=>store)(request('/api/faith',{...state.faith,records:state.faith.records.map(record=>({...record,deityLinks:record.deityLinks.map(link=>({...link,deityId:'god-source'}))}))})));assert.equal(editedFaith.records[0].deityLinks[0].deityId,'god-target');
});
test('merging oral histories preserves both original narrator roles and IDs in private research notes',async()=>{
  const {store,handler,initial}=await fixture();
  Object.assign(initial.people.records[0],{oralHistory:'来源口述全文',narratorRole:'reteller',researchNotes:'来源研究备注'});
  Object.assign(initial.people.records[1],{oralHistory:'目标口述全文',narratorRole:'eyewitness',researchNotes:'目标研究备注'});
  await store.setJSON('people',initial.people);
  const preview=await jsonOk(await management(handler,{action:'preview',kind:'people',sourceId:'person-source',targetId:'person-target'}));
  await jsonOk(await management(handler,{action:'merge',kind:'people',sourceId:'person-source',targetId:'person-target',confirm:true,snapshotToken:preview.snapshotToken,choices:choices(preview)}));
  const record=(await snapshot(store)).people.records[0];
  assert.equal(record.narratorRole,'unknown');assert.match(record.oralHistory,/来源口述全文/);assert.match(record.oralHistory,/目标口述全文/);
  for(const value of ['来源研究备注','目标研究备注','person-source — 转述者','person-target — 亲历叙述者'])assert.ok(record.researchNotes.includes(value));
  const response=await peopleHandler(()=>store)(request('/api/people',{version:1,revision:(await snapshot(store)).people.revision,action:'save',record:initial.people.records[0],baseUpdatedAt:null}));
  assert.equal(response.status,409);
});
test('referenced records cannot be deleted; explicitly selected detach deletes only relations, with tombstones preventing resurrection',async()=>{
  const {store,handler,initial}=await fixture();
  const detail=await jsonOk(await handler(request('/api/archive-management?kind=deities&id=god-source')));
  assert.ok(detail.refs.total>0);
  const command={action:'delete',kind:'deities',id:'god-source',confirm:true,snapshotToken:detail.snapshotToken};
  assert.equal((await management(handler,command)).status,409);assert.equal((await management(handler,{...command,detach:[detail.refs.items[0].key]})).status,409);
  assert.deepEqual(await snapshot(store),initial);
  await jsonOk(await management(handler,{...command,detach:detail.refs.items.map(item=>item.key)}));
  const state=await snapshot(store);assert.equal(state.deities.records.length,1);assert.deepEqual(state.faith.records[0].deities,initial.faith.records[0].deities);assert.equal(state.faith.records[0].note,initial.faith.records[0].note);assert.equal(state.field_entries.records[0].content,initial.field_entries.records[0].content);
  assert.equal(state.faith.records[0].deityLinks.length,1);
  const gods=await jsonOk(await recordsHandler('deities',()=>store)(request('/api/deities')));const attempt=await recordsHandler('deities',()=>store)(request('/api/deities',{...gods,records:[...gods.records,initial.deities.records[0]]}));assert.equal(attempt.status,409);
});
test('snapshot failures and manifest CAS conflicts never partially move references; stale previews are refused',async()=>{
  for(const failure of ['failSnapshot','rejectManifest']) {
    const {store,handler,initial}=await fixture();
    const preview=await jsonOk(await management(handler,{action:'preview',kind:'deities',sourceId:'god-source',targetId:'god-target'}));
    store[failure]=true;
    const response=await management(handler,{action:'merge',kind:'deities',sourceId:'god-source',targetId:'god-target',confirm:true,snapshotToken:preview.snapshotToken,choices:choices(preview)});assert.equal(response.status,failure==='failSnapshot'?503:409);
    store.failSnapshot=false;assert.deepEqual(await snapshot(store),initial);assert.equal(await store.getWithMetadata('archive_manifest_v1'),null);
  }
  const {store,handler}=await fixture();const preview=await jsonOk(await management(handler,{action:'preview',kind:'people',sourceId:'person-source',targetId:'person-target'}));
  await jsonOk(await management(handler,{action:'archive',kind:'people',id:'person-source',confirm:true,snapshotToken:preview.snapshotToken}));
  assert.equal((await management(handler,{action:'merge',kind:'people',sourceId:'person-source',targetId:'person-target',confirm:true,snapshotToken:preview.snapshotToken,choices:choices(preview)})).status,409);
  assert.equal((await snapshot(store)).people.records.length,2);
});
