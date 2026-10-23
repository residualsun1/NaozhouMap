import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleHandler, peopleSeed, normalizePerson, normalizePeopleLinks, publicPerson } from '../netlify/lib/people.mjs';
import { issueSession } from '../netlify/lib/auth.mjs';

process.env.NAOZHOU_EDITOR_PASSWORD=randomBytes(32).toString('base64url');
const origin='https://people-test.example';
function memoryStore() {
  const records=new Map();let sequence=0;
  return {
    async getWithMetadata(key){return structuredClone(records.get(key)||null);},
    async setJSON(key,data,options={}) {
      const previous=records.get(key);
      if ((options.onlyIfNew&&previous)||(options.onlyIfMatch&&options.onlyIfMatch!==previous?.etag)) return {modified:false};
      const etag=String(++sequence);records.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
    }
  };
}
const headers=()=>({'Content-Type':'application/json',Origin:origin,Cookie:'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD)});
const get=(editor=true,query='')=>new Request(origin+'/api/people'+query,{headers:editor?headers():{}});
const post=(body,editor=true)=>new Request(origin+'/api/people',{method:'POST',headers:editor?headers():{'Content-Type':'application/json'},body:JSON.stringify({version:1,...body})});
const person=id=>({id,displayName:'同名长者',realName:'内部真实姓名',researchNotes:'不可公开的研究备注',surname:'某',religiousName:'内部法号',aliases:['地方称谓'],roles:['口述者'],biography:'完整人物简介',ritualQualificationNote:'资格记录',oralHistory:'原始口述全文',narratedAt:'2026-10-24',eventDateText:'某年冬季',narrativeSource:'录音转写',narratorRole:'reteller',source:'走访资料',publicSummary:'经许可的摘要',placeLinks:[{id:'link-private',placeId:'village-private',placeKind:'reference',relationType:'residence',notes:'未公开的居住依据',source:'访谈'}]});
async function save(handler,state,item,previous=null,extras={}) {
  const response=await handler(post({action:'save',revision:state.revision,record:item,baseUpdatedAt:previous?.updatedAt||null,...extras}));
  assert.equal(response.status,200,await response.clone().text());return response.json();
}
test('private defaults, stable IDs and same names remain independent across edits',async()=>{
  const store=memoryStore(),handler=peopleHandler(()=>store);
  let state=peopleSeed();
  state=await save(handler,state,person('person-a'));
  state=await save(handler,state,person('person-b'));
  assert.equal(state.records.length,2);assert.equal(state.records[0].visibility,'editors');
  assert.equal(state.records[0].publishIdentity,false);assert.equal(state.records[0].placeLinks[0].public,false);
  const before=structuredClone(state.records[1]),current=state.records[0];
  state=await save(handler,state,{id:current.id,displayName:'新化名'},current);
  assert.equal(state.records[0].realName,current.realName);assert.equal(state.records[0].createdAt,current.createdAt);
  assert.deepEqual(state.records[1],before);
  assert.deepEqual((await(await handler(get(false))).json()).records,[]);
});
test('summary exposes only permitted fields and public place links, including place filtering',async()=>{
  const handler=peopleHandler(()=>memory),memory=memoryStore();
  let state=peopleSeed();
  const item={...person('summary-person'),visibility:'summary',placeLinks:[...person('x').placeLinks,{id:'link-public',placeId:'public-village',placeKind:'reference',relationType:'activity',notes:'获准公开的关联',source:'公开资料',public:true}]};
  const unconfirmed=await handler(post({action:'save',revision:0,record:item}));assert.equal(unconfirmed.status,400);
  state=await save(handler,state,item,null,{confirmPublic:true});
  const response=await handler(get(false)),publicState=await response.json(),visible=publicState.records[0];
  assert.equal(publicState.revision,null);assert.equal(publicState.editable,false);
  assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('vary'),'Cookie');
  assert.deepEqual(Object.keys(visible).sort(),['id','displayName','roles','publicSummary','visibility','placeLinks'].sort());
  assert.deepEqual(visible.roles,[]);
  assert.equal(visible.placeLinks.length,1);assert.equal(visible.placeLinks[0].placeId,'public-village');
  assert.equal((await(await handler(get(false,'?placeId=village-private'))).json()).records.length,0);
  assert.equal((await(await handler(get(false,'?placeId=public-village&placeKind=reference'))).json()).records.length,1);
  assert.equal(JSON.stringify(publicState).includes('内部'),false);
  const previous=state.records[0],disclosed={...previous,publishIdentity:true};
  assert.equal((await handler(post({action:'save',revision:state.revision,record:disclosed,baseUpdatedAt:previous.updatedAt}))).status,400);
  state=await save(handler,state,disclosed,previous,{confirmPublic:true});
  const identitySummary=(await(await handler(get(false))).json()).records[0];
  assert.deepEqual(identitySummary.roles,['口述者']);assert.equal(identitySummary.religiousName,undefined);
  const last=state.records[0];await save(handler,state,{...last,publishIdentity:false},last);
  assert.deepEqual((await(await handler(get(false))).json()).records[0].roles,[]);
});
test('full publication still gates identity and oral history; revocation takes effect immediately',async()=>{
  const store=memoryStore(),handler=peopleHandler(()=>store);
  let state=await save(handler,peopleSeed(),{...person('public-person'),visibility:'public'},null,{confirmPublic:true});
  let visible=(await(await handler(get(false))).json()).records[0];
  assert.equal(visible.biography,'完整人物简介');
  assert.deepEqual(visible.roles,[]);
  for (const field of ['realName','researchNotes','surname','aliases','religiousName','oralHistory','narrativeSource']) assert.equal(visible[field],undefined);
  const before=state.records[0],expanded={...before,publishIdentity:true,publishOralHistory:true};
  assert.equal((await handler(post({action:'save',revision:state.revision,record:expanded,baseUpdatedAt:before.updatedAt}))).status,400);
  state=await save(handler,state,expanded,before,{confirmPublic:true});
  visible=(await(await handler(get(false))).json()).records[0];
  assert.equal(visible.religiousName,'内部法号');assert.equal(visible.oralHistory,'原始口述全文');assert.equal(visible.narratorRole,'reteller');
  assert.deepEqual(visible.roles,['口述者']);
  assert.equal(visible.realName,undefined);assert.equal(visible.researchNotes,undefined);
  const latest=state.records[0];state=await save(handler,state,{...latest,visibility:'editors'},latest);
  assert.deepEqual((await(await handler(get(false,'?id=public-person'))).json()).records,[]);
  assert.equal(state.records[0].oralHistory,'原始口述全文');
});
test('auth, origin, global revision and record revision prevent unauthorized or stale writes',async()=>{
  const store=memoryStore(),handler=peopleHandler(()=>store);
  assert.equal((await handler(post({action:'save',revision:0,record:person('no-auth')},false))).status,401);
  const cross=post({action:'save',revision:0,record:person('cross-origin')});cross.headers.set('Origin','https://elsewhere.example');assert.equal((await handler(cross)).status,401);
  let state=await save(handler,peopleSeed(),person('p'));
  const original=state.records[0];state=await save(handler,state,{...original,displayName:'修订显示名称'},original);
  assert.equal((await handler(post({action:'save',revision:1,record:original,baseUpdatedAt:original.updatedAt}))).status,409);
  const conflict=await handler(post({action:'save',revision:state.revision,record:original,baseUpdatedAt:original.updatedAt}));assert.equal(conflict.status,409);assert.equal((await conflict.json()).recordConflict,true);
  assert.equal((await handler(post({action:'save',revision:state.revision,record:person('p')}))).status,409);
  const outcomes=await Promise.all(['first','second'].map(id=>handler(post({action:'save',revision:state.revision,record:person(id)}))));
  assert.deepEqual(outcomes.map(response=>response.status).sort(),[200,409]);
  assert.equal((await(await handler(get())).json()).records.length,2);
});
test('journal people links keep distinct narrative roles and require explicit public metadata',()=>{
  const links=normalizePeopleLinks([{personId:'p',roleInEntry:'亲历叙述者',notes:'原始叙述',eventDateText:'时间待考'},{personId:'p',roleInEntry:'参与者',public:true}]);
  assert.equal(links.length,2);assert.equal(links[0].public,false);assert.equal(links[1].public,true);
  assert.equal(links[0].eventDateText,'时间待考');
  assert.throws(()=>normalizePeopleLinks([{personId:'p',roleInEntry:'同一角色'},{personId:'p',roleInEntry:'同一角色'}]));
  assert.throws(()=>normalizePeopleLinks([{personId:'p',public:'true'}]));
  assert.throws(()=>normalizePerson({...person('invalid'),visibility:'private'}));
  assert.throws(()=>normalizePerson({...person('invalid'),publishIdentity:'true'}));
  assert.equal(publicPerson(normalizePerson(person('private'))),null);
});
