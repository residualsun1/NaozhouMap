import { randomUUID } from 'node:crypto';

function text(value, limit, label, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw Error(`${label}为空、格式无效或过长。`);
  }
  return value.trim();
}

function choice(value, choices, fallback, label) {
  const selected = value ?? fallback;
  if (!choices.includes(selected)) throw Error(`${label}无效。`);
  return selected;
}

function number(value, max, label, required = false) {
  if (value == null && !required) return null;
  if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`${label}须在 1 至 ${max} 之间。`);
  return value;
}

function lunarParts(input) {
  return {
    lunarMonth: number(input.lunarMonth, 12, '农历月份'),
    lunarDay: number(input.lunarDay, 30, '农历日期'),
    leapMonth: choice(input.leapMonth, ['regular', 'leap', 'unknown'], 'unknown', '闰月标记')
  };
}

function dated(input, requiredYear = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('农历日期格式无效。');
  return {lunarYear: number(input.lunarYear, 9999, '农历年份', requiredYear), ...lunarParts(input)};
}

const visibility = value => choice(value, ['editors', 'public'], 'editors', '可见范围');
const verification = value => choice(value, ['verified', 'pending', 'variant'], 'pending', '核实状态');

function rows(items, previous, limit, label, normalize) {
  if (items === undefined) return previous || [];
  if (!Array.isArray(items) || items.length > limit) throw Error(`${label}数量过多或格式无效。`);
  const old = new Map((previous || []).map(item => [item.id, item]));
  const ids = new Set();
  return items.map(item => {
    const id = text(item?.id, 120, `${label}编号`, true);
    if (ids.has(id)) throw Error(`${label}编号重复。`);
    ids.add(id);
    return {id, ...normalize(item, old.get(id))};
  });
}

export function normalizeObservances(record, previous, placeIds) {
  function placeId(value, retained) {
    const id = text(value, 120, '地点编号');
    if (id && placeIds && !placeIds.has(id) && !retained.includes(id)) throw Error('请选择地点索引中的地点，或填写原始地名。');
    return id || null;
  }

  const result = {};
  if (record.birthdays !== undefined || previous?.birthdays !== undefined) {
    result.birthdays = rows(record.birthdays, previous?.birthdays, 100, '诞辰', (item, old) => {
      const applicable = item.applicablePlaceIds ?? old?.applicablePlaceIds ?? [];
      if (!Array.isArray(applicable) || applicable.length > 200) throw Error('适用村庄格式无效。');
      return {
        ...lunarParts(item),
        applicablePlaceIds: [...new Set(applicable.map(id => placeId(id, old?.applicablePlaceIds || [])).filter(Boolean))],
        originalText: text(item.originalText, 1000, '原始时间说法'),
        verificationStatus: verification(item.verificationStatus),
        sourceNote: text(item.sourceNote ?? old?.sourceNote, 4000, '来源说明'),
        visibility: visibility(item.visibility ?? old?.visibility)
      };
    });
  }
  if (record.rotationGroups !== undefined || previous?.rotationGroups !== undefined) {
    result.rotationGroups = rows(record.rotationGroups, previous?.rotationGroups, 100, '轮祀安排', (group, old) => ({
      name: text(group.name, 160, '轮祀名称', true),
      statueLabel: text(group.statueLabel ?? old?.statueLabel, 500, '神像辨识'),
      scopeDescription: text(group.scopeDescription, 2000, '轮祀范围'),
      visibility: visibility(group.visibility ?? old?.visibility),
      cycleRules: rows(group.cycleRules, old?.cycleRules, 100, '固定周期', (rule, oldRule) => {
        const cycleType = choice(rule.cycleType, ['monthly', 'yearly', 'custom', 'unknown'], 'unknown', '周期类型');
        return {
          cycleType,
          lunarMonth: cycleType === 'yearly' ? number(rule.lunarMonth, 12, '农历月份') : null,
          lunarDay: number(rule.lunarDay, 30, '农历日期'),
          leapPolicy: choice(rule.leapPolicy, ['observe', 'skip', 'separate', 'unknown'], 'unknown', '闰月规则'),
          originalText: text(rule.originalText, 1000, '原始时间说法'),
          verificationStatus: verification(rule.verificationStatus),
          sourceNote: text(rule.sourceNote ?? oldRule?.sourceNote, 4000, '周期来源')
        };
      }),
      scheduleBatches: rows(group.scheduleBatches, old?.scheduleBatches, 200, '排期批次', (batch, oldBatch) => ({
        name: text(batch.name, 160, '批次名称', true),
        drawDate: batch.drawDate == null ? null : dated(batch.drawDate),
        scopeDescription: text(batch.scopeDescription, 2000, '批次适用范围'),
        sourceNote: text(batch.sourceNote ?? oldBatch?.sourceNote, 4000, '排期来源'),
        note: text(batch.note ?? oldBatch?.note, 4000, '批次备注'),
        stops: rows(batch.stops, oldBatch?.stops, 1000, '接奉站点', (stop, oldStop) => ({
          ...dated(stop, true),
          placeId: placeId(stop.placeId, [oldStop?.placeId]),
          originalPlaceName: text(stop.originalPlaceName ?? oldStop?.originalPlaceName, 300, '原始接奉地名'),
          recipientType: choice(stop.recipientType ?? oldStop?.recipientType, ['village', 'household', 'other'], 'village', '接奉对象类型'),
          recipientNote: text(stop.recipientNote ?? oldStop?.recipientNote, 2000, '接奉对象说明'),
          entryId: text(stop.entryId ?? oldStop?.entryId, 120, '关联日志编号') || null,
          status: choice(stop.status, ['scheduled', 'occurred', 'adjusted', 'cancelled'], 'scheduled', '排期状态'),
          note: text(stop.note ?? oldStop?.note, 4000, '站点备注')
        }))
      }))
    }));
  }
  return result;
}

// Names and explicitly public time expressions are separate from source and household notes.
export function publicObservances(record, villageIds, publicEntries) {
  const result = {};
  if (record.birthdays) result.birthdays = record.birthdays.filter(item => item.visibility === 'public').map(item => ({
    id: item.id, lunarMonth: item.lunarMonth, lunarDay: item.lunarDay, leapMonth: item.leapMonth,
    applicablePlaceIds: item.applicablePlaceIds.filter(id => villageIds.has(id)),
    originalText: item.originalText, verificationStatus: item.verificationStatus
  }));
  if (record.rotationGroups) result.rotationGroups = record.rotationGroups.filter(group => group.visibility === 'public').map(group => ({
    id: group.id, name: group.name,
    cycleRules: group.cycleRules.map(rule => ({
      id: rule.id, cycleType: rule.cycleType, lunarMonth: rule.lunarMonth, lunarDay: rule.lunarDay,
      leapPolicy: rule.leapPolicy, originalText: rule.originalText, verificationStatus: rule.verificationStatus
    })),
    scheduleBatches: group.scheduleBatches.map(batch => ({
      id: batch.id, name: batch.name, drawDate: batch.drawDate,
      stops: batch.stops.map(stop => ({
        id: stop.id, lunarYear: stop.lunarYear, lunarMonth: stop.lunarMonth, lunarDay: stop.lunarDay,
        leapMonth: stop.leapMonth, status: stop.status, placeId: villageIds.has(stop.placeId) ? stop.placeId : null,
        ...(stop.entryId && villageIds.has(stop.placeId) && publicEntries.get(stop.entryId) === stop.placeId ? {entryId:stop.entryId} : {})
      }))
    }))
  }));
  return result;
}

export function mergeObservances(target, source) {
  const result = {};
  for (const key of ['birthdays', 'rotationGroups']) {
    if (!target[key] && !source[key]) continue;
    const records = new Map((target[key] || []).map(item => [item.id, item]));
    for (const item of source[key] || []) {
      const existing = records.get(item.id);
      if (!existing) records.set(item.id, item);
      else if (JSON.stringify(existing) !== JSON.stringify(item)) {
        // Two distinct records can have a copied ID. Keep both sources in the merged archive.
        const id = randomUUID();
        records.set(id, {...item, id});
      }
    }
    result[key] = [...records.values()];
  }
  return result;
}
