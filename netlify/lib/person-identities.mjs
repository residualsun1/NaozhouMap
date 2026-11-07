import {createHash,randomUUID} from 'node:crypto';

const namespace=Buffer.from('671a09e72563432895784dbef0677746','hex');
const reserved=new Set(['全部人物','待整理','待整理 · 无身份标签','已归档']);
const unique=values=>[...new Set(values)];
export const identityName=value=>typeof value==='string'?value.trim():'';
function legacyId(name){
  const bytes=createHash('sha1').update(namespace).update(name,'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function roleNames(person){return unique((person.roles||[]).map(identityName).filter(Boolean));}
export function prepareIdentityState(input,{extraRoles=[],now=new Date().toISOString()}={}){
  const state=structuredClone(input);
  if(state.identitySchemaVersion===1){
    if(!Array.isArray(state.identityTypes)||state.identityTypes.length>500)throw Error('身份目录格式无效。');
    const ids=new Set(),names=new Set();
    for(const type of state.identityTypes){
      if(typeof type.id!=='string'||!type.id||ids.has(type.id)||!identityName(type.name)||names.has(identityName(type.name))||typeof type.isActive!=='boolean'||!Number.isFinite(type.sortOrder))throw Error('身份目录存在无效或重复记录。');
      ids.add(type.id);names.add(identityName(type.name));
    }
    for(const person of state.records)if(!Array.isArray(person.identityTypeIds)||person.identityTypeIds.some(id=>!ids.has(id))||new Set(person.identityTypeIds).size!==person.identityTypeIds.length)throw Error('人物身份关联无效。');
    return state;
  }
  const names=unique([...state.records.flatMap(roleNames),...extraRoles.map(identityName).filter(Boolean)]).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  if(names.length>500)throw Error('身份类型超过当前可维护数量。');
  state.identityTypes=names.map((name,index)=>({id:legacyId(name),name,description:'',sortOrder:index,isActive:true,createdAt:now,updatedAt:now}));
  const byName=new Map(state.identityTypes.map(type=>[type.name,type.id]));
  const before=state.records.reduce((sum,person)=>sum+roleNames(person).length,0);
  state.records=state.records.map(person=>{const next={...person,identityTypeIds:roleNames(person).map(name=>byName.get(name))};delete next.roles;return next;});
  if(state.records.reduce((sum,person)=>sum+person.identityTypeIds.length,0)!==before)throw Error('身份迁移数量不一致，原资料未修改。');
  state.identitySchemaVersion=1;return state;
}
export function normalizePersonIdentities(input,previous,types){
  let ids=input.identityTypeIds;
  if(ids===undefined){
    if(input.roles!==undefined){
      if(!Array.isArray(input.roles))throw Error('请选择已有的身份类型。');
      const byName=new Map(types.map(type=>[identityName(type.name),type.id]));
      ids=input.roles.map(name=>{const id=byName.get(identityName(name));if(!id)throw Error('身份类型已调整，请刷新后选择已有身份。');return id;});
    }else ids=previous?.identityTypeIds||[];
  }
  if(!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string'))throw Error('人物身份选择无效或过多。');
  ids=unique(ids);const byId=new Map(types.map(type=>[type.id,type])),old=new Set(previous?.identityTypeIds||[]);
  for(const id of ids){const type=byId.get(id);if(!type)throw Error('所选身份已删除，请刷新后重新选择。');if(!type.isActive&&!old.has(id))throw Error('已归档身份不能用于新增关联。');}
  return {identityTypeIds:ids,roles:ids.map(id=>byId.get(id).name)};
}
export function projectIdentityNames(state){
  const byId=new Map(state.identityTypes.map(type=>[type.id,type]));
  return state.records.map(person=>({...person,roles:(person.identityTypeIds||[]).map(id=>byId.get(id)?.name).filter(Boolean)}));
}
export function identityStats(records,types){
  const byId=Object.fromEntries(types.map(type=>[type.id,{active:0,total:0}])),enabled=new Set(types.filter(type=>type.isActive).map(type=>type.id));
  let all=0,unclassified=0,archived=0;
  for(const person of records){
    if(person.mergedInto)continue;
    const ids=unique(person.identityTypeIds||[]);
    if(person.archivedAt)archived++;else{all++;if(Array.isArray(person.identityTypeIds)&&!ids.some(id=>enabled.has(id)))unclassified++;}
    for(const id of ids)if(byId[id]){byId[id].total++;if(!person.archivedAt)byId[id].active++;}
  }
  return {all,unclassified,archived,byId};
}
export function editIdentityState(state,body,now=new Date().toISOString()){
  const next=structuredClone(state),types=next.identityTypes;
  const current=types.find(type=>type.id===body.id);
  if(body.action==='identity-save'){
    const input=body.identity;
    if(input?.description!==undefined&&typeof input.description!=='string')throw Error('身份说明格式无效。');
    const name=identityName(input?.name),description=typeof input?.description==='string'?input.description.trim():'';
    if(!name||name.length>100||description.length>3000||reserved.has(name))throw Error('请填写有效的身份名称，系统分类不能作为身份类型。');
    const existing=input?.id?types.find(type=>type.id===input.id):null;
    if(input?.id&&!existing)throw Error('身份类型已删除，请刷新。');
    if(types.some(type=>type.id!==existing?.id&&identityName(type.name)===name))throw Error('该身份名称已存在，含已归档身份。');
    if(existing)Object.assign(existing,{name,description,updatedAt:now});
    else{if(types.length>=500)throw Error('身份类型数量已达上限。');types.push({id:randomUUID(),name,description,sortOrder:Math.max(-1,...types.map(type=>type.sortOrder))+1,isActive:true,createdAt:now,updatedAt:now});}
  }else if(body.action==='identity-reorder'){
    const ids=body.orderedIds;
    if(!Array.isArray(ids)||ids.length!==types.length||new Set(ids).size!==types.length||ids.some(id=>!types.some(type=>type.id===id)))throw Error('身份排序已变化，请刷新后重试。');
    for(const [index,id]of ids.entries()){const type=types.find(type=>type.id===id);if(type.sortOrder!==index)Object.assign(type,{sortOrder:index,updatedAt:now});}
  }else{
    if(!current)throw Error('身份类型不存在。');
    if(body.confirm!==true)throw Error('请明确确认归档、恢复或删除操作。');
    if(body.action==='identity-status'){
      if(typeof body.isActive!=='boolean')throw Error('身份启用状态无效。');
      Object.assign(current,{isActive:body.isActive,updatedAt:now});
    }else if(body.action==='identity-delete'){
      const linked=next.records.filter(person=>person.identityTypeIds.includes(current.id));
      if(linked.length){
        const target=types.find(type=>type.id===body.reassignToId&&type.id!==current.id&&type.isActive);
        if(!target)throw Object.assign(Error('该身份仍有关联人物，请先归档，或选择启用身份转移关联后删除。'),{status:409,identityInUse:true,referenceCount:linked.length});
        for(const person of linked)person.identityTypeIds=unique(person.identityTypeIds.map(id=>id===current.id?target.id:id));
      }
      next.identityTypes=types.filter(type=>type.id!==current.id);
    }else throw Error('身份操作无效。');
  }
  // Names are projected only in API responses; the persisted relationship uses stable IDs.
  return next;
}
