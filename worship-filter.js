/* A compact read-only filter within the existing map layers panel. */
'use strict';
window.createWorshipFilter = ({faith, resolvePlace, beforeChange = () => true, onChange, onPlace}) => {
  const W = window.FaithWorship, A = window.DeityAtlas, el = A.element, $ = id => document.getElementById(id);
  const select = $('worship-filter'), results = $('worship-filter-results'), status = $('worship-filter-count');
  let selected = '', lastError = '';
  function render() {
    const records = faith.records || [], names = W.surnames(records);
    if (selected && !names.includes(selected) && !faith.error) selected = '';
    select.replaceChildren();
    for (const name of ['', ...names]) {
      const option = el('option', '', name ? name + '姓' : '全部姓氏'); option.value = name; select.append(option);
    }
    select.value = selected; select.disabled = !faith.records || !!faith.error;
    results.replaceChildren(); $('worship-filter-clear').hidden = !selected;
    $('worship-filter-badge').hidden = !selected;
    $('worship-filter-retry').hidden = !faith.error && !lastError;
    const matches = !faith.error ? W.matchingVillages(records, selected, resolvePlace) : [];
    const usable = matches.filter(village => Number.isFinite(village.point.lat) && Number.isFinite(village.point.lng));
    onChange(selected, usable); faith.setWorshipFilter(selected);
    if (faith.error || lastError) { status.textContent = faith.error || lastError; return; }
    if (!faith.records) { status.textContent = '正在读取供奉关系…'; return; }
    if (!selected) { status.textContent = names.length ? '按已记录的供奉姓氏筛选自然村。' : '暂无明确记录的供奉姓氏。'; return; }
    status.textContent = selected + '姓 · ' + matches.length + ' 个村庄' + (usable.length !== matches.length ? ' · 可定位 ' + usable.length + ' 处' : '');
    for (const village of matches) {
      const usable = Number.isFinite(village.point.lat) && Number.isFinite(village.point.lng);
      const row = el(usable ? 'button' : 'article', 'worship-filter-result'); if (usable) row.type = 'button';
      row.append(el('strong', '', village.name));
      const gods = new Map();
      for (const {record, links} of village.records) for (const link of links) gods.set(link.deityId, faith.catalog.get(link.deityId)?.name || record.deities[link.nameIndex]);
      row.append(el('span', '', [...gods.values()].join('、') + ' · ' + selected + '姓供奉'));
      if (usable) row.addEventListener('click', () => onPlace(village)); else row.append(el('small', '', '位置待确认'));
      results.append(row);
    }
    if (!matches.length) results.append(el('p', 'note', '暂无匹配的自然村。'));
  }
  function set(value) { if (value && !beforeChange()) { select.value = selected; return; } selected = value; render(); }
  select.addEventListener('change', () => set(select.value));
  $('worship-filter-clear').addEventListener('click', () => set(''));
  $('worship-filter-retry').addEventListener('click', async () => { try { lastError = ''; await faith.reload(); } catch (error) { lastError = error.message; } render(); });
  faith.subscribe(render); faith.catalog.subscribe(render); render();
  return {clear() { if (selected) set(''); }, get value() { return selected; }};
};
