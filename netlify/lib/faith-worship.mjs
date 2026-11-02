import worship from '../../worship-info.js';
import { json } from './auth.mjs';

// A narrow CAS patch: never replace the village, deity, or an observation's text.
export async function updateFaithWorship(store, body) {
  if (body.version !== 1 || !Number.isInteger(body.revision) || body.revision < 0 || !worship.scopes.includes(body.worship_scope) ||
      !['reference', 'survey'].includes(body.villageKind) ||
      ['recordId', 'linkId', 'deityId', 'villageId'].some(key => typeof body[key] !== 'string' || !body[key] || body[key].length > 120)) {
    return json({error: '供奉关系编号或版本无效。'}, 400);
  }
  let values;
  try { values = worship.normalize(body); } catch (error) { return json({error: error.message}, 400); }
  const snapshot = await store.getSnapshot(), faith = snapshot.states.faith;
  const record = faith.records.find(item => item.id === body.recordId);
  const link = record?.deityLinks?.find(item => item.id === body.linkId);
  if (!link) return json({error: '此关联已移除，请刷新后重新选择。'}, 404);
  if (record.villageId !== body.villageId || record.villageKind !== body.villageKind || link.deityId !== body.deityId) {
    return json({error: '关联对象已变化，请刷新后重新核对神明与村庄。'}, 409);
  }
  const conflict = () => json({error: '另一页面已更新信仰资料，填写内容已保留。请重新载入关联后核对再保存。'}, 409);
  if (faith.revision !== body.revision || faith.revision >= 2147483646) return conflict();
  const now = new Date().toISOString();
  const records = faith.records.map(item => item.id !== record.id ? item : {
    ...item, updatedAt: now, deityLinks: item.deityLinks.map(item => item.id !== link.id ? item : {...item, ...values})
  });
  const saved = await store.commit({faith: {...faith, revision: faith.revision + 1, records}}, {snapshotToken: snapshot.token});
  if (!saved.modified) return conflict();
  return json({version: 1, faithRevision: faith.revision + 1, recordId: record.id, link: {...link, ...values}});
}
