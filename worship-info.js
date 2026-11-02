/* Shared relationship attributes. No surname is stored on a deity or place. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FaithWorship = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const scopes = ['specific_surname', 'village_wide', 'unknown'];
  function normalize(value = {}, previous = {}) {
    const scope = value.worship_scope !== undefined ? value.worship_scope : previous.worship_scope ?? 'unknown';
    if (!scopes.includes(scope)) throw Error('请选择有效的供奉范围。');
    if (scope !== 'specific_surname') return {worship_scope: scope, worship_surname: null};
    const raw = value.worship_surname === undefined ? previous.worship_surname : value.worship_surname;
    if (typeof raw !== 'string' || raw.length > 40) throw Error('请填写供奉姓氏。');
    const surname = raw.normalize('NFKC').trim().replace(/姓$/, '').trim();
    if (!surname || surname.length > 20 || /[\s,，、;；/|]/u.test(surname)) throw Error('请填写一个完整姓氏，如“陈”或“欧阳”。');
    return {worship_scope: scope, worship_surname: surname};
  }
  function info(link) { return normalize(link || {}); }
  function description(link) {
    const value = info(link);
    return value.worship_scope === 'specific_surname' ? '供奉姓氏：' + value.worship_surname + '姓' :
      '供奉范围：' + (value.worship_scope === 'village_wide' ? '全村共同供奉' : '尚未确认');
  }
  function surnames(records) {
    return [...new Set(records.flatMap(record => (record.deityLinks || []).flatMap(link => {
      const value = info(link); return value.worship_scope === 'specific_surname' ? [value.worship_surname] : [];
    })))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  function matchingVillages(records, surname, resolvePlace) {
    if (!surname) return [];
    const villages = new Map();
    for (const record of records) {
      const links = (record.deityLinks || []).filter(link => {
        const value = info(link); return value.worship_scope === 'specific_surname' && value.worship_surname === surname;
      });
      if (!links.length) continue;
      const point = resolvePlace(record.villageKind, record.villageId);
      if (!point || point.placeKind !== 'natural_village' || point.parentVillageId) continue;
      const key = record.villageKind + ':' + record.villageId;
      if (!villages.has(key)) villages.set(key, {key, id: record.villageId, kind: record.villageKind, name: point.name, point, records: []});
      villages.get(key).records.push({record, links});
    }
    return [...villages.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
  }
  return {scopes, normalize, info, description, surnames, matchingVillages};
});
