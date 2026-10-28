import { randomUUID } from 'node:crypto';
import mapData from '../../assets/vector-map-data.json' with {type:'json'};
import { canonicalId } from './archive-store.mjs';
import { json } from './auth.mjs';

// This is an index of the existing geography, not a second membership dataset.
export const faithPlaceIndex = {
  version: 1,
  administrativeAreas: mapData.administrativeAreas.map(area => ({
    id: area.id, name: area.name, committeeName: area.committeeName || area.name
  })),
  places: mapData.places.map(place => ({
    id: place.id, name: place.name, aliases: place.aliases || [],
    placeKind: place.placeKind || 'reference', parentVillageId: place.parentVillageId || '',
    administrativeAreaId: place.administrativeAreaId || ''
  }))
};
const places = new Map(faithPlaceIndex.places.map(place => [place.id, place]));
const isNaturalVillage = place => place?.placeKind === 'natural_village' && !place.parentVillageId;
const failure = (placeId, error) => ({placeId, error});

export function planFaithAssociations(snapshot, deityId, placeIds) {
  const id = canonicalId(snapshot.manifest, 'deities', deityId);
  if (id !== deityId) return {error: '神明档案已合并或移除，请刷新后重新选择。', status: 409};
  const deity = snapshot.states.deities.records.find(record => record.id === id);
  if (!deity) return {error: '未找到这份神明档案。', status: 404};
  if (deity.archivedAt || deity.mergedInto) return {error: '请先恢复这份神明档案，再添加村庄。', status: 409};
  const faith = snapshot.states.faith;
  const linked = new Set(faith.records.filter(record => record.villageKind === 'reference' &&
    record.deityLinks?.some(link => link.deityId === deity.id)).map(record => record.villageId));
  const result = {version: 1, deity: {id: deity.id, name: deity.name},
    faithRevision: faith.revision, toAdd: [], added: [], existing: [], failed: []};
  let remaining = Math.max(0, 10000 - faith.records.length);
  for (const placeId of new Set(placeIds)) {
    const place = places.get(placeId);
    if (!place) result.failed.push(failure(placeId, '地点不存在，请刷新地点列表。'));
    else if (!isNaturalVillage(place)) result.failed.push(failure(placeId, '此地点不是可批量添加的自然村。'));
    else if (linked.has(placeId)) result.existing.push(placeId);
    else if (!remaining) result.failed.push(failure(placeId, '信仰记录已达到容量上限。'));
    else { result.toAdd.push(placeId); remaining--; }
  }
  return result;
}

export async function faithAssociationAction(store, body) {
  if (body.version !== 1 || typeof body.deityId !== 'string' || !body.deityId || body.deityId.length > 120 ||
      !Array.isArray(body.placeIds) || body.placeIds.length > 500 ||
      body.placeIds.some(id => typeof id !== 'string' || !id || id.length > 120)) {
    return json({error: '请选择有效的神明和村庄（单次不超过 500 个）。'}, 400);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await store.getSnapshot();
    const plan = planFaithAssociations(snapshot, body.deityId, body.placeIds);
    if (plan.error) return json({error: plan.error}, plan.status);
    if (body.action === 'preview-villages' || !plan.toAdd.length) return json(plan);
    const faith = snapshot.states.faith;
    if (faith.revision >= 2147483646) return json({error: '记录版本已达到上限，请联系维护者。'}, 409);
    const now = new Date().toISOString();
    const additions = plan.toAdd.map(placeId => ({
      id: randomUUID(), villageKind: 'reference', villageId: placeId, villageName: places.get(placeId).name,
      deities: [plan.deity.name],
      deityLinks: [{id: randomUUID(), deityId: plan.deity.id, nameIndex: 0, localName: '', localTitle: ''}],
      temple: '', festival: '', source: '', visitedOn: '', note: '', createdAt: now, updatedAt: now
    }));
    // Append only. Existing observations and their local descriptions remain untouched.
    const saved = await store.commit({faith: {...faith, revision: faith.revision + 1,
      records: faith.records.concat(additions)}}, {snapshotToken: snapshot.token});
    if (saved.modified) return json({...plan, added: plan.toAdd, toAdd: [], faithRevision: faith.revision + 1});
    // A competing writer won the manifest CAS: reread and recompute missing links.
  }
  return json({error: '其他页面正在更新关联，本次选择已保留，请重试。'}, 409);
}
