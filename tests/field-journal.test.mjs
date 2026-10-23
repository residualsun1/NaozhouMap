import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fieldJournalHandler, normalizeFieldEntry } from '../netlify/lib/field-journal.mjs';
import { issueSession } from '../netlify/lib/auth.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://journal-test.example';
export function memoryJournalStore() {
  const entries=new Map();let sequence=0;
  return {
    async getWithMetadata(key){return structuredClone(entries.get(key)||null);},
    async setJSON(key,data,options={}){
      const previous=entries.get(key);
      if((options.onlyIfNew&&previous)||(options.onlyIfMatch&&options.onlyIfMatch!==previous?.etag))return{modified:false};
      const etag=String(++sequence);entries.set(key,{data:structuredClone(data),etag});return{modified:true,etag};
    }
  };
}
const headers=()=>({'Content-Type':'application/json',Origin:origin,Cookie:'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)});
const get=(editable=true,query='')=>new Request(origin+'/api/field-entries'+query,{headers:editable?headers():{}});
const post=(body,editable=true)=>new Request(origin+'/api/field-entries',{method:'POST',headers:editable?headers():{'Content-Type':'application/json'},body:JSON.stringify({version:1,...body})});
const record=(id,date='2026-10-23')=>({id,placeId:'test-village',placeKind:'reference',title:'隔离日志 '+id,content:'第一段田野观察。\n\n第二段完整访谈。',observedAt:date,datePrecision:date?'day':'unknown',recordType:'observation',tags:['古树'],source:'隔离测试，非田野资料'});
async function save(handler,state,item,previous=null,extras={}) {
  const response=await handler(post({action:'save',revision:state.revision,record:item,baseUpdatedAt:previous?.updatedAt||null,...extras}));
  assert.equal(response.status,200,await response.clone().text());return response.json();
}
test('three independent entries survive edit, deletion and reload, including the same date',async()=>{
  const store=memoryJournalStore(),handler=fieldJournalHandler(()=>store);
  let state=await(await handler(get())).json();
  for(const [id,date] of [['one','2026-10-01'],['two','2026-10-23'],['three','2026-10-23']])state=await save(handler,state,record(id,date));
  const second=state.records.find(item=>item.id==='two'),third=state.records.find(item=>item.id==='three');
  state=await save(handler,state,{...second,title:'只修改第二条',deityIds:['stable-deity']},second);
  assert.equal(state.records.find(item=>item.id==='one').observedAt,'2026-10-01');
  assert.deepEqual(state.records.find(item=>item.id==='three'),third);
  assert.equal((await handler(post({action:'delete',revision:state.revision,id:'one',baseUpdatedAt:state.records[0].updatedAt}))).status,400);
  assert.equal((await handler(post({action:'delete',revision:state.revision,id:'one',baseUpdatedAt:state.records[0].updatedAt,confirmDelete:true}))).status,200);
  state=await(await fieldJournalHandler(()=>store)(get())).json();
  assert.deepEqual(state.records.map(item=>item.id),['two','three']);
  assert.equal(state.records[0].content,second.content);
  const {deityIds,...olderClient}=state.records[0];
  state=await save(handler,state,{...olderClient,source:'更新来源'},state.records[0]);
  assert.deepEqual(state.records[0].deityIds,['stable-deity']);
});
test('anonymous reads never contain editor entries, even with exact place filters',async()=>{
  const handler=fieldJournalHandler(()=>store),store=memoryJournalStore();
  let state=await(await handler(get())).json();state=await save(handler,state,record('private'));
  assert.equal(state.records[0].visibility,'editors');
  assert.equal((await handler(post({action:'save',revision:state.revision,record:{...record('public'),visibility:'public'}}))).status,400);
  state=await save(handler,state,{...record('public'),visibility:'public'},null,{confirmPublic:true});
  for(const query of ['', '?placeId=test-village&placeKind=reference']){
    const response=await handler(get(false,query)),visible=await response.json();
    assert.equal(visible.editable,false);assert.equal(visible.revision,null);
    assert.deepEqual(visible.records.map(item=>item.id),['public']);
    assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('vary'),'Cookie');
  }
  const denied=await handler(post({action:'save',revision:state.revision,record:record('unauthorized')},false));
  assert.equal(denied.status,401);assert.equal((await denied.json()).records,undefined);
  const cross=post({action:'delete',revision:state.revision,id:'public',confirmDelete:true});cross.headers.set('Origin','https://other.example');
  assert.equal((await handler(cross)).status,401);
});
test('stale revisions, same-ID retries and concurrent updates cannot erase other records',async()=>{
  const store=memoryJournalStore(),handler=fieldJournalHandler(()=>store);
  let state=await(await handler(get())).json();
  state=await save(handler,state,record('same-id'));const original=state.records[0];
  const next=await save(handler,state,{...original,title:'最新编辑'},original);
  const stale=await handler(post({action:'save',revision:state.revision,record:{...original,title:'过时编辑'},baseUpdatedAt:original.updatedAt}));
  assert.equal(stale.status,409);
  const conflict=await handler(post({action:'save',revision:next.revision,record:original,baseUpdatedAt:original.updatedAt}));
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).recordConflict,true);
  assert.equal((await handler(post({action:'save',revision:next.revision,record:record('same-id'),baseUpdatedAt:null}))).status,409);
  assert.equal((await handler(post({action:'save',revision:next.revision,record:{...next.records[0],placeId:'changed'},baseUpdatedAt:next.records[0].updatedAt}))).status,400);
  const results=await Promise.all(['a','b'].map(id=>handler(post({action:'save',revision:next.revision,record:record(id)}))));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  assert.equal((await(await handler(get())).json()).records.length,2);
});
test('unknown and partial dates remain honest; recorded-at never becomes observed-at',()=>{
  const unknown=normalizeFieldEntry({...record('unknown',''),originalDateText:'某年冬季'});
  assert.equal(unknown.observedAt,'');assert.equal(unknown.datePrecision,'unknown');assert.equal(unknown.originalDateText,'某年冬季');
  assert.ok(unknown.createdAt);
  assert.equal(normalizeFieldEntry({...record('month','2026-10'),datePrecision:'month'}).observedAt,'2026-10');
  assert.equal(normalizeFieldEntry({...record('year','1998'),datePrecision:'year'}).observedAt,'1998');
  for(const item of [{observedAt:'2026-02-30'},{observedAt:'2026-13',datePrecision:'month'},{observedAt:'0000',datePrecision:'year'},{observedAt:'2026-10-23',datePrecision:'unknown'},{content:''}])assert.throws(()=>normalizeFieldEntry({...record('bad'),...item}));
});
test('legacy linking is explicit, unique and never modifies the old collection',async()=>{
  const store=memoryJournalStore(),handler=fieldJournalHandler(()=>store),old={version:1,revision:4,records:[{id:'old-archive',note:'旧笔记全文'}]};
  await store.setJSON('archives',old);
  let state=await(await handler(get())).json();
  state=await save(handler,state,{...record('converted',''),legacyKey:'reference:test-village:source-content-hash',content:old.records[0].note});
  assert.equal(state.records[0].observedAt,'');
  const duplicate=await handler(post({action:'save',revision:state.revision,record:{...state.records[0],id:'duplicate'},baseUpdatedAt:null}));
  assert.equal(duplicate.status,409);
  assert.deepEqual((await store.getWithMetadata('archives')).data,old);
});

test('journal people references remain independent, preserve old-client writes and honor current publication',async()=>{
  const store=memoryJournalStore(),handler=fieldJournalHandler(()=>store);
  const people={version:1,revision:1,records:[{id:'private-person',displayName:'私人对象',visibility:'editors'},{id:'public-person',displayName:'公开化名',visibility:'summary',publicSummary:'获准摘要',roles:[],placeLinks:[]}]};
  await store.setJSON('people',people);
  let state=await(await handler(get())).json();
  const peopleLinks=[{personId:'private-person',roleInEntry:'受访者',notes:'未公开关系',public:true},{personId:'public-person',roleInEntry:'亲历叙述者',public:true},{personId:'public-person',roleInEntry:'转述者',notes:'未授权的叙述关系',public:false}];
  state=await save(handler,state,{...record('linked'),visibility:'public',peopleLinks},null,{confirmPublic:true});
  let anonymous=await(await handler(get(false))).json();
  assert.deepEqual(anonymous.records[0].peopleLinks.map(link=>[link.personId,link.roleInEntry]),[['public-person','亲历叙述者']]);
  assert.equal(JSON.stringify(anonymous).includes('未公开关系'),false);
  const {peopleLinks:oldLinks,...oldClient}=state.records[0];
  state=await save(handler,state,{...oldClient,title:'只改标题'},state.records[0]);
  assert.deepEqual(state.records[0].peopleLinks,oldLinks);assert.equal(state.records[0].content,record('linked').content);
  const invalid=await handler(post({action:'save',revision:state.revision,record:{...record('bad-reference'),peopleLinks:[{personId:'nonexistent'}]}}));assert.equal(invalid.status,400);
  people.records[1].visibility='editors';await store.setJSON('people',people);
  anonymous=await(await handler(get(false))).json();assert.deepEqual(anonymous.records[0].peopleLinks,[]);
  const editor=await(await handler(get())).json();assert.equal(editor.records[0].peopleLinks.length,3);
});
