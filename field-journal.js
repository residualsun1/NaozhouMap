/* Independent, permission-filtered journal entries; legacy notes stay in their original files. */
window.createFieldJournal = options => {
  'use strict';
  const $ = id => document.getElementById(id);
  const types = {observation:'走访观察',interview:'访谈',ritual:'仪式记录',research:'研究札记',other:'其他'};
  const form = $('journal-form'), timeline = $('journal-timeline');
  const confirmation=$('journal-confirm');let finishConfirmation=null;
  confirmation.addEventListener('close',()=>{finishConfirmation?.(confirmation.returnValue==='confirm');finishConfirmation=null;});
  function confirmAction(message,label){
    if(confirmation.open)return Promise.resolve(false);
    $('journal-confirm-message').textContent=message;$('journal-confirm-accept').textContent=label;confirmation.returnValue='';confirmation.showModal();$('journal-confirm-cancel').focus();
    return new Promise(resolve=>{finishConfirmation=resolve;});
  }
  let place=null,state=null,legacy=null,legacyInput=null,editing=null,draftId=null,dirty=false,saving=false,loading=false,loadId=0,legacyId=0,openedId=null,pendingEntry=null,loadError='';
  const peoplePicker=window.createJournalPeople($('journal-people-picker'),options.peopleCatalog,()=>{dirty=true;});
  const placeKey = () => place ? place.kind+':'+place.id : '';
  const request = (...args) => (window.NaozhouCloud?.request || fetch)(...args);
  const endpoint = () => './api/field-entries?'+new URLSearchParams({placeId:place.id,placeKind:place.kind});
  const element = (tag,className='',text='') => {const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
  function validate(document) {
    if (document?.version!==1 || typeof document.editable!=='boolean' || (document.editable && !Number.isInteger(document.revision)) || !Array.isArray(document.records) || document.records.some(record=>typeof record.id!=='string'||typeof record.content!=='string'||typeof record.title!=='string')) throw Error('日志数据格式无效，请保留填写内容。');
    return document;
  }
  function entries() {
    const records=(state?.records || []).filter(record=>place && record.placeId===place.id && record.placeKind===place.kind);
    if (legacy && !records.some(record=>record.legacyKey===legacy.legacyKey)) records.push(legacy);
    return records.sort((a,b)=>(b.observedAt||'').localeCompare(a.observedAt||'') || (a.createdAt||'').localeCompare(b.createdAt||'') || a.id.localeCompare(b.id));
  }
  function enable() {
    $('journal-add').disabled=!place||!state||loading||saving;
    form.inert=saving;
    $('journal-filters').hidden=!form.hidden;
    timeline.hidden=!form.hidden;
    for (const button of timeline.querySelectorAll('button')) button.disabled=saving;
  }
  function dateLabel(record) {
    if (!record.observedAt) return record.legacy?'日期未注明':record.originalDateText||'日期待考';
    if (record.datePrecision==='year') return record.observedAt+' 年';
    if (record.datePrecision==='month') return record.observedAt.replace('-',' 年 ')+' 月';
    return record.observedAt.replaceAll('-','.');
  }
  function fullRecord(record) {
    const body=element('div','journal-full');
    body.append(element('p','journal-content',record.content));
    if (record.originalDateText && record.observedAt) body.append(element('p','journal-source','原始时间表述：'+record.originalDateText));
    if (record.source) body.append(element('p','journal-source','来源：'+record.source));
    if (record.deityIds?.length) {
      const links=element('div','journal-deities');links.append(element('span','','关联神明'));
      for (const id of record.deityIds) {const link=element('a','',options.catalog?.get(id)?.name||'神明档案');link.href=window.DeityAtlas.profileURL(id);links.append(link);}
      body.append(links);
    }
    if(record.peopleLinks?.length){
      const group=element('div','journal-related-people');group.append(element('h4','','相关人物'));
      for(const relation of record.peopleLinks){
        const row=element('div','journal-person-reading'),link=element('a','',options.peopleCatalog.get(relation.personId)?.displayName||'人物档案');link.href=window.PeopleArchive.profileURL(relation.personId);
        row.append(link,element('span','journal-source',' · '+relation.roleInEntry));
        for(const [field,label] of [['notes','关联说明'],['narratedAt','讲述时间'],['eventDateText','所述事件时间'],['narrativeSource','叙述来源']])if(relation[field])row.append(element('p','journal-source',label+'：'+relation[field]));
        group.append(row);
      }
      body.append(group);
    }
    if (record.createdAt) body.append(element('p','journal-source','录入：'+record.createdAt.slice(0,10)+(record.updatedAt!==record.createdAt?' · 更新：'+record.updatedAt.slice(0,10):'')));
    if (state?.editable && !record.legacy) {
      const actions=element('div','journal-actions');
      const remove=element('button','linkbutton','删除');remove.type='button';remove.setAttribute('aria-label','删除日志：'+record.title);remove.addEventListener('click',()=>removeEntry(record));actions.append(remove);
      body.append(actions);
    }
    return body;
  }
  function timelineItem(record) {
    const item=element('article','journal-entry'),details=element('details','journal-record'),summary=element('summary','journal-summary');
    item.dataset.entryId=record.id;
    const header=element('div','journal-entry-header');
    const meta=element('div','journal-entry-meta');meta.append(element('span','journal-date',dateLabel(record)),element('span','journal-kind',record.legacy?'历史笔记':types[record.recordType]||'其他'));
    if (state?.editable && !record.legacy) meta.append(element('span','journal-visibility',record.visibility==='public'?'公开':'仅编辑者'));
    const edit=element('button','linkbutton journal-edit','编辑');edit.type='button';edit.setAttribute('aria-label',(record.legacy?'编辑历史笔记':'编辑日志')+'：'+record.title);edit.title=state?.editable?'修改日期、标题和正文':'登录后修改日期、标题和正文';edit.addEventListener('click',()=>openForm(record));
    header.append(meta,edit);item.append(header);
    summary.append(element('h3','journal-entry-title',record.title),element('p','journal-excerpt',record.content.length>130?record.content.slice(0,130)+'…':record.content));
    if (record.tags?.length) {const tags=element('div','journal-tags');for(const tag of record.tags)tags.append(element('span','',tag));summary.append(tags);}
    if (record.attachments?.length) summary.append(element('span','journal-source',record.attachments.length+' 个附件'));
    const read=element('span','journal-read-label','查看完整记录');summary.append(read);details.append(summary);item.append(details);
    let built=false;
    const build=()=>{if(!built){details.append(fullRecord(record));built=true;}};
    details.addEventListener('toggle',()=>{
      read.textContent=details.open?'收起记录':'查看完整记录';
      if (details.open) {openedId=record.id;build();for(const other of timeline.querySelectorAll('details[open]'))if(other!==details)other.open=false;}
      else if(openedId===record.id)openedId=null;
    });
    if (openedId===record.id) {build();details.open=true;read.textContent='收起记录';}
    return item;
  }
  function render() {
    const all=entries(),year=$('journal-year').value||'all',type=$('journal-type').value;
    const years=[...new Set(all.filter(record=>record.observedAt).map(record=>record.observedAt.slice(0,4)))].sort().reverse();
    $('journal-year').replaceChildren(new Option('全部年份','all'),...years.map(value=>new Option(value+' 年',value)),new Option('日期待考','unknown'));
    $('journal-year').value=year==='all'||year==='unknown'||years.includes(year)?year:'all';
    const selectedYear=$('journal-year').value;
    const filtered=all.filter(record=>(type==='all'||record.recordType===type) && (selectedYear==='all'||(selectedYear==='unknown'?!record.observedAt:record.observedAt?.startsWith(selectedYear))));
    $('journal-count').textContent=state?'共 '+all.length+' 条记录':legacy?'1 条历史笔记':'';
    timeline.replaceChildren();
    for(const pending of [false,true]) {
      const records=filtered.filter(record=>!record.observedAt===pending);if(!records.length)continue;
      if(pending)timeline.append(element('h3','journal-pending-title','日期待考'));
      const list=element('div','journal-entries');for(const record of records)list.append(timelineItem(record));timeline.append(list);
    }
    if(!filtered.length)timeline.append(element('p','note',loading?'正在读取日志…':loadError?'日志尚未读取。':all.length?'没有符合筛选条件的记录。':'暂无田野日志'));
    $('journal-retry').hidden=!loadError;
    if(loadError)$('journal-status').textContent=loadError;
    enable();
    if(pendingEntry){const target=[...timeline.querySelectorAll('.journal-entry')].find(item=>item.dataset.entryId===pendingEntry);if(target){pendingEntry=null;requestAnimationFrame(()=>{if(target.isConnected)target.scrollIntoView({block:'start'});});}}
  }
  async function load() {
    if(!place)return;
    const sequence=++loadId;loading=true;loadError='';$('journal-status').textContent='';enable();
    try {
      const response=await request(endpoint(),{cache:'no-store'}),result=await response.json();
      if(!response.ok)throw Error(result.error||'日志未能读取，请重试。');
      if(sequence===loadId)state=validate(result);
    } catch(error) {if(sequence===loadId)loadError=error.message;}
    finally {if(sequence===loadId){loading=false;render();}}
  }
  function closeForm() {form.hidden=true;form.reset();peoplePicker.set();editing=null;draftId=null;dirty=false;$('journal-form-status').textContent='';render();}
  function mayLeave() {return !saving && (!dirty || window.confirm('田野日志尚未保存。要放弃填写吗？'));}
  function syncDateInput(value=$('journal-observed').value) {
    const precision=$('journal-precision').value,input=$('journal-observed');
    input.disabled=precision==='unknown';input.required=precision!=='unknown';input.removeAttribute('pattern');input.removeAttribute('min');input.removeAttribute('max');input.removeAttribute('inputmode');
    input.type=precision==='day'?'date':precision==='month'?'month':'text';
    if(precision==='year'){input.inputMode='numeric';input.pattern='[0-9]{4}';input.maxLength=4;input.placeholder='如：2026';}
    else if(precision!=='unknown'){input.min=precision==='day'?'0001-01-01':'0001-01';input.max=precision==='day'?'9999-12-31':'9999-12';}
    input.value=precision==='unknown'?'':precision==='day'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:precision==='month'&&/^\d{4}-\d{2}/.test(value)?value.slice(0,7):precision==='year'&&/^\d{4}/.test(value)?value.slice(0,4):'';
  }
  async function openForm(record=null) {
    if(!place||!state||saving||options.beforeEdit?.()===false)return;
    if(dirty&&!await confirmAction('当前田野日志尚未保存。要放弃填写吗？','放弃填写'))return;
    const selected=placeKey();
    if(window.NaozhouCloud && !await window.NaozhouCloud.requireEditor())return;
    if(placeKey()!==selected)return;
    if(!state?.editable){await load();if(!state?.editable||placeKey()!==selected)return;}
    if(record&&!record.legacy){record=state.records.find(item=>item.id===record.id);if(!record){$('journal-status').textContent='记录已更新，请重新打开。';return;}}
    if(!options.peopleCatalog.state?.editable)await options.peopleCatalog.load().catch(()=>{});
    if(placeKey()!==selected)return;
    editing=record?{...record,tags:[...(record.tags||[])]}:null;draftId=record&&!record.legacy?record.id:crypto.randomUUID();form.reset();
    $('journal-form-title').textContent=record?.legacy?'编辑历史笔记':record?'编辑记录':'新增记录';
    for(const [id,value] of Object.entries({title:record?.legacy?'历史笔记':record?.title||'',content:record?.content||'',precision:record?.datePrecision||'unknown','original-date':record?.originalDateText||'','record-type':record?.recordType||'observation',tags:record?.tags?.join('，')||'',source:record?.source||'',visibility:record?.legacy?'editors':record?.visibility||'editors'}))$('journal-'+id).value=value;
    peoplePicker.set(record?.peopleLinks||[]);syncDateInput(record?.observedAt||'');form.hidden=false;dirty=false;$('journal-form-status').textContent='';render();options.onFormOpen?.();$('journal-title').focus({preventScroll:true});form.scrollIntoView({block:'start'});
  }
  async function mutate(body) {
    saving=true;enable();
    try {
      const response=await request(endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,revision:state.revision,...body})}),result=await response.json();
      if(response.status===409){state=validate(result);render();throw Error(result.error||'日志已更新，填写内容仍保留。');}
      if(!response.ok)throw Error(result.error||'未能保存，填写内容仍保留。');
      state=validate(result);return true;
    } finally {saving=false;enable();}
  }
  async function removeEntry(record) {
    if(saving||!state?.editable||!mayLeave())return;
    if(!await confirmAction('删除「'+record.title+'」？此操作无法撤销。'+(record.legacyKey?'原历史笔记字段仍会保留。':''),'确认删除'))return;
    try {await mutate({action:'delete',id:record.id,baseUpdatedAt:record.updatedAt,confirmDelete:true});openedId=null;render();$('journal-status').textContent='已删除记录。';}
    catch(error){$('journal-status').textContent=error.message;}
  }
  form.addEventListener('input',()=>{dirty=true;$('journal-form-status').textContent='';});
  form.addEventListener('change',()=>{dirty=true;});
  $('journal-precision').addEventListener('change',()=>syncDateInput());
  $('journal-add').addEventListener('click',()=>openForm());
  $('journal-cancel').addEventListener('click',async()=>{if(!saving&&(!dirty||await confirmAction('当前田野日志尚未保存。要放弃填写吗？','放弃填写')))closeForm();});
  for(const id of ['journal-year','journal-type'])$(id).addEventListener('change',render);
  $('journal-retry').addEventListener('click',load);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!place||!state||saving||!form.reportValidity())return;
    const visibility=$('journal-visibility').value;
    const peopleLinks=peoplePicker.read();
    const confirmPublic=visibility==='public' && (editing?.visibility!=='public'||peopleLinks.some(link=>link.public&&!editing?.peopleLinks?.some(old=>old.personId===link.personId&&old.roleInEntry===link.roleInEntry&&old.public)));
    if(confirmPublic && !await confirmAction('将这条日志及允许公开的人物关联展示到网站？请确认正文、来源与人物关系已适合公开。','确认公开'))return;
    const record={id:draftId,placeId:place.id,placeKind:place.kind,title:$('journal-title').value.trim(),content:$('journal-content').value.trim(),observedAt:$('journal-observed').value,datePrecision:$('journal-precision').value,originalDateText:$('journal-original-date').value.trim(),recordType:$('journal-record-type').value,tags:$('journal-tags').value.split(/[,，、\n]/).map(value=>value.trim()).filter(Boolean),source:$('journal-source').value.trim(),visibility,deityIds:editing?.deityIds||[],legacyKey:editing?.legacyKey||''};
    record.peopleLinks=peopleLinks;
    $('journal-form-status').textContent='保存中…';
    try {await mutate({action:'save',record,baseUpdatedAt:editing&&!editing.legacy?editing.updatedAt:null,confirmPublic});openedId=record.id;$('journal-year').value='all';$('journal-type').value='all';closeForm();$('journal-status').textContent='已保存 · '+(visibility==='public'?'公开记录':'仅编辑者可见');$('journal-add').focus({preventScroll:true});}
    catch(error){$('journal-form-status').textContent=error.message;}
  });
  document.addEventListener('naozhou-before-logout',event=>{if(!mayLeave())event.preventDefault();});
  document.addEventListener('naozhou-access-change',event=>{
    if(!place)return;
    if(!event.detail.editable){state=null;if(event.detail.reason==='logout'){closeForm();openedId=null;}}
    load();
  });
  options.catalog?.subscribe(()=>{if(place&&form.hidden)render();});
  options.peopleCatalog.subscribe(()=>{if(place&&form.hidden)render();});
  return {
    get dirty(){return dirty;},get saving(){return saving;},mayLeave,
    focusEntry(id){if(!id)return;pendingEntry=openedId=id;$('journal-year').value='all';$('journal-type').value='all';render();},
    selectPlace(selected){++loadId;++legacyId;place=selected;state=null;legacy=null;legacyInput=null;loading=false;loadError='';openedId=null;pendingEntry=null;$('journal-year').value='all';$('journal-type').value='all';closeForm();if(place)load();},
    async setLegacy(value){
      if(!place||!value?.content){++legacyId;legacy=null;legacyInput=null;render();return;}
      if(legacyInput===value.content)return;legacyInput=value.content;
      const sequence=++legacyId,selected=placeKey();
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.content));
      if(sequence!==legacyId||selected!==placeKey())return;
      const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      legacy={id:'legacy-'+hash,placeId:place.id,placeKind:place.kind,title:'历史笔记',content:value.content,observedAt:'',datePrecision:'unknown',originalDateText:'',recordType:'other',tags:[],source:value.source,legacyKey:selected+':'+hash,legacy:true};render();
    }
  };
};
