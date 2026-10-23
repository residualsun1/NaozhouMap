/* Village prose is stored separately from geography, survey points and faith records. */
window.createPlaceArchives = options => {
  'use strict';
  const {download, onPlaceChange, onLegacy} = options;
  const $ = id => document.getElementById(id);
  const fields = ['introduction'];
  let state = null, place = null, editing = null, dirty = false, saving = false;
  const matches = (record, selected=place) => selected && record.villageId === selected.id && record.villageKind === selected.kind;
  const current = () => state?.records.find(record=>matches(record));
  function validate(document) {
    if (document?.version !== 1 || !Number.isInteger(document.revision) || document.revision < 0 || !Array.isArray(document.records) || document.records.length > 10000) throw Error('村庄档案格式无效。');
    const ids = new Set(), places = new Set();
    for (const record of document.records) {
      const key = record.villageKind + ':' + record.villageId;
      if (typeof record.id !== 'string' || !record.id || record.id.length > 120 || ids.has(record.id) || places.has(key)) throw Error('档案编号或村庄关联重复。');
      ids.add(record.id); places.add(key);
      if (!['reference','survey'].includes(record.villageKind) || typeof record.villageId !== 'string' || !record.villageId || record.villageId.length > 120 || typeof record.villageName !== 'string' || !record.villageName.trim() || record.villageName.length > 100) throw Error('村庄关联无效。');
      for (const [field,limit] of Object.entries({introduction:20000,note:20000,createdAt:100,updatedAt:100})) if (record[field] !== undefined && (typeof record[field] !== 'string' || record[field].length > limit)) throw Error('档案内容无效或过长。');
    }
    return {version:1,revision:document.revision,records:document.records};
  }
  function enable() {
    $('place-overview-edit').hidden = !place; $('place-overview-edit').disabled = !state || saving;
    for (const id of ['archive-export','archive-import']) $(id).disabled = !state || saving;
    for (const field of fields) $('archive-' + field + '-form').inert = saving;
  }
  function render() {
    const record = current();
    const introduction = record?.introduction ?? place?.introduction ?? '';
    const note = place?.kind === 'survey' ? place.note || '' : record?.note ?? place?.note ?? '';
    $('place-overview').textContent = introduction || '暂无基本情况介绍';
    $('place-overview').classList.toggle('is-empty',!introduction);
    $('place-overview').hidden = editing === 'introduction';
    onLegacy?.(note ? {content:note,source:place?.kind==='survey'?'原调查点位笔记':'原村庄档案田野笔记'} : null);
    enable();
  }
  function closeForm() {
    for (const field of fields) { $('archive-' + field + '-form').hidden = true; $('archive-' + field + '-status').textContent = ''; }
    editing = null; dirty = false; render();
  }
  function mayLeave() { return !saving && (!dirty || window.confirm('村庄档案尚未保存。要放弃填写吗？')); }
  function openForm(field) {
    if (!place || !state || saving || !mayLeave()) return;
    closeForm(); editing = field;
    $('archive-' + field).value = current()?.[field] ?? place[field] ?? '';
    $('archive-' + field + '-form').hidden = false; render();
    $('archive-' + field).focus();
  }
  async function save(records, statusNode) {
    saving = true; enable(); statusNode.textContent = '保存中…';
    try {
      const response = await (window.NaozhouCloud?.request || fetch)('./api/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,revision:state.revision,records})});
      const result = await response.json();
      if (response.status === 409) { state = validate(result); throw Error('另一页面已更新，填写内容仍保留，请再次保存。'); }
      if (!response.ok) throw Error(result.error || '未能保存，请保留当前填写内容。');
      state = validate(result); statusNode.textContent = '已保存'; return true;
    } catch (error) { statusNode.textContent = error.message; return false; }
    finally { saving = false; enable(); }
  }
  for (const field of fields) {
    const form = $('archive-' + field + '-form');
    form.addEventListener('input',()=>{dirty = true; $('archive-' + field + '-status').textContent = '';});
    form.querySelector('[data-archive-cancel]').addEventListener('click',()=>{if (mayLeave()) closeForm();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!place || !state || saving || !form.reportValidity()) return;
      const previous = current(), now = new Date().toISOString();
      const record = {...previous,id:previous?.id || crypto.randomUUID(),villageId:place.id,villageKind:place.kind,villageName:place.name,introduction:previous?.introduction ?? place.introduction ?? '',note:previous?.note ?? (place.kind === 'survey' ? '' : place.note || ''),createdAt:previous?.createdAt || now,updatedAt:now,[field]:$('archive-' + field).value.trim()};
      const records = state.records.filter(item=>!matches(item)).concat(record);
      try { validate({version:1,revision:state.revision,records}); }
      catch (error) { $('archive-' + field + '-status').textContent = error.message; return; }
      if (await save(records,$('archive-' + field + '-status'))) { closeForm(); $('archive-' + field + '-status').textContent = '已保存'; }
    });
  }
  $('place-overview-edit').addEventListener('click',()=>openForm('introduction'));
  $('archive-export').addEventListener('click',()=>{
    if (state) download('硇洲岛村庄档案-' + new Date().toLocaleDateString('sv-SE') + '.json','application/json;charset=utf-8',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2));
  });
  $('archive-import').addEventListener('click',()=>{if (mayLeave()) $('archive-import-file').click();});
  $('archive-import-file').addEventListener('change',async()=>{
    const file = $('archive-import-file').files[0];
    if (!file || !state || saving) return;
    try {
      if (file.size > 5*1024*1024) throw Error('档案备份超过 5 MB。');
      const incoming = validate(JSON.parse(await file.text()));
      const ids = new Set(state.records.map(record=>record.id));
      const records = state.records.concat(incoming.records.filter(record=>!ids.has(record.id) && !state.records.some(item=>matches(item,{id:record.villageId,kind:record.villageKind}))));
      validate({version:1,revision:state.revision,records});
      if (await save(records,$('archive-import-status'))) closeForm();
    } catch (error) { $('archive-import-status').textContent = error.message; }
    finally { $('archive-import-file').value = ''; }
  });
  async function load() {
    enable();
    try {
      const response = await (window.NaozhouCloud?.request || fetch)('./api/archives',{cache:'no-store'});
      if (!response.ok) throw Error('村庄档案未能读取，请刷新重试。');
      state = validate(await response.json());
    } catch (error) { $('archive-import-status').textContent = error.message; }
    render();
  }
  load();
  return {
    get dirty() { return dirty; }, get saving() { return saving; }, mayLeave,
    selectPlace(selected) { place = selected; onPlaceChange?.(selected); closeForm(); },
    clear() { place = null; onPlaceChange?.(null); closeForm(); }
  };
};
