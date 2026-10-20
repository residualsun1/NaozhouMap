import { getStore } from '@netlify/blobs';
import pointsSeed from '../seed/points.json' with {type:'json'};
import faithSeed from '../seed/faith.json' with {type:'json'};
import { authorized, json, sameOrigin } from './auth.mjs';

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
export function normalizeFaith(items) {
  identifiers(items);
  return items.map(item => {
    if (!required(item.villageId,120) || !['reference','survey'].includes(item.villageKind) || !required(item.villageName,100)) throw Error('村庄关联无效。');
    if (!Array.isArray(item.deities) || !item.deities.length || item.deities.length > 100 || item.deities.some(name=>!required(name,100))) throw Error('神明名称无效。');
    const record = {id:item.id,villageId:item.villageId,villageKind:item.villageKind,villageName:item.villageName.trim(),deities:[...new Set(item.deities.map(name=>name.trim()))]};
    for (const [field,limit] of Object.entries({temple:200,festival:500,source:200,visitedOn:10,note:5000,createdAt:100,updatedAt:100})) record[field]=text(item[field],limit);
    if (record.visitedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(record.visitedOn) || new Date(record.visitedOn).toISOString().slice(0,10)!==record.visitedOn)) throw Error('走访日期无效。');
    record.createdAt ||= new Date().toISOString();record.updatedAt ||= new Date().toISOString();
    return record;
  });
}
const seeds = {points:pointsSeed,faith:faithSeed};
async function readState(store,kind) {
  const entry=await store.getWithMetadata(kind,{type:'json'});
  return {state:entry?.data || structuredClone(seeds[kind]),etag:entry?.etag};
}
export function recordsHandler(kind, storeFactory = () => getStore({name:'naozhou-field-atlas',consistency:'strong'})) {
  return async request => {
    if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
    if (request.method === 'POST' && (!sameOrigin(request) || !authorized(request))) return json({error:'请先登录编辑。'},401);
    try {
      const store=storeFactory(), current=await readState(store,kind);
      if (request.method==='GET') return json(current.state);
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) return json({error:'Use application/json.'},415);
      if (Number(request.headers.get('content-length')) > 5*1024*1024) return json({error:'资料过大，请分批导入。'},413);
      const raw=await request.text();
      if (Buffer.byteLength(raw)>5*1024*1024) return json({error:'资料过大，请分批导入。'},413);
      let body,items;
      try {
        body=JSON.parse(raw);
        if (!revisionValid(body.revision) || (kind==='faith' && body.version!==1)) throw Error('记录版本无效。');
        items=kind==='points'?normalizePoints(body.points):normalizeFaith(body.records);
      } catch(error) {return json({error:error.message},400);}
      if (body.revision!==current.state.revision) return json(current.state,409);
      const next={version:1,revision:current.state.revision+1,[kind==='points'?'points':'records']:items};
      if (kind==='points') {
        const retired=new Set(pointsSeed.deletedIds);
        if (items.some(point=>retired.has(point.id))) return json({error:'这些点位已转为参考地点，请创建新的调查记录。'},422);
        const present=new Set(items.map(point=>point.id));
        next.deletedIds=[...new Set([...(current.state.deletedIds||[]),...current.state.points.filter(point=>!present.has(point.id)).map(point=>point.id)])].filter(id=>!present.has(id));
      }
      const saved=await store.setJSON(kind,next,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      if (!saved.modified) return json((await readState(store,kind)).state,409);
      return json(next);
    } catch(error) {
      console.error('Cloud storage operation failed:',error.name);
      return json({error:'云端暂时无法读写，填写内容仍保留，请稍后重试。'},503);
    }
  };
}
