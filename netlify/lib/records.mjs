import { getStore } from '@netlify/blobs';
import pointsSeed from '../seed/points.json' with {type:'json'};
import faithSeed from '../seed/faith.json' with {type:'json'};
import { resolveEditorAuth, json, sameOrigin } from './auth.mjs';
import { deitySeed, normalizeDeityCatalog, normalizeDeityLinks } from './deities.mjs';
import { createArchiveStore } from './archive-store.mjs';
import { faithPlaceIndex, faithAssociationAction } from './faith-associations.mjs';
import { updateFaithWorship } from './faith-worship.mjs';
import { publicObservances } from './deity-observances.mjs';
import worship from '../../worship-info.js';

const revisionValid = value => Number.isInteger(value) && value >= 0 && value < 2147483647;
const required = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
function text(value, limit) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit) throw Error('资料字段无效或过长。');
  return value.trim();
}
function identifiers(items) {
  if (!Array.isArray(items) || items.length > 10000) throw Error('记录数量或格式无效。');
  const ids = new Set();
  for (const item of items) {
    if (!required(item?.id,120) || ids.has(item.id)) throw Error('记录编号无效或重复。');
    ids.add(item.id);
  }
}
export function normalizePoints(items) {
  identifiers(items);
  return items.map(item => {
    if (!required(item.name,100) || !Number.isFinite(item.lat) || Math.abs(item.lat) > 90 || !Number.isFinite(item.lng) || Math.abs(item.lng) > 180) throw Error('点位名称或坐标无效。');
    return {id:item.id,name:item.name.trim(),lat:item.lat,lng:item.lng,source:text(item.source,200),note:text(item.note,5000),createdAt:text(item.createdAt,100)||new Date().toISOString(),updatedAt:text(item.updatedAt,100)||new Date().toISOString()};
  });
}
export function normalizeFaith(items, previous=[], catalog=deitySeed) {
  identifiers(items);
  return items.map(item => {
    if (!required(item.villageId,120) || !['reference','survey'].includes(item.villageKind) || !required(item.villageName,100)) throw Error('村庄关联无效。');
    if (!Array.isArray(item.deities) || !item.deities.length || item.deities.length > 100 || item.deities.some(name=>!required(name,100))) throw Error('神明名称无效。');
    const record = {id:item.id,villageId:item.villageId,villageKind:item.villageKind,villageName:item.villageName.trim(),deities:item.deities.map(name=>name.trim())};
    const old = previous.find(record=>record.id===item.id);
    if (item.deityLinks === undefined && old?.deityLinks?.length && (JSON.stringify(record.deities)!==JSON.stringify(old.deities) || item.villageId!==old.villageId || item.villageKind!==old.villageKind)) throw Error('此记录已有关联，请刷新页面后再修改神明名称或村庄。');
    if (item.deityLinks !== undefined || old?.deityLinks !== undefined) record.deityLinks = normalizeDeityLinks(item.deityLinks ?? old.deityLinks,record.deities,catalog,old?.villageId===item.villageId&&old?.villageKind===item.villageKind?old.deityLinks:[]);
    for (const [field,limit] of Object.entries({temple:200,festival:500,source:200,visitedOn:10,note:5000,createdAt:100,updatedAt:100})) record[field]=text(item[field],limit);
    if (record.visitedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(record.visitedOn) || new Date(record.visitedOn).toISOString().slice(0,10)!==record.visitedOn)) throw Error('走访日期无效。');
    record.createdAt ||= new Date().toISOString();record.updatedAt ||= new Date().toISOString();
    return record;
  });
}
export function normalizeArchives(items) {
  identifiers(items);
  const places = new Set();
  return items.map(item => {
    if (!required(item.villageId,120) || !['reference','survey'].includes(item.villageKind) || !required(item.villageName,100)) throw Error('村庄关联无效。');
    const key = item.villageKind + ':' + item.villageId;
    if (places.has(key)) throw Error('同一村庄存在重复档案。');
    places.add(key);
    return {id:item.id,villageId:item.villageId,villageKind:item.villageKind,villageName:item.villageName.trim(),introduction:text(item.introduction,20000),note:text(item.note,20000),createdAt:text(item.createdAt,100)||new Date().toISOString(),updatedAt:text(item.updatedAt,100)||new Date().toISOString()};
  });
}
const seeds = {points:pointsSeed,faith:faithSeed,archives:{version:1,revision:0,records:[]},deities:deitySeed};
const normalizers = {points:normalizePoints,faith:normalizeFaith,archives:normalizeArchives};
const placeIds = new Set(faithPlaceIndex.places.map(place => place.id));
const villageIds = new Set(faithPlaceIndex.places.filter(place =>
  ['natural_village', 'administrative_seat'].includes(place.placeKind) && !place.parentVillageId
).map(place => place.id));

async function deityState(store, state, details, editable) {
  if (editable && details) return {...state, editable: true};
  const publicEntries = new Map();
  const hasEntryLinks = details && state.records.some(record => record.rotationGroups?.some(group =>
    group.visibility === 'public' && group.scheduleBatches.some(batch => batch.stops.some(stop => stop.entryId && villageIds.has(stop.placeId)))
  ));
  if (hasEntryLinks) {
    const journals = await store.getWithMetadata('field_entries',{type:'json'});
    for (const entry of journals?.data.records || []) {
      if (entry.visibility === 'public' && entry.placeKind === 'reference') publicEntries.set(entry.id,entry.placeId);
    }
  }
  const records = state.records.map(record => {
    const {birthdays, rotationGroups, ...summary} = record;
    return details ? {...summary, ...publicObservances({birthdays, rotationGroups}, villageIds, publicEntries)} : summary;
  });
  return {...state, records, ...(details ? {editable: false} : {})};
}

async function readState(store,kind) {
  const entry=await store.getWithMetadata(kind,{type:'json'});
  const state=entry?.data || structuredClone(seeds[kind]);
  if(kind==='deities')state.redirects=await store.redirects('deities');
  return {state,etag:entry?.etag};
}
export function recordsHandler(kind, storeFactory = () => getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request => {
    if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
    if (request.method === 'POST' && !sameOrigin(request)) return json({error:'请先登录编辑。'},401);
    if (kind==='faith' && request.method==='GET' && new URL(request.url).searchParams.get('view')==='places') return json(faithPlaceIndex);
    try {
      const rawStore=storeFactory(),store=['faith','deities'].includes(kind)?createArchiveStore(rawStore):rawStore;
      const query = new URL(request.url).searchParams;
      const details = kind === 'deities' && (query.get('view') === 'archive' || query.has('id'));
      const editable = request.method === 'POST' || details ? (await resolveEditorAuth(store)).authorized(request) : false;
      if(request.method==='POST'&&!editable)return json({error:'请先登录编辑。'},401);
      const respond = async (state, status = 200) => kind === 'deities'
        ? json(await deityState(store, state, details, editable), status, {'Cache-Control': 'private, no-store', Vary: 'Cookie'})
        : json(state, status);
      const current=await readState(store,kind);
      if (request.method==='GET') {
        if(kind==='faith')return json({...current.state,records:current.state.records.map(record=>({...record,...(record.deityLinks?{deityLinks:record.deityLinks.map(link=>({...link,...worship.info(link)}))}:{})}))});
        if(kind==='deities'&&query.has('id')){const id=await store.resolveId('deities',query.get('id'));return await respond({...current.state,records:current.state.records.filter(record=>record.id===id)});}
        return await respond(current.state);
      }
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) return json({error:'Use application/json.'},415);
      if (Number(request.headers.get('content-length')) > 5*1024*1024) return json({error:'资料过大，请分批导入。'},413);
      const raw=await request.text();
      if (Buffer.byteLength(raw)>5*1024*1024) return json({error:'资料过大，请分批导入。'},413);
      let body,items,deityCatalog;
      try { body=JSON.parse(raw); } catch { return json({error:'资料不是有效的 JSON。'},400); }
      if (kind==='faith' && body?.action) {
        if (body.action === 'update-worship') return await updateFaithWorship(store,body);
        if (!['preview-villages','link-villages'].includes(body.action)) return json({error:'未知的关联操作。'},400);
        return await faithAssociationAction(store,body);
      }
      try {
        if (!revisionValid(body.revision) || (kind!=='points' && body.version!==1)) throw Error('记录版本无效。');
        if (kind==='deities') { deityCatalog=normalizeDeityCatalog(body,current.state,placeIds); items=deityCatalog.records; }
        else if (kind==='faith') items=normalizeFaith(body.records,current.state.records,(await readState(store,'deities')).state);
        else items=normalizers[kind](kind==='points'?body.points:body.records);
      } catch(error) {return json({error:error.message},400);}
      if (body.revision!==current.state.revision) return await respond(current.state,409);
      const next={version:1,revision:current.state.revision+1,[kind==='points'?'points':'records']:items};
      if (kind==='deities') next.titles=deityCatalog.titles;
      if (kind==='points') {
        const retired=new Set(pointsSeed.deletedIds);
        if (items.some(point=>retired.has(point.id))) return json({error:'这些点位已转为参考地点，请创建新的调查记录。'},422);
        const present=new Set(items.map(point=>point.id));
        next.deletedIds=[...new Set([...(current.state.deletedIds||[]),...current.state.points.filter(point=>!present.has(point.id)).map(point=>point.id)])].filter(id=>!present.has(id));
      }
      const saved=await store.setJSON(kind,next,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      if (!saved.modified) return await respond((await readState(store,kind)).state,409);
      return await respond(['faith','deities'].includes(kind)?(await readState(store,kind)).state:next);
    } catch(error) {
      if(error.code==='ARCHIVE_CONFLICT')return json({error:'档案或关联已合并、删除，请刷新后重新保存。填写内容仍保留。'},409);
      console.error('Cloud storage operation failed:',error.name);
      return json({error:'云端暂时无法读写，填写内容仍保留，请稍后重试。'},503);
    }
  };
}
