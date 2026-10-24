import { randomUUID, createHash } from 'node:crypto';
import faithSeed from '../seed/faith.json' with {type:'json'};
import { deitySeed } from './deities.mjs';

const collections=['people','deities','faith','field_entries'];
const managed=new Set(collections),manifestKey='archive_manifest_v1';
const clone=value=>structuredClone(value);
const seed=kind=>kind==='deities'?clone(deitySeed):kind==='faith'?clone(faithSeed):{version:1,revision:0,records:[]};
const initial=()=>({version:1,revision:0,documents:{},redirects:{people:{},deities:{}},operations:[]});
const conflict=message=>Object.assign(Error(message),{code:'ARCHIVE_CONFLICT'});
function validateManifest(value) {
  if (value?.version!==1||!Number.isInteger(value.revision)||value.revision<0||!value.documents||!value.redirects||!Array.isArray(value.operations)) throw Error('Invalid archive manifest.');
  for (const key of Object.keys(value.documents)) if (!managed.has(key)||typeof value.documents[key]!=='string'||!value.documents[key].startsWith('archive_snapshots/')) throw Error('Invalid archive document pointer.');
  for (const kind of ['people','deities']) if (!value.redirects[kind]||typeof value.redirects[kind]!=='object'||Array.isArray(value.redirects[kind])) throw Error('Invalid archive redirects.');
}
export function canonicalId(manifest,kind,id) {
  const redirects=manifest.redirects?.[kind]||{},seen=new Set();
  while (Object.hasOwn(redirects,id)) {
    if (seen.has(id)) throw Error('Cyclic archive redirects.');
    seen.add(id);id=redirects[id];if (id===null) return null;
  }
  return id;
}
const unique=values=>[...new Set(values)];
function relationIdentity(link) {return JSON.stringify([link.personId,link.roleInEntry,link.notes||'',link.narratedAt||'',link.eventDateText||'',link.narrativeSource||'']);}
export function deduplicatePeopleLinks(links) {
  const result=[],seen=new Map();
  for (const link of links) {
    const key=relationIdentity(link),previous=seen.get(key);
    if (previous) previous.public=previous.public===true&&link.public===true;
    else {const copy=clone(link);seen.set(key,copy);result.push(copy);}
  }
  return result;
}
function canonicalize(states,manifest) {
  const existing={people:new Set(states.people.records.map(item=>item.id)),deities:new Set(states.deities.records.map(item=>item.id))};
  const resolve=(kind,id)=>{
    const next=canonicalId(manifest,kind,id);
    if (!next) throw conflict('关联档案已删除，请刷新后重新选择。');
    return next;
  };
  for (const item of states.faith.records) if(item.deityLinks) item.deityLinks=item.deityLinks.map(link=>({...link,deityId:resolve('deities',link.deityId)}));
  for (const item of [...states.people.records,...states.field_entries.records]) if(item.deityIds) item.deityIds=unique(item.deityIds.map(id=>resolve('deities',id)));
  for (const item of states.field_entries.records) if(item.peopleLinks) item.peopleLinks=deduplicatePeopleLinks(item.peopleLinks.map(link=>({...link,personId:resolve('people',link.personId)})));
  return existing;
}
function references(states) {
  const result=[];
  for(const item of states.faith.records) for(const link of item.deityLinks||[]) result.push(['deities',link.deityId]);
  for(const item of [...states.people.records,...states.field_entries.records]) for(const id of item.deityIds||[]) result.push(['deities',id]);
  for(const item of states.field_entries.records) for(const link of item.peopleLinks||[]) result.push(['people',link.personId]);
  return new Set(result.map(value=>JSON.stringify(value)));
}
export function createArchiveStore(raw) {
  if (raw.archiveStore===true) return raw;
  let pinned;
  async function load() {
    if (!pinned) pinned=(async()=>{
      const entry=await raw.getWithMetadata(manifestKey,{type:'json'}),manifest=entry?.data||initial();validateManifest(manifest);
      const entries={};
      await Promise.all(collections.map(async kind=>{
        entries[kind]=await raw.getWithMetadata(manifest.documents[kind]||kind,{type:'json'});
        const state=entries[kind]?.data;
        if (manifest.documents[kind]&&!state) throw Error('Archive snapshot is missing.');
        if(state&&(state.version!==1||!Number.isInteger(state.revision)||state.revision<0||!Array.isArray(state.records)||new Set(state.records.map(record=>record.id)).size!==state.records.length))throw Error('Invalid archive collection.');
      }));
      const token=createHash('sha256').update(JSON.stringify([entry?.etag||'',manifest.revision,...collections.map(kind=>entries[kind]?.etag||'')])).digest('hex');
      return {manifest,etag:entry?.etag,entries,token};
    })();
    return pinned;
  }
  const facade={archiveStore:true,
    async getWithMetadata(key,options) {
      if(!managed.has(key))return raw.getWithMetadata(key,options);
      const snapshot=await load(),entry=snapshot.entries[key];
      return entry?{...clone(entry),etag:snapshot.token+':'+key}:null;
    },
    async getSnapshot() {
      const snapshot=await load();
      return {token:snapshot.token,manifest:clone(snapshot.manifest),states:Object.fromEntries(collections.map(kind=>[kind,clone(snapshot.entries[kind]?.data||seed(kind))]))};
    },
    async redirects(kind) {return clone((await load()).manifest.redirects[kind]||{});},
    async resolveId(kind,id) {return canonicalId((await load()).manifest,kind,id);},
    async setJSON(key,data,options={}) {
      if(!managed.has(key))return raw.setJSON(key,data,options);
      const snapshot=await load(),exists=!!snapshot.entries[key];
      if ((options.onlyIfNew&&exists)||(options.onlyIfMatch&&options.onlyIfMatch!==snapshot.token+':'+key)) {pinned=null;return {modified:false};}
      let result;
      try{result=await facade.commit({[key]:data},{snapshotToken:snapshot.token});}
      catch(error){if(error.code!=='ARCHIVE_CONFLICT')throw error;pinned=null;return {modified:false};}
      return {modified:result.modified,etag:result.modified?result.token+':'+key:undefined};
    },
    async commit(updates,{snapshotToken,redirects,operation}={}) {
      const current=await load();
      if (snapshotToken!==current.token) {pinned=null;return {modified:false};}
      const states=Object.fromEntries(collections.map(kind=>[kind,clone(current.entries[kind]?.data||seed(kind))]));
      const before=clone(states),manifest=clone(current.manifest);
      for(const [kind,state] of Object.entries(updates)) {
        if(!managed.has(kind))throw Error('Unsupported archive collection.');
        if(state?.version!==1||!Array.isArray(state.records)||state.revision!==states[kind].revision+1)throw Error('Invalid archive update revision.');
        states[kind]=clone(state);
      }
      if (redirects) manifest.redirects=clone(redirects);
      for(const kind of ['people','deities']) {
        const ids=new Set(states[kind].records.map(item=>item.id));
        if(ids.size!==states[kind].records.length)throw Error('Duplicate archive ID.');
        for(const id of ids) if(Object.hasOwn(manifest.redirects[kind],id))throw conflict('此编号已合并或删除，请刷新档案。');
        if(!operation&&before[kind].records.some(item=>!ids.has(item.id)))throw conflict('请使用档案维护操作移除已有档案。');
      }
      const oldRefs=references(before),existing=canonicalize(states,manifest);
      for(const value of references(states)) {
        const [kind,id]=JSON.parse(value);
        if(!existing[kind].has(id)&&!oldRefs.has(value))throw conflict('关联档案不存在，请刷新后重新选择。');
      }
      const now=Date.now();
      for(const kind of collections)for(const record of states[kind].records){const old=before[kind].records.find(item=>item.id===record.id);if(old&&record.updatedAt===old.updatedAt&&JSON.stringify(record)!==JSON.stringify(old))record.updatedAt=new Date(Math.max(now,(Date.parse(old.updatedAt)||0)+1)).toISOString();}
      // Canonicalized references may affect a collection beyond the initiating writer.
      for(const kind of collections) if(JSON.stringify(states[kind])!==JSON.stringify(before[kind])&&!updates[kind])states[kind].revision=before[kind].revision+1;
      const transaction=randomUUID();
      for(const kind of collections) if(!manifest.documents[kind]||JSON.stringify(states[kind])!==JSON.stringify(before[kind])) {
        const key='archive_snapshots/'+transaction+'/'+kind;
        const written=await raw.setJSON(key,states[kind],{onlyIfNew:true});
        if(!written.modified)throw Error('Archive snapshot could not be created.');
        manifest.documents[kind]=key;
      }
      manifest.revision++;
      if(operation)manifest.operations=[...manifest.operations,{id:transaction,...clone(operation),at:new Date().toISOString()}].slice(-200);
      const changed=await raw.setJSON(manifestKey,manifest,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      pinned=null;
      if(!changed.modified)return {modified:false};
      const next=await load();return {modified:true,token:next.token};
    }
  };
  return facade;
}
