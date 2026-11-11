/* Ritual indexes are derived from the journals visible to the current reader. */
window.RitualAtlas = (() => {
  'use strict';
  const A = window.DeityAtlas, el = A.element;
  const endpoint = '/api/field-entries?view=rituals';
  const request = (...args) => (window.NaozhouCloud?.request || fetch)(...args);
  const $ = id => document.getElementById(id);
  let state = null, pending = null, sequence = 0, error = '', started = false;
  let byType = new Map(), refreshWorkspace = () => {}, related = null;

  function url(id = '', returnMap = '') {
    return '/deities?'+new URLSearchParams({view:'rituals', ...(id ? {ritualId:id} : {}), ...(returnMap ? {mapReturn:returnMap} : {})});
  }

  function anchor(text, href, className = '') {
    const link = el('a', className, text);
    link.href = href;
    return link;
  }

  function journalURL(entry) {
    return A.entryURL(entry.placeKind,entry.placeId,entry.id);
  }

  function dateLabel(entry) {
    if (!entry.observedAt) return entry.originalDateText || '日期待考';
    if (entry.datePrecision === 'year') return entry.observedAt+' 年';
    if (entry.datePrecision === 'month') return entry.observedAt.replace('-',' 年 ')+' 月';
    return entry.observedAt.replaceAll('-','.');
  }

  const typeList = () => (state?.ritualTypes || []).slice().sort((a,b) => a.sortOrder-b.sortOrder || a.id.localeCompare(b.id));
  const rowsFor = id => byType.get(id) || [];
  const placeName = entry => window.PlaceNames.name(entry.placeKind, entry.placeId, entry.placeKind === 'survey' ? '调查点位' : '地点档案');

  function index(data) {
    state = data;
    byType = new Map();
    for (const entry of data?.records || []) {
      for (const link of entry.ritualLinks) {
        if (!byType.has(link.ritualTypeId)) byType.set(link.ritualTypeId, []);
        byType.get(link.ritualTypeId).push({entry, deityIds:link.deityIds});
      }
    }
    for (const rows of byType.values()) rows.sort((a,b) => (b.entry.observedAt || '').localeCompare(a.entry.observedAt || '') || a.entry.id.localeCompare(b.entry.id));
    refreshWorkspace();
    drawRelated();
  }

  function validate(data) {
    if (data?.version !== 1 || !Array.isArray(data.ritualTypes) || !Array.isArray(data.records)) throw Error('仪式汇总资料格式无效。');
    return data;
  }

  function load() {
    if (pending) return pending;
    started = true;
    const version = ++sequence;
    error = '';
    const job = request(endpoint, {cache:'no-store'}).then(async response => {
      if (!response.ok) throw Error('仪式汇总暂未读取。');
      const result = validate(await response.json());
      if (sequence === version) index(result);
    }).catch(problem => {
      if (sequence === version) {
        error = problem.message;
        refreshWorkspace();
        drawRelated();
      }
    }).finally(() => { if (pending === job) pending = null; });
    pending = job;
    return job;
  }

  document.addEventListener('naozhou-access-change', event => {
    if (!started || event.detail.reason === 'session' && !state) return;
    sequence++;
    pending = null;
    index(null);
    load();
  });

  function button(text, handler, className = '') {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function drawRelated() {
    if (!related?.host.isConnected) return;
    const {host, deityId, returnMap} = related;
    host.replaceChildren();
    if (error && !state) {
      host.append(button('重新读取相关仪式', load, 'linkbutton'));
      return;
    }
    const section = el('section', 'deity-section ritual-related');
    for (const type of typeList()) {
      const rows = rowsFor(type.id).filter(item => item.deityIds.includes(deityId));
      if (!rows.length) continue;
      const row = el('div', 'ritual-related-row');
      const details = el('details');
      details.append(el('summary', '', rows.length+' 条田野日志'));
      for (const {entry} of rows) {
        const item = el('p');
        item.append(anchor(entry.title, journalURL(entry)), el('small', '', dateLabel(entry)));
        details.append(item);
      }
      row.append(anchor(type.name, url(type.id, returnMap)), details);
      section.append(row);
    }
    if (section.childElementCount) {
      section.prepend(el('h3', '', '相关仪式'));
      host.append(section);
    }
  }

  function renderRelated(host, deityId, returnMap) {
    related = {host, deityId, returnMap};
    drawRelated();
    if (!started) load();
  }

  async function mutate(action, revision, values) {
    const response = await request(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:1, revision, action, ...values})});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '资料未保存，请重试。');
    sequence++;
    pending = null;
    index(validate(result));
    return result;
  }

  function editDirectory() {
    if (!state?.editable) return;
    const revision = state.revision, dialog = el('dialog', 'atlas-dialog ritual-directory');
    dialog.setAttribute('aria-label', '管理仪式类型');
    const form = el('form'), rows = el('div'), status = el('p', 'status');
    status.setAttribute('role', 'status');
    const editors = [];
    let dirty = false, saving = false;
    function field(host, labelText, control, value) {
      const label = el('label', '', labelText);
      control.value = value;
      label.append(control);
      host.append(label);
      return control;
    }
    function addType(type, open = false) {
      const row = el('details', 'ritual-directory-row'), summary = el('summary', '', type.name || '新增仪式类型');
      const id = type.id || A.uid();
      row.append(summary);
      const name = field(row, '仪式名称', el('input'), type.name || '');
      name.maxLength = 100;
      name.required = true;
      name.addEventListener('input', () => { summary.textContent = name.value.trim() || '新增仪式类型'; });
      const aliases = field(row, '别称（每行一个）', el('textarea'), (type.aliases || []).join('\n'));
      aliases.rows = 2;
      aliases.maxLength = 3050;
      const description = field(row, '仪式介绍', el('textarea'), type.description || '');
      description.rows = 3;
      description.maxLength = 10000;
      const order = field(row, '排序（数字小的在前）', el('input'), type.sortOrder ?? Math.min(9999, (editors.length+1)*10));
      order.type = 'number';order.min = '0';order.max = '9999';order.required = true;
      const enabled = el('input');
      enabled.type = 'checkbox';enabled.checked = type.enabled !== false;
      const active = el('label', 'ritual-directory-enabled');
      active.append(enabled, document.createTextNode('启用此类型'));
      row.append(active);
      const read = () => ({id, name:name.value, aliases:aliases.value.split('\n').map(value => value.trim()).filter(Boolean), description:description.value, sortOrder:order.valueAsNumber, enabled:enabled.checked});
      editors.push(read);
      if (!type.id) row.append(button('移除未保存的类型', () => {editors.splice(editors.indexOf(read),1);row.remove();dirty=true;}, 'linkbutton'));
      row.open = open;
      rows.append(row);
      if (open) name.focus();
    }
    const add = button('＋ 新增仪式类型', () => {addType({}, true);dirty=true;});
    const close = event => {
      if (saving || dirty && !window.confirm('仪式目录尚未保存。要放弃填写吗？')) {event.preventDefault();return;}
      dialog.close();
    };
    const save = el('button', 'primary', '保存仪式目录');
    save.type = 'submit';
    const actions = el('div', 'button-row form-actions');
    actions.append(save, button('取消', close));
    form.append(el('h2', '', '管理仪式类型'), rows, add, status, actions);
    form.addEventListener('input', () => {dirty=true;});
    form.addEventListener('invalid', event => {const row=event.target.closest('details');if(row)row.open=true;}, true);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      saving = form.inert = true;
      status.textContent = '正在保存…';
      try {
        await mutate('save-ritual-types', revision, {ritualTypes:editors.map(read => read())});
        dialog.close();
        $('ritual-status').textContent = '仪式目录已保存。';
      } catch (problem) {status.textContent=problem.message;}
      finally {saving=form.inert=false;}
    });
    for (const type of typeList()) addType(type);
    dialog.append(form);
    dialog.addEventListener('cancel', close);
    dialog.addEventListener('close', () => {dialog.remove();$('ritual-manage').focus();}, {once:true});
    document.body.append(dialog);
    dialog.showModal();
  }

  async function exportBackup() {
    const status = $('ritual-status');
    status.textContent = '正在读取备份资料…';
    try {
      const response = await request('/api/field-entries', {cache:'no-store'});
      if (!response.ok) throw Error('日志备份暂未读取。');
      const result = validate(await response.json());
      if (!result.editable) throw Error('请先登录编辑，再导出完整备份。');
      const {version, ritualTypes, records} = result;
      const data = JSON.stringify({version, ritualTypes, records}, null, 2);
      const objectURL = URL.createObjectURL(new Blob([data], {type:'application/json;charset=utf-8'}));
      const link = anchor('', objectURL);
      link.download = '硇洲岛田野日志与仪式-'+new Date().toLocaleDateString('sv-SE')+'.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectURL), 5000);
      status.textContent = '已导出 '+records.length+' 条日志与仪式目录。';
    } catch (problem) {status.textContent=problem.message;}
  }

  async function importBackup(file) {
    if (!state?.editable || !file) return;
    const status = $('ritual-status');
    try {
      if (file.size > 5*1024*1024) throw Error('备份文件超过 5 MB。');
      const backup = JSON.parse(await file.text());
      if (backup?.version !== 1 || !Array.isArray(backup.records)) throw Error('请选择田野日志与仪式 JSON 备份。');
      const dialog = el('dialog', 'atlas-dialog');
      dialog.setAttribute('aria-label','导入日志与仪式');
      const form = el('form');form.method='dialog';
      const actions = el('div','button-row form-actions');
      const cancel = el('button','','取消'), accept = el('button','primary','确认导入');
      cancel.value='cancel';cancel.autofocus=true;accept.value='import';actions.append(cancel,accept);
      form.append(el('h2','','导入日志与仪式'),el('p','archive-prose',`备份包含 ${backup.records.length} 条日志。新记录按原有可见范围恢复，同编号资料保留现状。`),actions);
      dialog.append(form);document.body.append(dialog);
      const accepted = await new Promise(resolve=>{
        dialog.addEventListener('close',()=>{dialog.remove();resolve(dialog.returnValue==='import');},{once:true});
        dialog.showModal();
      });
      if (!accepted || !state?.editable) return;
      status.textContent='正在导入…';
      const result = await mutate('import',state.revision,{backup,confirmPublic:true});
      status.textContent='已导入 '+result.importedCount+' 条日志。同编号资料已保留。';
    } catch (problem) {status.textContent=problem.message;}
  }

  function mount(catalog, returnMap) {
    const nav = $('ritual-index'), content = $('ritual-document'), tools = $('ritual-editor-tools');
    const input = $('ritual-import-file');
    let selected = new URLSearchParams(location.search).get('ritualId') || '';
    const deityLink = id => anchor(catalog.get(id)?.name || '神明档案', A.profileURL(id, returnMap));
    const go = (id, event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      selected = id;
      history.pushState({}, '', url(id, returnMap));
      render();
      $('ritual-detail').scrollTop=0;
      content.querySelector('h2')?.focus({preventScroll:true});
    };
    function typeLink(text, id, className) {
      const link = anchor(text,url(id,returnMap),className);
      link.addEventListener('click', event => go(id,event));
      return link;
    }
    function names(parent, title, links) {
      if (!links.length) return;
      const section = el('section','deity-section');
      const list = el('div','ritual-name-links');
      list.append(...links);
      section.append(el('h3','',title),list);
      parent.append(section);
    }
    function render() {
      const types = typeList(), type = types.find(item=>item.id===selected);
      tools.hidden = !state?.editable;
      nav.replaceChildren(typeLink('全部仪式','','category-button'));
      for (const item of types.filter(item=>item.enabled||item.id===selected)) nav.append(typeLink(item.name+(item.enabled?'':'（已停用）'),item.id,'category-button'));
      const current = [...nav.querySelectorAll('a')].find(link=>new URL(link.href).searchParams.get('ritualId')===(selected||null));
      current?.setAttribute('aria-current','true');
      content.replaceChildren();
      const heading = el('h2','',type?.name || '仪式汇总');heading.tabIndex=-1;
      content.append(heading);
      if (!state) {
        content.append(el('p','note',error || '正在读取仪式汇总…'));
        if (error) content.append(button('重新读取',load,'linkbutton'));
        return;
      }
      if (selected && !type) {content.append(el('p','note','未找到此仪式类型。'));return;}
      if (!type) {
        for (const item of types.filter(value=>value.enabled)) {
          const rows = rowsFor(item.id);
          const deities = new Set(rows.flatMap(row=>row.deityIds));
          const places = new Set(rows.map(({entry})=>entry.placeKind+':'+entry.placeId));
          const card = el('article','ritual-type-card');
          card.append(typeLink(item.name,item.id,'ritual-type-name'));
          if (item.description) card.append(el('p','archive-prose',item.description));
          card.append(el('p','note',`${rows.length} 条日志 · ${deities.size} 位神明 · ${places.size} 处地点`));
          content.append(card);
        }
        if (!types.some(item=>item.enabled)) content.append(el('p','note','暂无已启用的仪式类型。'));
        return;
      }
      if (!type.enabled) content.append(el('p','note','此类型已停用，历史记录仍可查阅。'));
      if (type.aliases.length) content.append(el('p','note','别称：'+type.aliases.join('、')));
      if (type.description) {
        const introduction = el('section','deity-section');
        introduction.append(el('h3','','仪式介绍'),el('p','archive-prose',type.description));
        content.append(introduction);
      }
      const rows = rowsFor(type.id), places = new Map(), deities = new Set();
      for (const {entry, deityIds} of rows) {
        places.set(entry.placeKind+':'+entry.placeId,entry);
        for (const id of deityIds) deities.add(id);
      }
      names(content,'相关神明',[...deities].map(deityLink));
      names(content,'相关村庄',[...places.values()].map(entry=>anchor(placeName(entry),A.mapURL(entry.placeKind,entry.placeId))));
      const journals = el('section','deity-section');
      journals.append(el('h3','','相关田野日志'));
      for (const {entry,deityIds} of rows) {
        const row = el('article','ritual-journal-row');
        row.append(el('h4','',entry.title),el('p','note',[dateLabel(entry),placeName(entry),entry.visibility==='editors'?'仅编辑者':''].filter(Boolean).join(' · ')));
        if (deityIds.length) {const group=el('div','ritual-name-links');group.append(...deityIds.map(deityLink));row.append(group);}
        if (entry.excerpt) row.append(el('p','archive-prose',entry.excerpt));
        row.append(anchor('查看原文 ↗',journalURL(entry),'ritual-entry-link'));
        journals.append(row);
      }
      if (!rows.length) journals.append(el('p','note','暂无可查看的相关日志。'));
      content.append(journals);
    }
    $('ritual-manage').addEventListener('click',editDirectory);
    $('ritual-export').addEventListener('click',exportBackup);
    $('ritual-import').addEventListener('click',()=>input.click());
    input.addEventListener('change',()=>{const file=input.files[0];input.value='';importBackup(file);});
    window.addEventListener('popstate',()=>{selected=new URLSearchParams(location.search).get('ritualId')||'';render();});
    window.addEventListener('pageshow',event=>{if(event.persisted)load();});
    catalog.subscribe(render);
    catalog.ready.catch(()=>{});
    window.DeityVillageLinks.loadIndex().then(render).catch(()=>{});
    refreshWorkspace=render;
    render();
    load();
  }

  return {url, mount, renderRelated};
})();
