import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {peopleHandler} from '../netlify/lib/people.mjs';
import {createArchiveStore} from '../netlify/lib/archive-store.mjs';
import {archiveManagementHandler} from '../netlify/lib/archive-management.mjs';
import {issueSession} from '../netlify/lib/auth.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://identity-test.example',compound='口述历史提供者：信众';
function memoryStore(){const data=new Map();let sequence=0;return {async getWithMetadata(key){return structuredClone(data.get(key)||null);},async setJSON(key,value,options={}){const old=data.get(key);if((options.onlyIfNew&&old)||(options.onlyIfMatch&&old?.etag!==options.onlyIfMatch))return{modified:false};data.set(key,{data:structuredClone(value),etag:String(++sequence)});return{modified:true};}};}
const headers=()=>({'Content-Type':'application/json',Origin:origin,Cookie:'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)});
const request=(body,editor=true)=>new Request(origin+'/api/people',{...(body?{method:'POST',body:JSON.stringify({version:1,...body})}:{}),headers:editor?headers():{'Content-Type':'application/json',Origin:origin}});
const originalPerson=(id,roles,extra={})=>({id,displayName:'测试 '+id,roles,biography:'保留人物正文',oralHistory:'保留口述原文',ritualQualificationNote:'保留仪式说明',researchNotes:'内部备注',source:'测试来源',visibility:'public',publishIdentity:true,publishOralHistory:true,placeLinks:[{id:'place-'+id,placeKind:'reference',placeId:'village-'+id,relationType:'ritual',notes:'保留地点说明',source:'依据',public:true}],deityIds:[],createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-01T00:00:00Z',...extra});
async function fixture(){const raw=memoryStore(),records=[originalPerson('a',['道士',compound]),originalPerson('b',['道士']),originalPerson('archived',[compound],{archivedAt:'2025-02-01T00:00:00Z'}),originalPerson('private',['私人身份'],{visibility:'editors'})];await raw.setJSON('people',{version:1,revision:2,records});return{raw,handler:peopleHandler(()=>raw),records};}
const read=async(handler,editor=true)=>(await handler(request(null,editor))).json();
async function change(handler,state,action,values={}){const response=await handler(request({revision:state.revision,action,...values}));assert.equal(response.status,200,await response.clone().text());return response.json();}

test('legacy roles migrate intact with stable IDs, a recovery pointer, and no public private-label leak',async()=>{
  const {raw,handler,records}=await fixture(),before=await raw.getWithMetadata('people');
  let state=await read(handler);assert.equal(state.identityMigrationNeeded,true);assert.equal(state.identityTypes.some(type=>type.name===compound),true);assert.equal(state.identityTypes.some(type=>type.name==='信众'),false);
  assert.deepEqual(await raw.getWithMetadata('people'),before);const publicState=await read(handler,false);assert.equal(JSON.stringify(publicState.identityTypes).includes('私人身份'),false);assert.equal(publicState.records.length,3);
  const ids=state.identityTypes.map(type=>type.id);for(const id of ids)assert.match(id,/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.deepEqual((await read(handler)).identityTypes.map(type=>type.id),ids);
  state=await change(handler,state,'identity-migrate');assert.equal(state.identityMigrationNeeded,false);assert.equal(state.records.length,records.length);assert.deepEqual(state.records.map(person=>person.roles),records.map(person=>person.roles));
  const snapshot=await createArchiveStore(raw).getSnapshot();assert.equal(snapshot.states.people.identityMigration.previousDocument,'people');assert.equal(snapshot.states.people.identityMigration.linkCount,5);assert.equal(snapshot.manifest.operations.at(-1).action,'identity-migrate');assert.deepEqual(await raw.getWithMetadata('people'),before);
  for(const person of state.records){const original=records.find(old=>old.id===person.id);for(const field of ['id','createdAt','biography','oralHistory','ritualQualificationNote','researchNotes','source','placeLinks','deityIds'])assert.deepEqual(person[field],original[field]);}
});

test('definitions can be created, renamed and ordered; IDs and unrelated person data stay stable',async()=>{
  const {handler}=await fixture();let state=await change(handler,await read(handler),'identity-migrate');
  state=await change(handler,state,'identity-save',{identity:{name:'  仪式组织者  ',description:' 活动组织说明 '}});const type=state.identityTypes.find(type=>type.name==='仪式组织者');assert.equal(state.identityStats.byId[type.id].total,0);
  const before=state.records.find(person=>person.id==='a');state=await change(handler,state,'save',{record:{id:before.id,identityTypeIds:[...before.identityTypeIds,type.id,type.id]},baseUpdatedAt:before.updatedAt});const assigned=state.records.find(person=>person.id===before.id);assert.equal(assigned.identityTypeIds.filter(id=>id===type.id).length,1);assert.equal(state.identityStats.byId[type.id].active,1);
  state=await change(handler,state,'identity-save',{identity:{id:type.id,name:'仪式协作组织者',description:'修订说明'}});const renamed=state.identityTypes.find(item=>item.id===type.id);assert.equal(renamed.name,'仪式协作组织者');assert.equal(state.records.find(person=>person.id===before.id).roles.includes(renamed.name),true);
  for(const field of ['biography','oralHistory','placeLinks','deityIds','ritualQualificationNote','researchNotes'])assert.deepEqual(state.records.find(person=>person.id===before.id)[field],before[field]);
  const order=state.identityTypes.map(item=>item.id).reverse();state=await change(handler,state,'identity-reorder',{orderedIds:order});assert.deepEqual(state.identityTypes.map(item=>item.id),order);
  const duplicate=await handler(request({revision:state.revision,action:'identity-save',identity:{name:' 仪式协作组织者 '}}));assert.equal(duplicate.status,400);
  const reserved=await handler(request({revision:state.revision,action:'identity-save',identity:{name:'已归档'}}));assert.equal(reserved.status,400);
});

test('archived identity links remain; active counts and unclassified use enabled IDs only',async()=>{
  const {handler}=await fixture();let state=await change(handler,await read(handler),'identity-migrate');const priest=state.identityTypes.find(type=>type.name==='道士'),oral=state.identityTypes.find(type=>type.name===compound),before=structuredClone(state.records);
  assert.equal(state.identityStats.all,3);assert.equal(state.identityStats.archived,1);assert.equal(state.identityStats.byId[oral.id].active,1);assert.equal(state.identityStats.byId[oral.id].total,2);
  state=await change(handler,state,'identity-status',{id:priest.id,isActive:false,confirm:true});assert.equal(state.identityStats.unclassified,1);assert.deepEqual(state.records,before);
  const current=state.records.find(person=>person.id==='private');const inactive=await handler(request({revision:state.revision,action:'save',record:{id:current.id,identityTypeIds:[priest.id]},baseUpdatedAt:current.updatedAt}));assert.equal(inactive.status,400);
  state=await change(handler,state,'identity-status',{id:priest.id,isActive:true,confirm:true});assert.equal(state.identityStats.unclassified,0);assert.deepEqual(state.records,before);
});

test('referenced delete is blocked; explicit reassignment is atomic and preserves people and other links',async()=>{
  const {raw,handler}=await fixture();let state=await change(handler,await read(handler),'identity-migrate');const priest=state.identityTypes.find(type=>type.name==='道士'),oral=state.identityTypes.find(type=>type.name===compound),before=structuredClone(state);
  const blocked=await handler(request({revision:state.revision,action:'identity-delete',id:priest.id,confirm:true}));assert.equal(blocked.status,409);assert.equal((await blocked.json()).referenceCount,2);assert.deepEqual(await read(handler),before);
  state=await change(handler,state,'identity-delete',{id:priest.id,reassignToId:oral.id,confirm:true});assert.equal(state.records.length,before.records.length);assert.equal(state.identityTypes.some(type=>type.id===priest.id),false);for(const person of state.records){assert.equal(person.identityTypeIds.includes(priest.id),false);assert.equal(new Set(person.identityTypeIds).size,person.identityTypeIds.length);const previous=before.records.find(old=>old.id===person.id);for(const field of ['placeLinks','deityIds','biography','oralHistory','researchNotes'])assert.deepEqual(person[field],previous[field]);}
  state=await change(handler,state,'identity-save',{identity:{name:'未使用测试身份'}});const unused=state.identityTypes.find(type=>type.name==='未使用测试身份');state=await change(handler,state,'identity-delete',{id:unused.id,confirm:true});assert.equal(state.identityTypes.some(type=>type.id===unused.id),false);assert.equal((await createArchiveStore(raw).getSnapshot()).manifest.operations.at(-1).action,'identity-delete');
});

test('permission, origin, revisions and unknown IDs cannot corrupt identity definitions',async()=>{
  const {handler}=await fixture();let state=await change(handler,await read(handler),'identity-migrate');const body={revision:state.revision,action:'identity-save',identity:{name:'不应保存'}};
  assert.equal((await handler(request(body,false))).status,401);const cross=request(body);cross.headers.set('Origin','https://elsewhere.example');assert.equal((await handler(cross)).status,401);
  const current=state.records[0];assert.equal((await handler(request({revision:state.revision,action:'save',record:{id:current.id,identityTypeIds:[randomUUID()]},baseUpdatedAt:current.updatedAt}))).status,400);
  const responses=await Promise.all(['并发甲','并发乙'].map(name=>handler(request({revision:state.revision,action:'identity-save',identity:{name}}))));assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);const fresh=await read(handler);assert.equal(fresh.identityTypes.filter(type=>type.name.startsWith('并发')).length,1);assert.equal((await handler(request(body))).status,409);
});

test('person merge unions stable identity links and still exposes their names in management preview',async()=>{
  const {raw,handler}=await fixture(),legacy=(await raw.getWithMetadata('people')).data;legacy.records.find(person=>person.id==='b').roles=['另一身份'];await raw.setJSON('people',legacy);const state=await change(handler,await read(handler),'identity-migrate'),manage=archiveManagementHandler(()=>raw);
  const response=await manage(new Request(origin+'/api/archive-management',{method:'POST',headers:headers(),body:JSON.stringify({kind:'people',action:'preview',sourceId:'b',targetId:'a'})}));assert.equal(response.status,200);const preview=await response.json();assert.deepEqual(preview.target.roles,state.records.find(person=>person.id==='a').roles);
  const merged=await manage(new Request(origin+'/api/archive-management',{method:'POST',headers:headers(),body:JSON.stringify({kind:'people',action:'merge',sourceId:'b',targetId:'a',snapshotToken:preview.snapshotToken,confirm:true,choices:{}})}));assert.equal(merged.status,200,await merged.clone().text());const after=await read(handler);assert.equal(after.records.length,state.records.length-1);assert.deepEqual(after.records.find(person=>person.id==='a').identityTypeIds,[...state.records.find(person=>person.id==='a').identityTypeIds,...state.records.find(person=>person.id==='b').identityTypeIds]);
});

test('unpublished identity information is neither leaked nor presented as an absent identity',async()=>{
  const raw=memoryStore(),handler=peopleHandler(()=>raw);await raw.setJSON('people',{version:1,revision:1,records:[originalPerson('hidden-identity',['保留  原始空格：复合身份'],{publishIdentity:false})]});
  const editor=await read(handler);assert.equal(editor.identityTypes[0].name,'保留  原始空格：复合身份');
  const publicState=await read(handler,false);assert.deepEqual(publicState.identityTypes,[]);assert.deepEqual(publicState.records[0].roles,[]);assert.equal(publicState.records[0].identityTypeIds,undefined);assert.equal(publicState.identityStats.all,1);assert.equal(publicState.identityStats.unclassified,0);
});
