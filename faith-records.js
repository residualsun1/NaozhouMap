/* Village faith records use stable place IDs and their own project file. */
window.createFaithRecords = options => {
  'use strict';
  const {download, onChange} = options;
  const $ = id => document.getElementById(id);
  const textLimits = {temple:200, festival:500, source:200, visitedOn:10, note:5000, createdAt:100, updatedAt:100};
  const fields = ['temple','festival','source','visitedOn','note'];
  let state = null, village = null, editingId = null, dirty = false, saving = false;
  const key = (kind, id) => kind + ':' + id;
  const sameVillage = record => village && key(record.villageKind,record.villageId) === key(village.kind,village.id);
  const status = message => { $('faith-status').textContent = message; };
  const dateStamp = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
  const preview = document.createElement('div');
  preview.id = 'faith-tooltip';
  preview.className = 'faith-tooltip';
  preview.setAttribute('role','tooltip');
  preview.hidden = true;
  document.body.append(preview);
  let previewAnchor = null, previewTargets = [], previewKey = null, previewTimer, hideTimer;
  function dismissPreview() {
    clearTimeout(previewTimer);
    clearTimeout(hideTimer);
    previewAnchor?.removeAttribute('aria-describedby');
    previewAnchor = null;
    previewTargets = [];
    previewKey = null;
    preview.hidden = true;
  }
  function positionPreview() {
    const boxes = previewTargets.filter(target=>!target.hidden).map(target=>target.getBoundingClientRect());
    const anchor = boxes.length ? {left:Math.min(...boxes.map(box=>box.left)),right:Math.max(...boxes.map(box=>box.right)),top:Math.min(...boxes.map(box=>box.top)),bottom:Math.max(...boxes.map(box=>box.bottom))} : null;
    const map = $('map-stage').getBoundingClientRect();
    const left = Math.max(8,map.left + 8), right = Math.min(innerWidth - 8,map.right - 8);
    const top = Math.max(8,map.top + 8), bottom = Math.min(innerHeight - 8,map.bottom - 8);
    if (!anchor || previewAnchor.hidden || anchor.bottom < top || anchor.top > bottom || bottom - top < 80 || right - left < 120) { dismissPreview(); return; }
    preview.style.maxWidth = Math.min(264,right - left) + 'px';
    preview.style.maxHeight = Math.min(320,bottom - top) + 'px';
    const width = preview.offsetWidth, height = preview.offsetHeight;
    let x = anchor.right + 12;
    if (x + width > right) x = anchor.left - width - 12;
    preview.style.left = Math.max(left,Math.min(x,right - width)) + 'px';
    preview.style.top = Math.max(top,Math.min((anchor.top + anchor.bottom)/2 - height/2,bottom - height)) + 'px';
  }
  function showPreview(anchor, selected, targets) {
    const names = [...new Set((state?.records || []).filter(record=>key(record.villageKind,record.villageId) === key(selected.kind,selected.id)).flatMap(record=>record.deities))];
    if (!names.length) { dismissPreview(); return; }
    previewAnchor?.removeAttribute('aria-describedby');
    previewAnchor = anchor;
    previewTargets = targets;
    previewKey = key(selected.kind,selected.id);
    const heading = document.createElement('div');
    heading.className = 'faith-tooltip-heading';
    const title = document.createElement('strong');
    title.textContent = selected.name;
    const count = document.createElement('span');
    count.textContent = '供奉神明 · ' + names.length;
    heading.append(title,count);
    const list = document.createElement('ul');
    for (const name of names) { const item = document.createElement('li'); item.textContent = name; list.append(item); }
    preview.replaceChildren(heading,list);
    preview.hidden = false;
    preview.scrollTop = 0;
    anchor.setAttribute('aria-describedby',preview.id);
    positionPreview();
  }
  function bindPreview(button, label, getVillage) {
    for (const target of [button,label]) {
      target.addEventListener('pointerenter',event=>{
        if (event.pointerType === 'touch' || event.buttons || $('map-stage').classList.contains('is-picking') || $('map-stage').classList.contains('is-dragging')) return;
        clearTimeout(hideTimer);
        clearTimeout(previewTimer);
        const selected = getVillage();
        if (selected.id && previewKey === key(selected.kind,selected.id)) return;
        dismissPreview();
        previewTimer = setTimeout(()=>showPreview(target,getVillage(),[button,label]),180);
      });
      target.addEventListener('pointerleave',()=>{
        clearTimeout(previewTimer);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(dismissPreview,140);
      });
    }
    button.addEventListener('focus',()=>{
      if (button.matches(':focus-visible') && !$('map-stage').classList.contains('is-picking')) { dismissPreview(); showPreview(button,getVillage(),[button,label]); }
    });
    button.addEventListener('blur',dismissPreview);
  }
  preview.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  preview.addEventListener('pointerleave',()=>{ hideTimer = setTimeout(dismissPreview,140); });
  document.addEventListener('keydown',event=>{ if (event.key === 'Escape') dismissPreview(); });
  document.addEventListener('pointerdown',event=>{ if (!preview.contains(event.target)) dismissPreview(); },true);
  document.addEventListener('scroll',event=>{
    if (preview.contains(event.target)) return;
    if (!preview.hidden && previewAnchor === document.activeElement && previewAnchor.matches(':focus-visible')) positionPreview();
    else dismissPreview();
  },true);
  window.addEventListener('resize',dismissPreview);
  function validate(document) {
    if (document?.version !== 1 || !Number.isInteger(document.revision) || document.revision < 0 || !Array.isArray(document.records) || document.records.length > 10000) throw Error('信仰资料格式无效。');
    const ids = new Set();
    for (const record of document.records) {
      if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 120 || ids.has(record.id)) throw Error('记录编号无效。');
      ids.add(record.id);
      if (!['reference','survey'].includes(record.villageKind) || typeof record.villageId !== 'string' || !record.villageId || record.villageId.length > 120 || typeof record.villageName !== 'string' || !record.villageName.trim() || record.villageName.length > 100) throw Error('村庄资料无效。');
      if (!Array.isArray(record.deities) || !record.deities.length || record.deities.length > 100 || record.deities.some(name=>typeof name !== 'string' || !name.trim() || name.length > 100)) throw Error('请填写神明名称。');
      for (const [field,limit] of Object.entries(textLimits)) if (record[field] !== undefined && (typeof record[field] !== 'string' || record[field].length > limit)) throw Error('填写内容过长。');
      if (record.visitedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(record.visitedOn) || Number.isNaN(Date.parse(record.visitedOn)))) throw Error('走访日期无效。');
    }
    return {version:1,revision:document.revision,records:document.records};
  }
  function enable() {
    $('faith-add').disabled = !state || saving;
    $('faith-form').inert = saving;
    for (const id of ['faith-export-csv','faith-export-json','faith-import']) $(id).disabled = !state || saving;
    for (const button of $('faith-list').querySelectorAll('button')) button.disabled = saving;
  }
  function closeForm() {
    $('faith-form').hidden = true;
    $('faith-form').reset();
    $('faith-more').open = false;
    editingId = null;
    dirty = false;
  }
  function render() {
    const list = $('faith-list');
    list.replaceChildren();
    const records = state?.records.filter(sameVillage) || [];
    $('faith-section').hidden = !village || (!!village.hideWhenEmpty && !records.length);
    $('faith-title').textContent = village?.title || '供奉神明';
    $('faith-count').textContent = records.length > 1 ? records.length + ' 条' : '';
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = state ? '暂无收录记录' : '';
      list.append(empty);
    }
    for (const record of records) {
      const card = document.createElement('article');
      card.className = 'faith-card';
      const row = document.createElement('div');
      row.className = 'faith-card-heading';
      if (record.temple) {
        const title = document.createElement('h3');
        title.textContent = record.temple;
        row.append(title);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'linkbutton';
      edit.textContent = '编辑';
      edit.setAttribute('aria-label','编辑信仰记录' + (record.temple ? '：' + record.temple : ''));
      edit.addEventListener('click',()=>{ if (mayLeave()) openForm(record); });
      row.append(edit);
      card.append(row);
      const names = document.createElement('ul');
      names.className = 'deity-list';
      for (const name of record.deities) { const li = document.createElement('li'); li.textContent = name; names.append(li); }
      card.append(names);
      for (const [kind,content] of [['festival',record.festival],['body',record.note],['meta',[record.source,record.visitedOn].filter(Boolean).join(' · ')]]) {
        if (!content) continue;
        const paragraph = document.createElement('p');
        paragraph.className = 'faith-note faith-' + kind;
        paragraph.textContent = content;
        card.append(paragraph);
      }
      list.append(card);
    }
    enable();
  }
  function mayLeave() { return !saving && (!dirty || window.confirm('信仰记录尚未保存。要放弃填写吗？')); }
  function openForm(record=null) {
    if (!village || !state || saving) return;
    closeForm();
    editingId = record?.id || null;
    $('faith-deities').value = record?.deities.join('\n') || '';
    for (const field of fields) $('faith-' + field).value = record?.[field] || '';
    $('faith-delete').hidden = !editingId;
    $('faith-form').hidden = false;
    status('');
    $('faith-deities').focus();
  }
  async function save(records) {
    if (!state || saving) return false;
    saving = true;
    enable();
    status('保存中…');
    try {
      const response = await (window.NaozhouCloud?.request || fetch)('./api/faith',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,revision:state.revision,records})});
      const result = await response.json();
      if (response.status === 409) {
        state = validate(result);
        render();
        onChange();
        throw Error('另一页面已更新，填写内容仍保留，请再次保存。');
      }
      if (!response.ok) throw Error('未能保存，请保留当前填写内容。');
      state = validate(result);
      onChange();
      status('已保存');
      return true;
    } catch (error) { status(error.message); return false; }
    finally { saving = false; enable(); }
  }
  $('faith-add').addEventListener('click',()=>{ if (mayLeave()) openForm(); });
  $('faith-cancel').addEventListener('click',()=>{ if (mayLeave()) closeForm(); });
  $('faith-form').addEventListener('input',()=>{ dirty = true; status(''); });
  $('faith-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if (!village || !state || saving || !$('faith-form').reportValidity()) return;
    const deities = [...new Set($('faith-deities').value.split(/[\n、,，;；]+/).map(name=>name.trim()).filter(Boolean))];
    const old = state.records.find(record=>record.id === editingId);
    const now = new Date().toISOString();
    const record = {id:editingId || (crypto.randomUUID ? crypto.randomUUID() : 'faith-' + Date.now() + '-' + Math.random().toString(36).slice(2)),villageId:village.id,villageKind:village.kind,villageName:village.name,deities,createdAt:old?.createdAt || now,updatedAt:now};
    for (const field of fields) record[field] = $('faith-' + field).value.trim();
    const records = state.records.filter(item=>item.id !== record.id).concat(record);
    try { validate({version:1,revision:state.revision,records}); }
    catch (error) { status(error.message); return; }
    if (await save(records)) { closeForm(); render(); }
  });
  $('faith-delete').addEventListener('click',async()=>{
    if (!editingId || saving || !window.confirm('移除这条信仰记录？')) return;
    if (await save(state.records.filter(record=>record.id !== editingId))) { closeForm(); render(); }
  });
  function exportData(type) {
    if (!state) return;
    if (type === 'json') {
      download('硇洲岛信仰记录-' + dateStamp() + '.json','application/json;charset=utf-8',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2));
      return;
    }
    const cell = value => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; };
    const rows = [['记录编号','村庄编号','村庄类型','村庄','神明','宫庙／供奉场所','祭期与活动','资料来源','走访日期','访谈笔记','创建时间','修改时间']];
    for (const record of state.records) for (const name of record.deities) rows.push([record.id,record.villageId,record.villageKind,record.villageName,name,record.temple,record.festival,record.source,record.visitedOn,record.note,record.createdAt,record.updatedAt]);
    download('硇洲岛信仰记录-' + dateStamp() + '.csv','text/csv;charset=utf-8','\uFEFF' + rows.map(row=>row.map(cell).join(',')).join('\r\n'));
  }
  $('faith-export-csv').addEventListener('click',()=>exportData('csv'));
  $('faith-export-json').addEventListener('click',()=>exportData('json'));
  $('faith-import').addEventListener('click',()=>{ if (mayLeave()) $('faith-import-file').click(); });
  $('faith-import-file').addEventListener('change',async()=>{
    const file = $('faith-import-file').files[0];
    if (!file || !state) return;
    try {
      if (file.size > 10*1024*1024) throw Error('备份文件超过10 MB。');
      const incoming = validate(JSON.parse(await file.text()));
      const ids = new Set(state.records.map(record=>record.id));
      const records = state.records.concat(incoming.records.filter(record=>!ids.has(record.id)));
      validate({version:1,revision:state.revision,records});
      if (await save(records)) { closeForm(); render(); }
    } catch (error) { window.alert(error.message); }
    finally { $('faith-import-file').value = ''; }
  });
  async function load() {
    enable();
    try {
      if (location.protocol === 'file:') throw Error('请用“打开地图.cmd”录入信仰资料。');
      const response = await (window.NaozhouCloud?.request || fetch)('./api/faith',{cache:'no-store'});
      if (!response.ok) throw Error('信仰资料未能读取，请重新打开地图。');
      state = validate(await response.json());
      status('');
      onChange();
    } catch (error) { status(error.message); }
    render();
  }
  load();
  return {
    get dirty() { return dirty; },
    get saving() { return saving; },
    mayLeave,
    bindPreview,
    dismissPreview,
    selectVillage(selected) { closeForm(); village = selected; $('faith-section').hidden = false; render(); },
    clearVillage() { closeForm(); village = null; $('faith-section').hidden = true; },
    hasRecords(id,kind) { return !!state?.records.some(record=>record.villageId === id && record.villageKind === kind); },
    matches(id,kind,term) { return !!state?.records.some(record=>record.villageId === id && record.villageKind === kind && [...record.deities,record.temple].some(value=>value?.toLocaleLowerCase().includes(term))); }
  };
};
