export const initialTitles = [
  ['hui-zhu','会主'],['jing-zhu','境主'],['jun-zhu','军主'],['ying-zhu','营主'],
  ['bu-zhu','埠主'],['fu-zhu','福主'],['he-zhu','褐主'],['an-zhu','案主']
].map(([id,name])=>({id,name}));
export const deitySeed = {version:1,revision:0,titles:initialTitles,records:[]};
const required = (value,max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function text(value,max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw Error('神明资料字段无效或过长。');
  return value.trim();
}
function uniqueRecords(items,max=10000) {
  if (!Array.isArray(items) || items.length > max) throw Error('神明资料格式无效。');
  const ids = new Set();
  for (const item of items) {
    if (!required(item?.id,120) || ids.has(item.id)) throw Error('神明或神函编号无效、重复。');
    ids.add(item.id);
  }
}
export function normalizeDeityCatalog(body,current=deitySeed) {
  uniqueRecords(body.titles,200); uniqueRecords(body.records);
  const titles=body.titles.map(item=>{
    if (!required(item.name,80)) throw Error('请填写神函名称。');
    return {id:item.id,name:item.name.trim()};
  });
  if (new Set(titles.map(item=>item.name)).size !== titles.length) throw Error('神函名称重复。');
  for (const original of initialTitles) if (!titles.some(item=>item.id===original.id && item.name===original.name)) throw Error('八类地方神函的编号和名称须保留。');
  for (const title of current.titles) if (!titles.some(item=>item.id===title.id)) throw Error('请保留已有神函索引。');
  const titleIds=new Set(titles.map(item=>item.id));
  const records=body.records.map(item=>{
    if (!required(item.name,100) || !Array.isArray(item.aliases) || item.aliases.length>100 || item.aliases.some(name=>!required(name,100))) throw Error('神明名称或别名无效。');
    if (!Array.isArray(item.titleIds) || item.titleIds.some(id=>!titleIds.has(id)) || new Set(item.titleIds).size!==item.titleIds.length) throw Error('神函引用无效。');
    const previous=current.records.find(record=>record.id===item.id);
    return {id:item.id,name:item.name.trim(),aliases:item.aliases.map(name=>name.trim()),titleIds:item.titleIds,description:text(item.description,20000),identityNote:text(item.identityNote,10000),source:text(item.source,2000),createdAt:text(item.createdAt,100)||new Date().toISOString(),updatedAt:text(item.updatedAt,100)||new Date().toISOString(),archivedAt:text(item.archivedAt??previous?.archivedAt,100),mergedFromIds:previous?.mergedFromIds||[]};
  });
  // A tombstone keeps cross-village references valid, including concurrent edits.
  for (const previous of current.records) if (!records.some(item=>item.id===previous.id)) throw Error('神明档案请使用归档，不可直接移除已有编号。');
  return {titles,records};
}
export function normalizeDeityLinks(links,names,catalog) {
  uniqueRecords(links,100);
  const deities=new Set(catalog.records.map(item=>item.id)), slots=new Set();
  return links.map(link=>{
    let deityId=link.deityId;const seen=new Set();
    while(Object.hasOwn(catalog.redirects||{},deityId)){if(seen.has(deityId))throw Error('神明重定向无效。');seen.add(deityId);deityId=catalog.redirects[deityId];}
    if (!deities.has(deityId)) throw Error('关联的神明档案不存在，请先导入神明总库或刷新重试。');
    if (!Number.isInteger(link.nameIndex) || link.nameIndex<0 || link.nameIndex>=names.length || slots.has(link.nameIndex)) throw Error('神明名称关联位置无效。');
    slots.add(link.nameIndex);
    return {id:link.id,deityId,nameIndex:link.nameIndex,localName:text(link.localName,100),localTitle:text(link.localTitle,200)};
  });
}
