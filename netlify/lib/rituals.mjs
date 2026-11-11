export const initialRitualTypes = [
  ['birthday-celebration', '祝寿', '为神明诞辰举行的庆祝、祭拜等活动。'],
  ['statue-rotation', '过衙／迓', '与神像流动、接奉和交接相关的活动。'],
  ['blessing', '祈福', '以祈求庇佑、福祉等为目的的仪式。'],
  ['thanksgiving', '还福', '与履行许愿、答谢神恩等有关的仪式。'],
  ['qingguang', '庆光', '地方仪式名称，具体含义由田野资料进一步界定。'],
  ['dachao', '打朝', '地方仪式名称，具体含义由田野资料进一步界定。']
].map(([id, name, description], index) => ({id, name, aliases:[], description, sortOrder:(index+1)*10, enabled:true}));

export const ritualTypesFor = state => state.ritualTypes ?? initialRitualTypes;

function text(value, limit, label, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw Error(`${label}为空、格式无效或过长。`);
  return value.trim();
}

export function normalizeRitualTypes(items, previous = []) {
  if (!Array.isArray(items) || items.length > 200) throw Error('仪式目录格式无效或超过 200 项。');
  const ids = new Set();
  const types = items.map(item => {
    const id = text(item?.id, 120, '仪式类型编号', true);
    if (ids.has(id)) throw Error('仪式类型编号重复。');
    ids.add(id);
    const aliases = item.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.length > 30) throw Error('仪式别称格式无效或过多。');
    if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 9999 || typeof item.enabled !== 'boolean') throw Error('仪式排序或启用状态无效。');
    return {id, name:text(item.name, 100, '仪式名称', true), aliases:[...new Set(aliases.map(value => text(value, 100, '仪式别称', true)))],
      description:text(item.description, 10000, '仪式介绍'), sortOrder:item.sortOrder, enabled:item.enabled};
  });
  if (previous.some(item => !ids.has(item.id))) throw Error('请停用旧仪式类型，保留历史日志引用。');
  return types;
}

export function restoreRitualTypes(state, incoming) {
  const current = ritualTypesFor(state);
  const merged = new Map(current.map(type => [type.id, type]));
  for (const type of normalizeRitualTypes(incoming)) {
    if (state.ritualTypes === undefined || !merged.has(type.id)) merged.set(type.id, type);
  }
  return normalizeRitualTypes([...merged.values()], current);
}

export function normalizeRitualLinks(items, types, previous = [], restoring = false) {
  if (!Array.isArray(items) || items.length > 200) throw Error('仪式关联格式无效或过多。');
  const directory = new Map(types.map(type => [type.id, type]));
  const ids = new Set(), usedTypes = new Set();
  return items.map(item => {
    const id = text(item?.id, 120, '仪式关联编号', true);
    const ritualTypeId = text(item.ritualTypeId, 120, '仪式类型编号', true);
    if (ids.has(id) || usedTypes.has(ritualTypeId)) throw Error('同一篇日志中的仪式关联重复。');
    ids.add(id);
    usedTypes.add(ritualTypeId);
    const type = directory.get(ritualTypeId);
    const old = previous.find(link => link.id === id);
    if (!type) throw Error('仪式类型不存在，请先恢复相应目录。');
    if (!type.enabled && !restoring && old?.ritualTypeId !== ritualTypeId) throw Error('此仪式类型已停用，历史关联仍可保留。');
    const deityIds = item.deityIds ?? old?.deityIds ?? [];
    if (!Array.isArray(deityIds) || deityIds.length > 100) throw Error('仪式神明关联格式无效。');
    return {id, ritualTypeId, deityIds:[...new Set(deityIds.map(value => text(value, 120, '神明编号', true)))],
      note:text(item.note ?? old?.note, 4000, '仪式关联备注')};
  });
}

export function publicRitualLinks(links) {
  return links.map(({id, ritualTypeId, deityIds}) => ({id, ritualTypeId, deityIds}));
}

export function ritualLinksExpanded(links, previous) {
  return links.some(link => {
    const old = previous.find(item => item.ritualTypeId === link.ritualTypeId);
    return !old || link.deityIds.some(id => !old.deityIds.includes(id));
  });
}
