const rows = value => Array.isArray(value) ? value : [];
const validPart = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;

function lunarPart(value, max, label) {
  if (value == null) return null;
  if (!validPart(value, max)) throw Error(`${label}须在 1 至 ${max} 之间。`);
  return value;
}

function legacyBirthday(birthdays) {
  const dates = rows(birthdays).map(item => ({
    birthdayMonth: validPart(item?.lunarMonth, 12) ? item.lunarMonth : null,
    birthdayDay: validPart(item?.lunarDay, 30) ? item.lunarDay : null,
    wasPublic: item?.visibility === 'public'
  })).filter(date => date.birthdayMonth || date.birthdayDay);
  const complete = dates.filter(date => date.birthdayMonth && date.birthdayDay);
  const candidates = complete.length ? complete : dates;
  return candidates.find(date => date.wasPublic) || candidates[0] || {};
}

function legacyRotationTime(groups) {
  const publicGroups = rows(groups).filter(group => group?.visibility === 'public');
  const otherGroups = rows(groups).filter(group => group?.visibility !== 'public');
  // Only the recurring time carries forward. Private free text and individual stops stay in old backups.
  for (const group of [...publicGroups, ...otherGroups]) {
    for (const rule of rows(group?.cycleRules)) {
      if (group.visibility === 'public' && typeof rule?.originalText === 'string' && rule.originalText.trim()) {
        return rule.originalText.trim();
      }
      if (!validPart(rule?.lunarDay, 30)) continue;
      if (rule.cycleType === 'monthly') return `农历每月${rule.lunarDay}日`;
      if (rule.cycleType === 'yearly' && validPart(rule.lunarMonth, 12)) return `每年农历${rule.lunarMonth}月${rule.lunarDay}日`;
    }
  }
  return '';
}

export function normalizeObservances(record, previous = record) {
  const birthday = previous.birthdayMonth !== undefined || previous.birthdayDay !== undefined
    ? previous : legacyBirthday(previous.birthdays);
  const birthdayMonth = lunarPart(record.birthdayMonth === undefined ? birthday.birthdayMonth : record.birthdayMonth, 12, '农历月份');
  const birthdayDay = lunarPart(record.birthdayDay === undefined ? birthday.birthdayDay : record.birthdayDay, 30, '农历日期');
  const time = (record.rotationTime === undefined
    ? previous.rotationTime ?? legacyRotationTime(previous.rotationGroups)
    : record.rotationTime) ?? '';
  if (typeof time !== 'string' || time.length > 1000) throw Error('过衙／迓时间格式无效或过长。');
  const rotationTime = time.trim();
  return {
    ...(birthdayMonth || birthdayDay ? {birthdayMonth, birthdayDay} : {}),
    ...(rotationTime ? {rotationTime} : {})
  };
}

export function projectObservances(record) {
  if (record.birthdays === undefined && record.rotationGroups === undefined) return record;
  const {birthdays, rotationGroups, ...archive} = record;
  return {...archive, ...normalizeObservances(record)};
}

export function mergeObservances(target, source) {
  const primary = normalizeObservances(target);
  const secondary = normalizeObservances(source);
  const birthday = primary.birthdayMonth || primary.birthdayDay ? primary : secondary;
  return {
    birthdayMonth: birthday.birthdayMonth ?? null,
    birthdayDay: birthday.birthdayDay ?? null,
    rotationTime: primary.rotationTime || secondary.rotationTime || ''
  };
}
