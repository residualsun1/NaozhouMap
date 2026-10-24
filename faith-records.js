/* Village faith records use stable place IDs and their own project file. */
window.createFaithRecords = options => {
  'use strict';
  const {download, onChange, onExploreDeity} = options;
  const $ = id => document.getElementById(id);
  const textLimits = {temple:200, festival:500, source:200, visitedOn:10, note:5000, createdAt:100, updatedAt:100};
  const fields = ['temple','festival','source','visitedOn','note'];
  let state = null, village = null, editingId = null, dirty = false, saving = false;
  let loadError='';const listeners=new Set();
  function changed(){onChange();for(const listener of listeners)listener();}
  const A=window.DeityAtlas,catalog=A.createCatalog();
  let choices=[],linkingIndex=null,quickFields=null,quickDirty=false,quickSaving=false,highlightedRecordId=null,pendingRecordFocus=false;
  const key = (kind, id) => kind + ':' + id;
  const sameVillage = record => village && key(record.villageKind,record.villageId) === key(village.kind,village.id);
  const status = message => { $('faith-status').textContent = message; };
  const dateStamp = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
  function syncChoices(){ $('faith-deities').value=choices.map(choice=>choice.name).join('\n'); }
  function beginLink(index){linkingIndex=index;$('faith-deity-search').value=choices[index].name;renderPicker();$('faith-deity-search').focus();}
  function renderChoices(){
    syncChoices();$('faith-picked-list').replaceChildren();
    choices.forEach((choice,index)=>{
      const row=A.element('div','faith-choice'),heading=A.element('div','faith-choice-heading');heading.append(A.element('strong','',choice.link?.localName||choice.name));
      const identity=choice.link?catalog.get(choice.link.deityId):null;
      heading.append(A.element('small','',choice.link?'已关联':'待关联'));
      const link=A.element('button','linkbutton',choice.link?'更换':'关联');link.type='button';link.setAttribute('aria-label',(choice.link?'更换':'关联')+'神明档案：'+choice.name);link.addEventListener('click',()=>beginLink(index));
      const remove=A.element('button','linkbutton','移除');remove.type='button';remove.setAttribute('aria-label','移除所选神明：'+choice.name);remove.addEventListener('click',()=>{choices.splice(index,1);linkingIndex=null;dirty=true;renderChoices();renderPicker();});heading.append(link,remove);row.append(heading);
      if(choice.link){const meta=A.element('details'),summary=A.element('summary','','当地称谓与神函');meta.append(summary);if(identity)meta.append(A.element('p','faith-picker-caption','总库：'+identity.name+' · '+identity.id.slice(-8)));
        for(const [field,label,max] of [['localName','当地称谓',100],['localTitle','当地神函',200]]){const caption=A.element('label','',label),input=A.element('input');input.id='faith-'+field+'-'+index;caption.htmlFor=input.id;input.maxLength=max;input.value=choice.link[field]||'';input.addEventListener('input',()=>{choice.link[field]=input.value;dirty=true;});meta.append(caption,input);}
        const unlink=A.element('button','linkbutton','解除关联，保留原名称');unlink.type='button';unlink.addEventListener('click',()=>{choice.link=null;dirty=true;renderChoices();});meta.append(unlink);row.append(meta);
      }
      $('faith-picked-list').append(row);
    });
  }
  function chooseDeity(deity){
    if(linkingIndex!==null&&choices[linkingIndex]){const choice=choices[linkingIndex];choice.link={id:choice.link?.id||A.uid(),deityId:deity.id,localName:choice.link?.localName||choice.name,localTitle:choice.link?.localTitle||''};}
    else choices.push({name:deity.name,link:{id:A.uid(),deityId:deity.id,localName:'',localTitle:''}});
    linkingIndex=null;dirty=true;$('faith-deity-search').value='';renderChoices();renderPicker();
  }
  function renderPicker(){
    const query=$('faith-deity-search').value.trim(),results=$('faith-deity-results');results.replaceChildren();$('faith-picker-actions').hidden=!query;
    $('faith-deity-create').disabled=!catalog.state||catalog.saving;
    if(!query){$('faith-picker-status').textContent='';return;}
    const matches=catalog.search(query);
    $('faith-picker-status').textContent=linkingIndex!==null?'为「'+choices[linkingIndex].name+'」选择神明档案':!catalog.state?'总库暂不可用，可先仅记录名称。':matches.length?'请选择档案；同名不代表同一尊。':'暂无匹配档案，可新建或先记录名称。';
    for(const record of matches.slice(0,12)){const button=A.element('button','faith-picker-result');button.type='button';button.setAttribute('aria-label','选择神明 '+record.name+' · '+record.id.slice(-8));button.append(A.element('strong','',record.name));const names=record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);button.append(A.element('small','',(names.join(' · ')||'待分类')+' · '+record.id.slice(-8)));if(record.aliases.length)button.append(A.element('small','',record.aliases.join(' / ')));if(record.identityNote)button.append(A.element('small','',record.identityNote));button.addEventListener('click',()=>chooseDeity(record));results.append(button);}
    if(linkingIndex!==null){const cancel=A.element('button','linkbutton','取消本次关联选择');cancel.type='button';cancel.addEventListener('click',()=>{linkingIndex=null;$('faith-deity-search').value='';renderPicker();});results.append(cancel);}
  }
  $('faith-deity-search').addEventListener('input',renderPicker);
  $('faith-deity-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();renderPicker();}});
  $('faith-deity-legacy').addEventListener('click',()=>{const name=$('faith-deity-search').value.trim();if(!name)return;if(linkingIndex!==null)choices[linkingIndex]={name,link:null};else choices.push({name,link:null});linkingIndex=null;dirty=true;$('faith-deity-search').value='';renderChoices();renderPicker();});
  const quickDialog=$('quick-deity-dialog');
  $('faith-deity-create').addEventListener('click',()=>{if(!catalog.state||saving||quickSaving)return;quickFields=A.createFields($('quick-deity-fields'),catalog,{name:$('faith-deity-search').value.trim()},'quick-deity',{chooseLabel:'选择已有神明',onExisting:async record=>{if(quickDirty&&!await window.PeopleArchive.confirm('放弃新建内容，改为关联这份已有神明档案？','使用已有档案'))return;chooseDeity(record);quickDirty=false;quickFields.destroy?.();quickDialog.close();$('faith-deity-search').focus();}});quickDirty=false;$('quick-deity-status').textContent='';quickDialog.showModal();quickFields.focus();});
  $('quick-deity-form').addEventListener('input',()=>{quickDirty=true;});
  function cancelQuick(event){if(quickSaving||(quickDirty&&!window.confirm('新神明档案尚未保存。要放弃填写吗？'))){event?.preventDefault();return;}quickDirty=false;quickDialog.close();}
  $('quick-deity-cancel').addEventListener('click',cancelQuick);quickDialog.addEventListener('cancel',cancelQuick);
  $('quick-deity-form').addEventListener('submit',async event=>{event.preventDefault();if(quickSaving||!$('quick-deity-form').reportValidity())return;quickSaving=true;$('quick-deity-form').inert=true;$('quick-deity-status').textContent='保存中…';try{const record=await catalog.saveRecord(quickFields.read());chooseDeity(record);quickDirty=false;quickDialog.close();$('faith-deity-search').focus();}catch(error){$('quick-deity-status').textContent=error.message;}finally{quickSaving=false;$('quick-deity-form').inert=false;}});
  catalog.subscribe(()=>{if(village)render();if(!$('faith-form').hidden){renderChoices();renderPicker();}});
  catalog.ready.catch(()=>{if(!$('faith-form').hidden)renderPicker();});
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
    const boxes = previewTargets.filter(target=>!target.hidden&&(!target.classList.contains('place-label')||target.classList.contains('is-visible'))).map(target=>target.getBoundingClientRect());
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
    count.textContent = '信仰神明 · ' + names.length;
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
      if(record.deityLinks!==undefined){if(!Array.isArray(record.deityLinks)||record.deityLinks.length>100)throw Error('神明关联格式无效。');const links=new Set(),slots=new Set();for(const link of record.deityLinks){if(typeof link.id!=='string'||!link.id||link.id.length>120||links.has(link.id)||typeof link.deityId!=='string'||!link.deityId||link.deityId.length>120||!Number.isInteger(link.nameIndex)||link.nameIndex<0||link.nameIndex>=record.deities.length||slots.has(link.nameIndex))throw Error('神明关联无效。');links.add(link.id);slots.add(link.nameIndex);for(const [field,max] of Object.entries({localName:100,localTitle:200}))if(link[field]!==undefined&&(typeof link[field]!=='string'||link[field].length>max))throw Error('当地称谓或神函过长。');}}
      for (const [field,limit] of Object.entries(textLimits)) if (record[field] !== undefined && (typeof record[field] !== 'string' || record[field].length > limit)) throw Error('填写内容过长。');
      if (record.visitedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(record.visitedOn) || Number.isNaN(Date.parse(record.visitedOn)))) throw Error('走访日期无效。');
    }
    return {version:1,revision:document.revision,records:document.records};
  }
  function enable() {
    $('faith-add').disabled = !state || saving;
    $('faith-form').inert = saving;
    for (const id of ['faith-export-csv','faith-export-json','faith-import']) $(id).disabled = !state || saving;
    for (const node of [$('faith-list'),$('faith-notes')]) for (const button of node.querySelectorAll('button')) button.disabled = saving;
  }
  function closeForm() {
    $('faith-form').hidden = true;
    $('faith-form').reset();
    $('faith-more').open = false;
    editingId = null;
    dirty = false;
    choices=[];linkingIndex=null;$('faith-picked-list').replaceChildren();$('faith-deity-search').value='';$('faith-deity-results').replaceChildren();$('faith-picker-actions').hidden=true;$('faith-picker-status').textContent='';
  }
  function render() {
    const list = $('faith-list');
    list.replaceChildren();
    const notes = $('faith-notes');notes.replaceChildren();
    const records = state?.records.filter(sameVillage) || [];
    $('faith-section').hidden = !village;
    $('faith-title').textContent = '信仰神明';
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
      card.dataset.recordId=record.id;
      card.classList.toggle('is-record-target',record.id===highlightedRecordId);
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
      record.deities.forEach((name,index)=>{const li=document.createElement('li'),relation=record.deityLinks?.find(link=>link.nameIndex===index);if(relation){const link=document.createElement('a');link.href=A.profileURL(relation.deityId);link.textContent=relation.localName||name;link.title='查看神明档案'+(relation.localTitle?' · '+relation.localTitle:'');li.append(link);if(onExploreDeity){const explore=document.createElement('button');explore.type='button';explore.className='deity-distribution-link';explore.setAttribute('aria-label','在地图中查看'+(relation.localName||name)+'的分布');explore.title='在地图中查看分布';explore.textContent='分布';explore.addEventListener('click',()=>onExploreDeity(relation.deityId));li.append(explore);}}else{const label=document.createElement('span');label.className='legacy-deity';label.append(document.createTextNode(name));const pending=document.createElement('small');pending.textContent='待关联';label.append(pending);li.append(label);}names.append(li);});
      card.append(names);
      for (const content of [record.festival,[record.source,record.visitedOn].filter(Boolean).join(' · ')]) {
        if (!content) continue;
        const paragraph = document.createElement('p');
        paragraph.className = 'faith-note';
        paragraph.textContent = content;
        card.append(paragraph);
      }
      list.append(card);
      if (record.note?.trim()) {
        const article=document.createElement('article');article.className='field-note';
        const heading=document.createElement('div');heading.className='field-note-heading';
        if(record.temple){const title=document.createElement('h3');title.textContent=record.temple;heading.append(title);}
        const editNote=document.createElement('button');editNote.type='button';editNote.className='linkbutton';editNote.textContent='编辑';editNote.setAttribute('aria-label','编辑访谈笔记'+(record.temple?'：'+record.temple:''));
        editNote.addEventListener('click',()=>{if(mayLeave()){openForm(record);$('faith-more').open=true;$('faith-note').focus();}});heading.append(editNote);article.append(heading);
        const body=document.createElement('p');body.className='archive-prose';body.textContent=record.note;article.append(body);
        const context=[record.source,record.visitedOn].filter(Boolean).join(' · ');
        if(context){const source=document.createElement('p');source.className='field-note-source';source.textContent=context;article.append(source);}
        notes.append(article);
      }
    }
    focusPendingRecord();
    enable();
  }
  function focusPendingRecord(){
    if(!pendingRecordFocus)return;
    const card=[...$('faith-list').children].find(node=>node.dataset.recordId===highlightedRecordId);
    if(!card)return;pendingRecordFocus=false;card.classList.add('is-record-target');requestAnimationFrame(()=>{if(card.isConnected)card.scrollIntoView({block:'nearest'});});
  }
  function mayLeave() { return !saving&&!quickSaving&&!catalog.saving && (!(dirty||quickDirty) || window.confirm('信仰记录尚未保存。要放弃填写吗？')); }
  function openForm(record=null) {
    if (!village || !state || saving) return;
    closeForm();
    editingId = record?.id || null;
    $('faith-deities').value = record?.deities.join('\n') || '';
    choices=(record?.deities||[]).map((name,index)=>({name,link:record.deityLinks?.find(link=>link.nameIndex===index)?{...record.deityLinks.find(link=>link.nameIndex===index)}:null}));renderChoices();
    for (const field of fields) $('faith-' + field).value = record?.[field] || '';
    $('faith-delete').hidden = !editingId;
    $('faith-form').hidden = false;
    status('');
    $('faith-deity-search').focus();
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
        loadError='';
        render();
        changed();
        throw Error('另一页面已更新，填写内容仍保留，请再次保存。');
      }
      if (!response.ok) throw Error(result.error||'未能保存，请保留当前填写内容。');
      state = validate(result);
      loadError='';
      changed();
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
    const deities = choices.map(choice=>choice.name);
    if(!deities.length){status('请选择神明档案，或先仅记录名称。');$('faith-deity-search').focus();return;}
    const old = state.records.find(record=>record.id === editingId);
    const now = new Date().toISOString();
    const deityLinks=choices.flatMap((choice,nameIndex)=>choice.link?[{...choice.link,nameIndex}]:[]);
    const record = {...old,id:editingId || (crypto.randomUUID ? crypto.randomUUID() : 'faith-' + Date.now() + '-' + Math.random().toString(36).slice(2)),villageId:village.id,villageKind:village.kind,villageName:village.name,deities,deityLinks,createdAt:old?.createdAt || now,updatedAt:now};
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
    const rows = [['记录编号','村庄编号','村庄类型','村庄','神明','宫庙／供奉场所','祭期与活动','资料来源','走访日期','访谈笔记','创建时间','修改时间','关联编号','神明档案 ID','当地称谓','当地神函']];
    for (const record of state.records) record.deities.forEach((name,index)=>{const link=record.deityLinks?.find(link=>link.nameIndex===index);rows.push([record.id,record.villageId,record.villageKind,record.villageName,name,record.temple,record.festival,record.source,record.visitedOn,record.note,record.createdAt,record.updatedAt,link?.id,link?.deityId,link?.localName,link?.localTitle]);});
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
      loadError='';
      status('');
    } catch (error) { loadError=error.message;status(error.message); }
    render();
    changed();return state;
  }
  const ready=load();
  return {
    ready,get catalog(){return catalog;},get records(){return state?.records||null;},get error(){return loadError;},reload:load,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get dirty() { return dirty||quickDirty; },
    get saving() { return saving||quickSaving||catalog.saving; },
    mayLeave,
    bindPreview,
    dismissPreview,
    repositionPreview() { if (!preview.hidden) positionPreview(); },
    selectVillage(selected) { closeForm(); highlightedRecordId=null;pendingRecordFocus=false;village = selected; $('faith-section').hidden = false; render(); },
    focusRecord(id) { highlightedRecordId=id;pendingRecordFocus=true;focusPendingRecord(); },
    clearVillage() { closeForm(); highlightedRecordId=null;pendingRecordFocus=false;village = null; render(); },
    hasRecords(id,kind) { return !!state?.records.some(record=>record.villageId === id && record.villageKind === kind); },
    matches(id,kind,term) { return !!state?.records.some(record=>record.villageId === id && record.villageKind === kind && [...record.deities,record.temple].some(value=>value?.toLocaleLowerCase().includes(term))); }
  };
};
