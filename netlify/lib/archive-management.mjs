import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { json, resolveEditorAuth, sameOrigin } from './auth.mjs';
import { createArchiveStore, canonicalId } from './archive-store.mjs';
import { normalizePerson } from './people.mjs';
import { normalizeDeityCatalog } from './deities.mjs';

const validKind=kind=>['people','deities'].includes(kind);
const name=record=>record?.displayName||record?.name||'';
const normalized=value=>(value||'').trim().toLocaleLowerCase();
const words=record=>new Set([name(record),...(record.aliases||[]),record.religiousName||''].map(normalized).filter(Boolean));
const distinct=values=>[...new Set(values)];
const bodyFields={people:['biography','ritualQualificationNote','oralHistory','publicSummary','researchNotes','realName','surname','religiousName','narratedAt','eventDateText','narrativeSource'],deities:['description','identityNote']};
function conflictFields(kind,source,target) {return bodyFields[kind].filter(field=>source[field]&&target[field]&&source[field]!==target[field]).map(field=>({field,source:source[field],target:target[field]}));}
function duplicateCandidates(record,records) {
  const identities=words(record);
  return records.filter(other=>other.id!==record.id&&[...words(other)].some(value=>identities.has(value))).map(other=>({id:other.id,name:name(other),archivedAt:other.archivedAt||''}));
}
export function archiveReferences(states,kind,id) {
  const items=[];
  const add=(collection,record,field,index,relationType='')=>items.push({key:JSON.stringify([collection,record.id,field,index]),collection,recordId:record.id,label:record.title||record.villageName||name(record)||record.id,field,index,relationType,...(record.placeId||record.villageId?{placeId:record.placeId||record.villageId,placeKind:record.placeKind||record.villageKind}:{})});
  if(kind==='people') {
    const person=states.people.records.find(item=>item.id===id);
    for(const [index,link] of (person?.placeLinks||[]).entries()){add('people',person,'placeLinks',index,link.relationType);Object.assign(items.at(-1),{placeId:link.placeId,placeKind:link.placeKind});}
    for(const [index,deityId] of (person?.deityIds||[]).entries()){add('people',person,'deityIds',index,'相关神明');items.at(-1).deityId=deityId;}
    for(const record of states.field_entries.records) for(const [index,link] of (record.peopleLinks||[]).entries())if(link.personId===id)add('field_entries',record,'peopleLinks',index,link.roleInEntry);
  } else {
    for(const record of states.faith.records)for(const [index,link] of (record.deityLinks||[]).entries())if(link.deityId===id)add('faith',record,'deityLinks',index,link.localTitle||link.localName||'信仰记录');
    for(const collection of ['people','field_entries'])for(const record of states[collection].records)for(const [index,deityId] of (record.deityIds||[]).entries())if(deityId===id)add(collection,record,'deityIds',index,'相关神明');
  }
  return {total:items.length,items};
}
function stats(states) {
  const duplicatePairs=new Set();
  for(const kind of ['people','deities']) {
    const names=new Map();
    for(const record of states[kind].records)for(const value of words(record)){const previous=names.get(value)||[];for(const id of previous)duplicatePairs.add(JSON.stringify([kind,...[id,record.id].sort()]));previous.push(record.id);names.set(value,previous);}
  }
  const pendingLinks=states.faith.records.reduce((sum,record)=>sum+record.deities.filter((_,index)=>!record.deityLinks?.some(link=>link.nameIndex===index)).length,0);
  return {people:states.people.records.length,deities:states.deities.records.length,pendingLinks,duplicatePairs:duplicatePairs.size,archived:[...states.people.records,...states.deities.records].filter(record=>record.archivedAt).length};
}
const combined=(target,source)=>!target?source||'':!source||target===source?target:target+'\n\n'+source;
function mergeRecord(kind,source,target,choices,now) {
  const merged=structuredClone(target),conflicts=conflictFields(kind,source,target);
  for(const conflict of conflicts)if(!['target','source','both'].includes(choices?.[conflict.field]))throw Error('请逐项选择冲突内容的保留方式。');
  for(const field of bodyFields[kind]) {
    const choice=choices?.[field];
    merged[field]=choice==='source'?source[field]:choice==='both'?combined(target[field],source[field]):target[field]||source[field]||'';
  }
  merged.source=combined(target.source,source.source);
  merged.aliases=distinct([...(target.aliases||[]),...(source.aliases||[]),name(source)]).filter(value=>value&&value!==name(target));
  merged.mergedFromIds=distinct([...(target.mergedFromIds||[]),source.id,...(source.mergedFromIds||[])]);
  merged.updatedAt=now;
  if(kind==='deities')merged.titleIds=distinct([...(target.titleIds||[]),...(source.titleIds||[])]);
  else {
    const sourceRole=source.narratorRole||'unknown',targetRole=target.narratorRole||'unknown';
    if(sourceRole!==targetRole) {
      const labels={participant:'事件参与者',eyewitness:'亲历叙述者',reteller:'转述者',mentioned:'叙述涉及者',unknown:'身份未详'};
      merged.researchNotes=combined(merged.researchNotes,'合并前口述身份：'+target.id+' — '+labels[targetRole]+'；'+source.id+' — '+labels[sourceRole]+'。');
      if(source.oralHistory&&target.oralHistory)merged.narratorRole=choices?.oralHistory==='source'?sourceRole:choices?.oralHistory==='target'?targetRole:'unknown';
      else if(source.oralHistory)merged.narratorRole=sourceRole;
    }
    merged.roles=distinct([...(target.roles||[]),...(source.roles||[])]);
    merged.deityIds=distinct([...(target.deityIds||[]),...(source.deityIds||[])]);
    const links=new Map(),ids=new Set();
    for(const link of [...(target.placeLinks||[]),...(source.placeLinks||[])]) {
      const identity=JSON.stringify([link.placeId,link.placeKind,link.relationType,link.notes||'',link.source||'']);
      const old=links.get(identity);
      if(old){old.public=old.public===true&&link.public===true;continue;}
      const copy=structuredClone(link);if(ids.has(copy.id))copy.id=randomUUID();ids.add(copy.id);links.set(identity,copy);
    }
    merged.placeLinks=[...links.values()];
    // Combining a private source cannot silently publish its contents or identities.
    const visibility=['editors','summary','public'];merged.visibility=visibility[Math.min(visibility.indexOf(target.visibility||'editors'),visibility.indexOf(source.visibility||'editors'))];
    merged.publishIdentity=target.publishIdentity===true&&source.publishIdentity===true;
    merged.publishOralHistory=target.publishOralHistory===true&&source.publishOralHistory===true;
  }
  return merged;
}
function detachReferences(states,items,keys) {
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!items.some(item=>item.key===key)))throw Error('解除关联的选择已失效，请重新预览。');
  const selected=new Set(keys),groups=new Map();
  for(const item of items)if(selected.has(item.key)){const groupKey=JSON.stringify([item.collection,item.recordId,item.field]),indices=groups.get(groupKey)||new Set();indices.add(item.index);groups.set(groupKey,indices);}
  for(const [key,indices] of groups){const [collection,id,field]=JSON.parse(key),record=states[collection].records.find(record=>record.id===id);record[field]=record[field].filter((_,index)=>!indices.has(index));}
}
const respond=(body,status=200)=>json(body,status,{'Cache-Control':'private, no-store',Vary:'Cookie'});
export function archiveManagementHandler(storeFactory=()=>getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request=>{
    if(!['GET','POST'].includes(request.method))return respond({error:'Method not allowed.'},405);
    if(request.method==='POST'&&!sameOrigin(request))return respond({error:'请从图集页面操作。'},403);
    try {
      const store=createArchiveStore(storeFactory());
      if(!(await resolveEditorAuth(store)).authorized(request))return respond({error:'请先登录编辑。'},401);
      const snapshot=await store.getSnapshot(),{states,manifest}=snapshot;
      if(request.method==='GET') {
        const query=new URL(request.url).searchParams,kind=query.get('kind'),id=query.get('id');
        if(!kind&&!id)return respond({stats:stats(states),operations:manifest.operations.slice(-30).reverse(),snapshotToken:snapshot.token});
        if(!validKind(kind)||!id)return respond({error:'请指定人物或神明档案。'},400);
        const resolved=canonicalId(manifest,kind,id),record=states[kind].records.find(record=>record.id===resolved);
        if(!record)return respond({error:'档案不存在或已删除。'},404);
        return respond({kind,id,canonicalId:resolved,record,refs:archiveReferences(states,kind,resolved),duplicates:duplicateCandidates(record,states[kind].records),stats:stats(states),operations:manifest.operations.filter(item=>item.kind===kind&&[item.id,item.sourceId,item.targetId,item.recordId].includes(id)).slice(-30).reverse(),snapshotToken:snapshot.token});
      }
      if(!(request.headers.get('content-type')||'').startsWith('application/json'))return respond({error:'Use application/json.'},415);
      if(Number(request.headers.get('content-length'))>512*1024)return respond({error:'维护请求过大。'},413);
      const raw=await request.text();if(Buffer.byteLength(raw)>512*1024)return respond({error:'维护请求过大。'},413);
      let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return respond({error:'维护请求格式无效。'},400);}
      const {kind,action}=body;
      if(!validKind(kind)||!['preview','archive','restore','delete','merge'].includes(action))return respond({error:'档案类型或操作无效。'},400);
      if(action==='preview'||action==='merge') {
        const sourceId=canonicalId(manifest,kind,body.sourceId),targetId=canonicalId(manifest,kind,body.targetId);
        const source=states[kind].records.find(record=>record.id===sourceId),target=states[kind].records.find(record=>record.id===targetId);
        if(!source||!target||sourceId===targetId)return respond({error:'请选择两个不同且存在的档案。'},400);
        if(sourceId!==body.sourceId||targetId!==body.targetId)return respond({error:'所选档案已发生合并，请刷新后重新预览。'},409);
        const refs={source:archiveReferences(states,kind,sourceId),target:archiveReferences(states,kind,targetId)};
        if(action==='preview')return respond({kind,source,target,refs,conflicts:conflictFields(kind,source,target),snapshotToken:snapshot.token});
      }
      if(body.confirm!==true||typeof body.snapshotToken!=='string')return respond({error:'请确认操作并使用当前预览。'},400);
      if(body.snapshotToken!==snapshot.token)return respond({error:'其他页面已更新资料，请重新预览后操作。',snapshotToken:snapshot.token},409);
      const now=new Date().toISOString(),updates={},redirects=structuredClone(manifest.redirects),operation={action,kind};
      try {
        if(action==='merge') {
          const source=states[kind].records.find(record=>record.id===body.sourceId),target=states[kind].records.find(record=>record.id===body.targetId);
          const merged=mergeRecord(kind,source,target,body.choices,now);
          if(kind==='people') {
            const normalizedRecord=normalizePerson(merged,target,now);normalizedRecord.mergedFromIds=merged.mergedFromIds;
            states.people.records=states.people.records.filter(record=>record.id!==source.id).map(record=>record.id===target.id?normalizedRecord:record);
          } else {
            const next={...states.deities,records:states.deities.records.filter(record=>record.id!==source.id).map(record=>record.id===target.id?merged:record)};
            // Validate retained records against a current set without the explicitly merged source.
            const normalizedCatalog=normalizeDeityCatalog(next,{...states.deities,records:states.deities.records.filter(record=>record.id!==source.id)});
            normalizedCatalog.records.find(record=>record.id===target.id).mergedFromIds=merged.mergedFromIds;states.deities.records=normalizedCatalog.records;
          }
          redirects[kind]={...redirects[kind],[source.id]:target.id};
          for(const id of Object.keys(redirects[kind]))if(redirects[kind][id]!==null)redirects[kind][id]=canonicalId({redirects},kind,id);
          Object.assign(operation,{sourceId:source.id,targetId:target.id,choices:Object.fromEntries(conflictFields(kind,source,target).map(item=>[item.field,body.choices[item.field]]))});
        } else {
          const canonical=canonicalId(manifest,kind,body.id),record=states[kind].records.find(record=>record.id===canonical);
          if(!record)return respond({error:'档案不存在或已删除。'},404);
          if(canonical!==body.id)return respond({error:'此档案已合并，请打开主档案。',canonicalId:canonical},409);
          if(action==='delete') {
            const refs=archiveReferences(states,kind,record.id);
            if(body.detach?.length)detachReferences(states,refs.items,body.detach);
            const remaining=archiveReferences(states,kind,record.id);
            if(remaining.total)return respond({error:'档案仍有关联，不能永久删除。请先明确解除关联或选择合并。',refs:remaining,snapshotToken:snapshot.token},409);
            states[kind].records=states[kind].records.filter(item=>item.id!==record.id);redirects[kind]={...redirects[kind],[record.id]:null};
            for(const id of Object.keys(redirects[kind]))if(redirects[kind][id]!==null)redirects[kind][id]=canonicalId({redirects},kind,id);
          } else {record.archivedAt=action==='archive'?now:'';record.updatedAt=now;}
          operation.recordId=record.id;
        }
      } catch(error){return respond({error:error.message},400);}
      // Compare against a fresh immutable view of the pinned transaction, without rereading live data.
      const original=await store.getSnapshot();
      for(const collection of ['people','deities','faith','field_entries'])if(JSON.stringify(states[collection])!==JSON.stringify(original.states[collection]))updates[collection]={...states[collection],revision:original.states[collection].revision+1};
      const saved=await store.commit(updates,{snapshotToken:snapshot.token,redirects,operation});
      if(!saved.modified)return respond({error:'其他页面已保存，未执行部分操作。请重新预览。'},409);
      return respond({ok:true,action,canonicalId:body.targetId||body.id,snapshotToken:saved.token});
    } catch(error) {
      console.error('Archive maintenance failed:',error.name);
      return respond({error:'档案维护暂时不可用，没有提交部分修改，请稍后重试。'},503);
    }
  };
}
