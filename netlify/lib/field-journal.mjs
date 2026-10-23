import { getStore } from '@netlify/blobs';
import { authorized, json, sameOrigin } from './auth.mjs';
import { normalizePeopleLinks, publicPerson } from './people.mjs';

const empty = () => ({version:1, revision:0, records:[]});
const revisionValid = value => Number.isInteger(value) && value >= 0 && value < 2147483647;
const recordTypes = new Set(['observation','interview','ritual','research','other']);
function text(value, limit, required=false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw Error('日志字段为空、格式无效或过长。');
  return value.trim();
}
export function normalizeFieldEntry(input, previous, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object') throw Error('日志格式无效。');
  const record = {
    id:text(input.id,120,true), placeId:text(input.placeId,120,true), placeKind:input.placeKind,
    title:text(input.title,200,true), content:text(input.content,100000,true),
    observedAt:text(input.observedAt,10), datePrecision:input.datePrecision || 'unknown',
    originalDateText:text(input.originalDateText,300), recordType:input.recordType || 'other',
    source:text(input.source,3000), visibility:input.visibility || previous?.visibility || 'editors'
  };
  if (!['reference','survey'].includes(record.placeKind)) throw Error('地点关联无效。');
  if (!recordTypes.has(record.recordType) || !['editors','public'].includes(record.visibility)) throw Error('日志类型或可见范围无效。');
  const formats = {day:/^\d{4}-\d{2}-\d{2}$/,month:/^\d{4}-\d{2}$/,year:/^\d{4}$/};
  if (record.datePrecision === 'unknown') {
    if (record.observedAt) throw Error('日期待考的记录请使用原始时间表述，勿填写推定观察日期。');
  } else {
    const pattern = formats[record.datePrecision];
    if (!pattern?.test(record.observedAt) || Number(record.observedAt.slice(0,4)) < 1) throw Error('请填写与日期精度一致的观察日期。');
    const full = record.observedAt + (record.datePrecision==='year'?'-01-01':record.datePrecision==='month'?'-01':'');
    const date = new Date(full+'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==full) throw Error('观察日期无效。');
  }
  if (!Array.isArray(input.tags ?? []) || (input.tags || []).length > 30) throw Error('主题标签过多或无效。');
  record.tags = [...new Set((input.tags || []).map(tag=>text(tag,50,true)))];
  const deityIds = input.deityIds ?? previous?.deityIds ?? [];
  if (!Array.isArray(deityIds) || deityIds.length > 100) throw Error('神明关联格式无效。');
  record.deityIds = [...new Set(deityIds.map(id=>text(id,120,true)))];
  record.peopleLinks = normalizePeopleLinks(input.peopleLinks ?? previous?.peopleLinks ?? []);
  record.legacyKey = text(input.legacyKey ?? previous?.legacyKey,300);
  if (previous && (previous.placeId!==record.placeId || previous.placeKind!==record.placeKind || (previous.legacyKey||'')!==record.legacyKey)) throw Error('不能改变已有日志的地点或历史笔记来源。');
  record.createdAt = previous?.createdAt || now;
  record.updatedAt = new Date(Math.max(Date.parse(now), previous ? Date.parse(previous.updatedAt)+1 : 0)).toISOString();
  return record;
}
function visibleState(state, request, editable, publicPeople=new Set()) {
  const query = new URL(request.url).searchParams;
  return {version:1,revision:editable?state.revision:null,editable,records:state.records.filter(record =>
    (editable || record.visibility==='public') && (!query.has('placeId') || record.placeId===query.get('placeId')) &&
    (!query.has('placeKind') || record.placeKind===query.get('placeKind'))).map(record=>editable?record:{...record,peopleLinks:(record.peopleLinks||[]).filter(link=>link.public===true&&publicPeople.has(link.personId))})};
}
const respond = (value,status=200,headers={}) => json(value,status,{'Cache-Control':'private, no-store',Vary:'Cookie',...headers});
export function fieldJournalHandler(storeFactory = () => getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request => {
    const editable = authorized(request);
    if (!['GET','POST'].includes(request.method)) return respond({error:'Method not allowed.'},405,{Allow:'GET, POST'});
    if (request.method==='POST' && (!sameOrigin(request) || !editable)) return respond({error:'请先登录编辑。'},401);
    try {
      const store = storeFactory();
      async function read() {
        const entry = await store.getWithMetadata('field_entries',{type:'json'});
        const state = entry ? entry.data : empty();
        if (state?.version!==1 || !revisionValid(state.revision) || !Array.isArray(state.records) || new Set(state.records.map(record=>record.id)).size!==state.records.length) throw Error('Invalid journal state.');
        return {state,etag:entry?.etag};
      }
      const current = await read();
      let peopleState;
      async function readPeople(){
        if(!peopleState){const document=await store.getWithMetadata('people',{type:'json'});peopleState=document?.data||{version:1,records:[]};if(peopleState.version!==1||!Array.isArray(peopleState.records))throw Error('Invalid people state.');}
        return peopleState;
      }
      const publicPeople=new Set();
      if(!editable&&current.state.records.some(record=>record.visibility==='public'&&record.peopleLinks?.length))for(const person of (await readPeople()).records)if(publicPerson(person))publicPeople.add(person.id);
      const result = state => visibleState(state,request,editable,publicPeople);
      if (request.method==='GET') return respond(result(current.state));
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) return respond({error:'Use application/json.'},415);
      if (Number(request.headers.get('content-length'))>512*1024) return respond({error:'单条日志过大。'},413);
      const raw = await request.text();
      if (Buffer.byteLength(raw)>512*1024) return respond({error:'单条日志过大。'},413);
      let body;
      try { body=JSON.parse(raw); if (body.version!==1 || !revisionValid(body.revision) || !['save','delete'].includes(body.action)) throw Error('日志版本或操作无效。'); }
      catch(error) { return respond({error:error.message},400); }
      if (body.revision!==current.state.revision) return respond({...result(current.state),error:'其他页面已更新日志，填写内容仍保留，请再次保存。'},409);
      let id;
      try { id=text(body.action==='save' ? body.record?.id : body.id,120,true); }
      catch(error) { return respond({error:error.message},400); }
      const previous = current.state.records.find(record=>record.id===id);
      if ((previous && body.baseUpdatedAt!==previous.updatedAt) || (!previous && body.baseUpdatedAt)) return respond({...result(current.state),recordConflict:true,error:'这条日志已被修改或删除。填写内容仍保留，请取消后重新打开最新记录。'},409);
      let nextRecords;
      if (body.action==='delete') {
        if (!previous) return respond({error:'日志不存在。'},404);
        if (body.confirmDelete!==true) return respond({error:'删除日志需要明确确认。'},400);
        nextRecords = current.state.records.filter(record=>record.id!==id);
      } else {
        let record;
        try { record=normalizeFieldEntry(body.record,previous); }
        catch(error) { return respond({error:error.message},400); }
        if(record.peopleLinks.length){
          const ids=new Set((await readPeople()).records.map(person=>person.id));
          const retained=new Set((previous?.peopleLinks||[]).map(link=>link.personId));
          if(record.peopleLinks.some(link=>!ids.has(link.personId)&&!retained.has(link.personId)))return respond({error:'关联人物不存在，请重新选择已有档案。'},400);
        }
        const publicLinksExpanded=record.visibility==='public'&&record.peopleLinks.some(link=>link.public&&!previous?.peopleLinks?.some(old=>old.personId===link.personId&&old.roleInEntry===link.roleInEntry&&old.public));
        if(publicLinksExpanded&&body.confirmPublic!==true)return respond({error:'请确认后再公开新增的人物关联。'},400);
        if (record.visibility==='public' && previous?.visibility!=='public' && body.confirmPublic!==true) return respond({error:'请确认后再将日志公开到网站。'},400);
        if (record.legacyKey && current.state.records.some(item=>item.id!==record.id && item.placeId===record.placeId && item.placeKind===record.placeKind && item.legacyKey===record.legacyKey)) return respond({...result(current.state),recordConflict:true,error:'这条历史笔记已整理为日志，请打开已有记录。'},409);
        nextRecords = previous ? current.state.records.map(item=>item.id===record.id?record:item) : current.state.records.concat(record);
        if (nextRecords.length>50000) return respond({error:'日志集合已达到当前容量限制。'},400);
      }
      const next = {version:1,revision:current.state.revision+1,records:nextRecords};
      const saved = await store.setJSON('field_entries',next,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      if (!saved.modified) return respond({...result((await read()).state),error:'其他页面已保存，填写内容仍保留，请重试。'},409);
      return respond(result(next));
    } catch(error) {
      console.error('Field journal storage failed:',error.name);
      return respond({error:'田野日志暂时无法读写。填写内容仍保留，请稍后重试。'},503);
    }
  };
}
