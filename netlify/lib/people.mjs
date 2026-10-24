import { getStore } from '@netlify/blobs';
import { resolveEditorAuth, json, sameOrigin } from './auth.mjs';

export const peopleSeed = () => ({version:1,revision:0,records:[]});
const revisionValid = value => Number.isInteger(value) && value >= 0 && value < 2147483647;
function text(value,limit,required=false) {
  if (value == null && !required) return '';
  if (typeof value!=='string' || value.length>limit || (required&&!value.trim())) throw Error('人物字段为空、无效或过长。');
  return value.trim();
}
function flag(value,fallback=false) {
  if (value==null) return fallback;
  if (typeof value!=='boolean') throw Error('公开设置必须为布尔值。');
  return value;
}
function strings(value,limit=100,length=120) {
  if (!Array.isArray(value) || value.length>limit) throw Error('人物标签或关联格式无效。');
  return [...new Set(value.map(item=>text(item,length,true)))];
}
export function normalizePeopleLinks(value=[]) {
  if (!Array.isArray(value) || value.length>100) throw Error('日志人物关联格式无效或过多。');
  const seen=new Set();
  return value.map(item=>{
    if (!item || typeof item!=='object') throw Error('日志人物关联格式无效。');
    const personId=text(item.personId,120,true), roleInEntry=text(item.roleInEntry||'mentioned',100,true);
    const key=JSON.stringify([personId,roleInEntry]);
    if (seen.has(key)) throw Error('同一日志中的人物与角色关联重复。');
    seen.add(key);
    return {personId,roleInEntry,notes:text(item.notes,5000),narratedAt:text(item.narratedAt,100),eventDateText:text(item.eventDateText,300),narrativeSource:text(item.narrativeSource,3000),public:flag(item.public)};
  });
}
function normalizePlaceLinks(value) {
  if (!Array.isArray(value) || value.length>100) throw Error('人物地点关联格式无效或过多。');
  const ids=new Set();
  return value.map(item=>{
    if (!item || typeof item!=='object') throw Error('人物地点关联格式无效。');
    const link={id:text(item.id,120,true),placeId:text(item.placeId,120,true),placeKind:item.placeKind,relationType:text(item.relationType||'visit',100,true),notes:text(item.notes,5000),source:text(item.source,3000),public:flag(item.public)};
    if (!['reference','survey'].includes(link.placeKind) || ids.has(link.id)) throw Error('人物地点关联编号重复或地点类型无效。');
    ids.add(link.id);return link;
  });
}
export function normalizePerson(input,previous,now=new Date().toISOString()) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Error('人物档案格式无效。');
  const value = key => input[key]===undefined ? previous?.[key] : input[key];
  const record={id:text(input.id,120,true),displayName:text(value('displayName'),200,true)};
  if (previous && record.id!==previous.id) throw Error('不能更改人物编号。');
  for (const [key,limit] of Object.entries({surname:100,realName:200,religiousName:200,biography:100000,ritualQualificationNote:20000,oralHistory:100000,narratedAt:100,eventDateText:300,narrativeSource:3000,researchNotes:100000,source:3000,publicSummary:3000})) record[key]=text(value(key),limit);
  record.aliases=strings(value('aliases')??[],100,200);
  record.roles=strings(value('roles')??[],50,100);
  record.deityIds=strings(value('deityIds')??[]);
  record.visibility=value('visibility')||'editors';
  record.narratorRole=value('narratorRole')||'unknown';
  if (!['editors','summary','public'].includes(record.visibility) || !['participant','eyewitness','reteller','mentioned','unknown'].includes(record.narratorRole)) throw Error('人物可见范围或叙述角色无效。');
  record.publishIdentity=flag(value('publishIdentity'));
  record.publishOralHistory=flag(value('publishOralHistory'));
  record.placeLinks=normalizePlaceLinks(value('placeLinks')??[]);
  record.createdAt=previous?.createdAt||now;
  record.updatedAt=new Date(Math.max(Date.parse(now),previous?Date.parse(previous.updatedAt)+1:0)).toISOString();
  return record;
}
// Server-side allowlists: a public response never includes realName or researchNotes.
export function publicPerson(person) {
  if (!person || !['summary','public'].includes(person.visibility)) return null;
  const record={id:person.id,displayName:person.displayName,roles:person.publishIdentity===true?(person.roles||[]):[],publicSummary:person.publicSummary||'',visibility:person.visibility,placeLinks:(person.placeLinks||[]).filter(link=>link.public===true)};
  if (person.visibility==='summary') return record;
  Object.assign(record,{biography:person.biography||'',ritualQualificationNote:person.ritualQualificationNote||'',source:person.source||'',deityIds:person.deityIds||[]});
  if (person.publishIdentity===true) Object.assign(record,{surname:person.surname||'',religiousName:person.religiousName||'',aliases:person.aliases||[]});
  if (person.publishOralHistory===true) for (const key of ['oralHistory','narratedAt','eventDateText','narrativeSource','narratorRole']) record[key]=person[key]||'';
  return record;
}
function widerPublication(record,previous) {
  const rank={editors:0,summary:1,public:2};
  if (rank[record.visibility]>rank[previous?.visibility||'editors']) return true;
  if (record.visibility!=='editors' && record.placeLinks.some(link=>link.public && !previous?.placeLinks?.some(old=>old.id===link.id&&old.public))) return true;
  if (record.visibility!=='editors' && record.publishIdentity&&!previous?.publishIdentity) return true;
  if (record.visibility!=='public') return false;
  if (record.publishOralHistory&&!previous?.publishOralHistory) return true;
  return false;
}
const respond=(value,status=200,headers={})=>json(value,status,{'Cache-Control':'private, no-store',Vary:'Cookie',...headers});
export function peopleHandler(storeFactory=()=>getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request=>{
    if (!['GET','POST'].includes(request.method)) return respond({error:'Method not allowed.'},405,{Allow:'GET, POST'});
    if (request.method==='POST'&&!sameOrigin(request)) return respond({error:'请先登录编辑。'},401);
    try {
      const store=storeFactory();
      const editable=(await resolveEditorAuth(store)).authorized(request);
      if(request.method==='POST'&&!editable)return respond({error:'请先登录编辑。'},401);
      async function read() {
        const entry=await store.getWithMetadata('people',{type:'json'}),state=entry?entry.data:peopleSeed();
        if (state?.version!==1||!revisionValid(state.revision)||!Array.isArray(state.records)||new Set(state.records.map(record=>record.id)).size!==state.records.length) throw Error('Invalid people state.');
        return {state,etag:entry?.etag};
      }
      function result(state) {
        const query=new URL(request.url).searchParams;
        const records=editable?state.records:state.records.map(publicPerson).filter(Boolean);
        return {version:1,revision:editable?state.revision:null,editable,records:records.filter(record=>(!query.has('id')||record.id===query.get('id'))&&(!query.has('placeId')||record.placeLinks?.some(link=>link.placeId===query.get('placeId')&&(!query.has('placeKind')||link.placeKind===query.get('placeKind')))))};
      }
      const current=await read();
      if (request.method==='GET') return respond(result(current.state));
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) return respond({error:'Use application/json.'},415);
      if (Number(request.headers.get('content-length'))>512*1024) return respond({error:'人物档案过大。'},413);
      const raw=await request.text();
      if (Buffer.byteLength(raw)>512*1024) return respond({error:'人物档案过大。'},413);
      let body;
      try {body=JSON.parse(raw);if (body.version!==1||!revisionValid(body.revision)||body.action!=='save') throw Error('人物版本或操作无效。');}
      catch(error){return respond({error:error.message},400);}
      if (body.revision!==current.state.revision) return respond({...result(current.state),error:'其他页面已更新人物档案，填写内容仍保留，请再次保存。'},409);
      const previous=current.state.records.find(record=>record.id===body.record?.id);
      if ((previous&&body.baseUpdatedAt!==previous.updatedAt)||(!previous&&body.baseUpdatedAt)) return respond({...result(current.state),recordConflict:true,error:'此人物档案已被修改。填写内容仍保留，请重新打开最新档案。'},409);
      let record;
      try {record=normalizePerson(body.record,previous);}catch(error){return respond({error:error.message},400);}
      if (widerPublication(record,previous)&&body.confirmPublic!==true) return respond({error:'请明确确认人物资料的公开范围。'},400);
      const records=previous?current.state.records.map(item=>item.id===record.id?record:item):current.state.records.concat(record);
      if (records.length>20000) return respond({error:'人物库达到当前容量限制。'},400);
      const next={version:1,revision:current.state.revision+1,records};
      const saved=await store.setJSON('people',next,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      if (!saved.modified) return respond({...result((await read()).state),error:'其他页面已保存，填写内容仍保留，请重试。'},409);
      return respond(result(next));
    } catch(error) {
      console.error('People storage failed:',error.name);
      return respond({error:'人物档案暂时无法读写。填写内容仍保留，请稍后重试。'},503);
    }
  };
}
