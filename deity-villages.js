/* One temporary ID selection; saved associations remain ordinary faith records. */
window.DeityVillageLinks = (() => {
  'use strict';
  const unassigned = '__unassigned';
  function createSelection(index, records, deityId) {
    const areas = new Map(index.administrativeAreas.map(area => [area.id, area]));
    const villages = index.places.filter(place => place.placeKind === 'natural_village' && !place.parentVillageId);
    const byId = new Map(villages.map(place => [place.id, place]));
    const pending = new Set();
    let existing = new Set();
    const areaId = place => areas.has(place.administrativeAreaId) ? place.administrativeAreaId : unassigned;
    const areaName = place => areas.get(place.administrativeAreaId)?.committeeName || '归属待完善';
    function setExisting(items) {
      existing = new Set(items.filter(record => record.villageKind === 'reference' &&
        record.deityLinks?.some(link => link.deityId === deityId)).map(record => record.villageId));
      for (const id of existing) pending.delete(id);
    }
    function rows(area = '', term = '') {
      term = term.trim().toLocaleLowerCase();
      return villages.filter(place => (!area || areaId(place) === area) && (!term ||
        [place.name, ...(place.aliases || []), areaName(place)].some(value => value.toLocaleLowerCase().includes(term))))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
    }
    function toggle(id, checked) {
      if (!byId.has(id) || existing.has(id)) return;
      if (checked) pending.add(id); else pending.delete(id);
    }
    setExisting(records);
    return {pending, villages, areas, areaId, areaName, rows, toggle, setExisting,
      markExisting(ids) { for(const id of ids){existing.add(id);pending.delete(id);} },
      isExisting: id => existing.has(id),
      selectRows(items) { for (const item of items) toggle(item.id, true); },
      clearRows(items) { for (const item of items) pending.delete(item.id); },
      selected() { return villages.filter(place => pending.has(place.id)); }
    };
  }
  async function request(body, query = '') {
    const response = await (window.NaozhouCloud?.request || fetch)('/api/faith' + query,
      body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {cache: 'no-store'});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '关联资料未能读取，请稍后重试。');
    return result;
  }
  function createPanel({beforeOpen = () => true, onSaved = async () => {}} = {}) {
    const el = window.DeityAtlas.element;
    let index = null, loadingIndex = null, dialog = null, selection = null, deity = null;
    let busy = false, stage = 'select', previousStage = 'select', preview = null, showSelected = false;
    let statusText = '', opener = null, failed = new Map();
    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (!loadingIndex) loadingIndex = request(null, '?view=places').then(data => {
        if (data.version !== 1 || !Array.isArray(data.places) || !Array.isArray(data.administrativeAreas)) throw Error('地点索引未能读取。');
        index = data; return data;
      }).finally(() => { loadingIndex = null; });
      return loadingIndex;
    }
    const ready = loadIndex();
    // Loading failure is displayed in the panel with an explicit retry action.
    ready.catch(() => {});
    const button = (text, handler, cls = '') => {
      const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', handler); return node;
    };
    let list, footer, status, areaInput, searchInput, filters, tools, count, selectAll, clearCurrent, selectedToggle, closeButton;
    function close() {
      if (!dialog || busy) return;
      if (selection?.pending.size) {
        if(stage !== 'discard'){previousStage = stage; stage = 'discard'; renderBody();}return;
      }
      dialog.close(); dialog.remove(); dialog = null; selection = null;
      (opener?.isConnected ? opener : document.querySelector('[data-link-villages]'))?.focus();
    }
    function setBusy(value) {
      busy = value; closeButton.disabled = value;
      filters.inert = tools.inert = list.inert = value;
      for (const node of footer.querySelectorAll('button')) node.disabled = value || node.dataset.blocked === 'true';
    }
    function updateStatus() { status.textContent = statusText; }
    function renderFooter() {
      footer.replaceChildren();
      const summary = el('div', 'village-link-total');
      summary.append(el('strong', '', '本次待新增 ' + (selection?.pending.size || 0) + ' 个村庄'));
      if (!selection?.pending.size && !statusText) summary.append(el('small', '', '请选择需要新增关联的村庄。'));
      const actions = el('div', 'village-link-actions');
      if (stage === 'discard') {
        actions.append(button('继续选择', () => { stage = previousStage; renderBody(); }), button('放弃本次选择', () => { selection.pending.clear(); close(); }));
      } else if (stage === 'preview') {
        actions.append(button('返回选择', () => { stage = 'select'; renderBody(); }));
        const confirm = button('确认添加 ' + preview.toAdd.length + ' 个村庄', save, 'primary');
        confirm.dataset.blocked = String(!preview.toAdd.length); confirm.disabled = !preview.toAdd.length; actions.append(confirm);
      } else {
        actions.append(button('关闭', close));
        const next = button('预览关联', preparePreview, 'primary');
        next.dataset.blocked = String(!selection?.pending.size); next.disabled = !selection?.pending.size; actions.append(next);
      }
      footer.append(summary, actions); setBusy(busy);
    }
    function renderBody() {
      list.replaceChildren(); filters.hidden = tools.hidden = stage !== 'select';
      if (!selection) { list.append(el('p', 'village-link-empty', '正在读取村庄…')); renderFooter(); return; }
      if (stage === 'discard') {
        list.append(el('h3', '', '本次选择尚未保存'), el('p', 'village-link-empty', '关闭将放弃本次勾选，已有信仰关联不受影响。'));
      } else if (stage === 'preview') {
        list.append(el('p', 'village-link-preview-deity', deity.name), el('p', 'deity-identity', '神明档案 ID · ' + deity.id));
        const groups = new Map();
        for (const id of preview.toAdd) {
          const place = selection.villages.find(item => item.id === id);
          const key = selection.areaName(place); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(place);
        }
        for (const [name, items] of groups) {
          const group = el('section', 'village-link-preview-group'); group.append(el('h3', '', name + ' · ' + items.length + ' 个'));
          const names = el('div', 'village-link-preview-names'); for (const place of items) names.append(el('span', '', place.name));
          group.append(names); list.append(group);
        }
        if (!preview.toAdd.length) list.append(el('p', 'village-link-empty', '所选村庄已有关联，或需要先处理下方提示。'));
        list.append(el('p', 'village-link-preview-note', '仅新增神明关联，宫庙、祭期和田野资料留待补充。'));
      } else {
        const visible = selection.rows(areaInput.value, searchInput.value).filter(place => !showSelected || selection.pending.has(place.id));
        const available = visible.filter(place => !selection.isExisting(place.id));
        count.textContent = visible.length + ' 个自然村' + (showSelected ? ' · 本次已选' : '');
        const term = searchInput.value.trim();
        selectAll.textContent = (term ? '全选搜索结果' : areaInput.value === unassigned ? '全选归属待完善村庄' : areaInput.value ? '全选当前行政村' : '全选当前列表') + '（' + available.length + '）';
        selectAll.disabled = !available.length;
        clearCurrent.textContent = term ? '取消当前搜索结果选择' : '取消当前范围选择';
        selectedToggle.textContent = showSelected ? '查看全部村庄' : '查看已选（' + selection.pending.size + '）';
        if (!visible.length) list.append(el('p', 'village-link-empty', showSelected ? '当前范围没有本次选择的村庄。' : term ? '没有找到符合条件的自然村。' : '当前行政村暂无已收录的自然村。'));
        else if (!available.length) list.append(el('p', 'village-link-all-linked', '当前范围下已收录的自然村均已关联此神明。'));
        for (const place of visible) {
          const exists = selection.isExisting(place.id), row = el('label', 'village-link-row');
          row.classList.toggle('is-pending', selection.pending.has(place.id));
          const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = selection.pending.has(place.id);
          checkbox.disabled = exists; checkbox.setAttribute('aria-label', place.name + (exists ? '（已关联）' : ''));
          checkbox.addEventListener('change', () => {
            selection.toggle(place.id, checkbox.checked); row.classList.toggle('is-pending', checkbox.checked); failed.delete(place.id);
            renderFooter(); selectedToggle.textContent = showSelected ? '查看全部村庄' : '查看已选（' + selection.pending.size + '）';
          });
          const text = el('span', 'village-link-row-text'); text.append(el('strong', '', place.name), el('small', '', '自然村 · ' + selection.areaName(place)));
          if (failed.has(place.id)) text.append(el('small', 'village-link-failure', failed.get(place.id)));
          row.append(checkbox, text);
          if (exists) {
            const badge = el('a', 'village-link-existing', '已关联 ↗'); badge.href = window.DeityAtlas.mapURL('reference', place.id);
            badge.addEventListener('click', event => event.stopPropagation()); row.append(badge);
          }
          list.append(row);
        }
      }
      if (stage === 'preview' && preview.failed.length) {
        const errors = el('div', 'village-link-failures');
        for (const item of preview.failed) errors.append(el('p', '', (index.places.find(p => p.id === item.placeId)?.name || item.placeId) + '：' + item.error));
        list.append(errors);
      }
      renderFooter(); updateStatus();
    }
    async function preparePreview() {
      if (busy || !selection.pending.size) return;
      setBusy(true); statusText = '正在核对已有的关联…'; updateStatus();
      try {
        preview = await request({version: 1, action: 'preview-villages', deityId: deity.id, placeIds: [...selection.pending]});
        selection.markExisting(preview.existing);
        failed = new Map(preview.failed.map(item => [item.placeId, item.error]));
        deity.name = preview.deity.name;
        stage = 'preview'; statusText = preview.existing.length ? preview.existing.length + ' 个村庄已有此关联，不会重复添加。' : '';
        if(preview.existing.length){try{await onSaved(preview);}catch{statusText+=' 档案列表暂未刷新，请稍后重试。';}}
      } catch (error) { statusText = error.message; }
      finally { setBusy(false); renderBody(); }
    }
    async function save() {
      if (busy || !preview?.toAdd.length) return;
      setBusy(true); statusText = '正在保存关联…'; updateStatus();
      try {
        const result = await request({version: 1, action: 'link-villages', deityId: deity.id, placeIds: preview.toAdd});
        selection.markExisting([...result.added,...result.existing]);
        for(const id of [...result.added,...result.existing])failed.delete(id);
        for(const item of result.failed)failed.set(item.placeId,item.error);
        const totalFailed = selection.pending.size;
        statusText = '已新增 ' + result.added.length + ' 个村庄' + (result.existing.length ? ' · ' + result.existing.length + ' 个已关联' : '') +
          (totalFailed ? ' · ' + totalFailed + ' 个未完成，选择已保留，可重试。' : '。');
        stage = 'select'; showSelected = totalFailed > 0;
        if(showSelected){areaInput.value='';searchInput.value='';}
        // Signal only a revision, never put field materials into browser storage.
        try { localStorage.setItem('naozhou-faith-changed', JSON.stringify({revision: result.faithRevision, at: Date.now()})); } catch {}
        document.dispatchEvent(new Event('naozhou-faith-change'));
        try { await onSaved(result); } catch { statusText += ' 档案列表暂未刷新，请稍后重试。'; }
      } catch (error) { statusText = error.message; }
      finally { setBusy(false); renderBody(); }
    }
    function buildDialog() {
      dialog = el('dialog', 'village-link-dialog'); dialog.setAttribute('aria-labelledby', 'village-link-title');
      const header = el('header', 'village-link-header'), heading = el('div');
      heading.append(el('span', 'atlas-eyebrow', 'DEITY · VILLAGES'));
      const title = el('h2', '', '关联供奉村庄'); title.id = 'village-link-title'; heading.append(title);
      heading.append(el('p', '', '按行政村批量选择自然村，也可逐个检索。'));
      closeButton = button('×', close, 'village-link-close'); closeButton.setAttribute('aria-label', '关闭村庄选择'); header.append(heading, closeButton);
      filters = el('div', 'village-link-filters');
      const areaLabel = el('label', '', '所属行政村'), searchLabel = el('label', '', '检索自然村');
      areaInput = el('select'); areaInput.setAttribute('aria-label', '所属行政村');
      searchInput = el('input'); searchInput.type = 'search'; searchInput.placeholder = '村庄名称或行政归属'; searchInput.maxLength = 100;
      searchInput.setAttribute('aria-label', '检索自然村'); areaLabel.append(areaInput); searchLabel.append(searchInput); filters.append(areaLabel, searchLabel);
      areaInput.addEventListener('change', () => { showSelected = false; renderBody(); }); searchInput.addEventListener('input', renderBody);
      tools = el('div', 'village-link-tools'); count = el('span', 'village-link-count');
      selectAll = button('全选当前列表', () => { selection.selectRows(selection.rows(areaInput.value, searchInput.value).filter(place=>!showSelected||selection.pending.has(place.id))); renderBody(); }, 'linkbutton');
      clearCurrent = button('取消当前范围选择', () => { selection.clearRows(selection.rows(areaInput.value, searchInput.value)); renderBody(); }, 'linkbutton');
      selectedToggle = button('查看已选', () => { showSelected = !showSelected; if(showSelected){areaInput.value='';searchInput.value='';}renderBody(); }, 'linkbutton');
      const clearAll = button('清空全部本次选择', () => { selection.pending.clear(); renderBody(); }, 'linkbutton');
      tools.append(count, selectAll, clearCurrent, selectedToggle, clearAll);
      list = el('div', 'village-link-list'); status = el('p', 'village-link-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      footer = el('footer', 'village-link-footer'); dialog.append(header, filters, tools, list, status, footer);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      document.body.append(dialog); dialog.showModal();
    }
    async function open(record) {
      if (dialog || !beforeOpen() || record.archivedAt) return;
      if (window.NaozhouCloud && !await window.NaozhouCloud.requireEditor()) return;
      opener = document.activeElement; deity = {id: record.id, name: record.name}; selection = null;
      stage = 'select'; preview = null; failed.clear(); showSelected = false; statusText = '';
      buildDialog(); setBusy(true); renderBody();
      async function load() {
        try {
          const [data, faith] = await Promise.all([loadIndex(), request()]);
          selection = createSelection(data, faith.records, deity.id);
          areaInput.replaceChildren(); const all = el('option', '', '全部行政村'); all.value = ''; areaInput.append(all);
          for (const area of data.administrativeAreas) { const option = el('option', '', area.committeeName); option.value = area.id; areaInput.append(option); }
          const unknown = el('option', '', '归属待完善'); unknown.value = unassigned; areaInput.append(unknown);
          statusText = ''; setBusy(false); renderBody(); searchInput.focus();
        } catch (error) {
          statusText = error.message; setBusy(false); filters.hidden = tools.hidden = true;
          list.replaceChildren(el('p', 'village-link-empty', '资料读取失败，尚未修改任何关联。'), button('重新读取', () => { setBusy(true); load(); }));
          renderFooter(); updateStatus();
        }
      }
      await load();
    }
    return {ready, open, get dirty() { return !!dialog && !!selection?.pending.size; }, get saving() { return busy; },
      mayLeave() { if (!dialog) return true; close(); return false; },
      place(id) { return index?.places.find(place => place.id === id); },
      area(id) { return index?.administrativeAreas.find(area => area.id === id); }
    };
  }
  return {createSelection, createPanel};
})();
