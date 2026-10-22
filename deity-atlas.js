(() => {
  'use strict';
  const $=id=>document.getElementById(id), A=window.DeityAtlas, el=A.element;
  const catalog=A.createCatalog();
  const returnMap=new URLSearchParams(location.search).get('mapReturn')||'';
  if(returnMap)for(const link of document.querySelectorAll('.atlas-brand>a,.atlas-map-link'))link.href=A.exploreURL('',returnMap);
  let selected=new URLSearchParams(location.search).get('id'), filter='all', editing=null, fields=null, dirty=false, saving=false, faith=null, faithError='', titlesDirty=false;
  function mayLeave(){return !saving&&!catalog.saving&&(!dirty||window.confirm('神明档案尚未保存。要放弃填写吗？'));}
  function setURL(id,replace=false){history[replace?'replaceState':'pushState']({},'',id?A.profileURL(id,returnMap):'/deities'+(returnMap?'?mapReturn='+encodeURIComponent(returnMap):''));}
  function choose(id,replace=false){if(!mayLeave())return;selected=id;editing=null;dirty=false;setURL(id,replace);render();$('deity-detail').scrollTop=0;}
  function categoryName(){return filter==='all'?'全部神明':filter==='unclassified'?'待分类':filter==='archived'?'已归档':catalog.state?.titles.find(title=>title.id===filter)?.name||'全部神明';}
  function matchesFilter(record,key){return key==='archived'?!!record.archivedAt:!record.archivedAt&&(key==='all'||(key==='unclassified'?!record.titleIds.length:record.titleIds.includes(key)));}
  function renderNavigation(){
    const nav=$('deity-categories');nav.replaceChildren();
    const items=[{id:'all',name:'全部神明'},...(catalog.state?.titles||[]),{id:'unclassified',name:'待分类'},{id:'archived',name:'已归档'}];
    for(const item of items){const button=el('button','category-button');button.type='button';button.setAttribute('aria-current',String(filter===item.id));button.append(el('span','',item.name),el('span','',String(catalog.state?.records.filter(record=>matchesFilter(record,item.id)).length||0)));button.addEventListener('click',()=>{if(!mayLeave())return;filter=item.id;editing=null;dirty=false;selected=null;setURL(null);render();});nav.append(button);}
  }
  function renderList(){
    const term=$('deity-search').value.trim().toLocaleLowerCase();
    const records=(catalog.state?.records||[]).filter(record=>matchesFilter(record,filter)&&(!term||[record.name,...record.aliases].some(name=>name.toLocaleLowerCase().includes(term)))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
    $('deity-filter-name').textContent=categoryName();$('deity-list-count').textContent=records.length+' 份';$('deity-list').replaceChildren();
    for(const record of records){const button=el('button','deity-row');button.type='button';button.setAttribute('aria-current',String(record.id===selected));button.append(el('strong','',record.name));const titleNames=record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);button.append(el('small','',titleNames.join(' · ')||'待分类'));if(record.aliases.length)button.append(el('small','',record.aliases.join(' / ')));if(record.identityNote)button.append(el('small','',record.identityNote.length>80?record.identityNote.slice(0,80)+'…':record.identityNote));if(catalog.state.records.filter(item=>item.name===record.name).length>1)button.append(el('small','','档案 · '+record.id.slice(-8)));button.addEventListener('click',()=>choose(record.id));$('deity-list').append(button);}
    if(!records.length&&catalog.state)$('deity-list').append(el('p','atlas-list-empty',term?'没有匹配的名称或别名。':'暂无收录档案。'));
  }
  function section(title,content,empty='暂无收录内容'){
    const section=el('section','deity-section');section.append(el('h3','',title));section.append(el('p','archive-prose'+(content?'':' is-empty'),content||empty));return section;
  }
  function renderRecord(record){
    const node=$('deity-record');node.replaceChildren();
    const back=el('button','linkbutton deity-mobile-back','返回神明列表');back.type='button';back.addEventListener('click',()=>choose(null));node.append(back,el('span','atlas-eyebrow','神明档案 · DEITY RECORD'));
    const heading=el('div','deity-record-heading'),title=el('div');title.append(el('h2','',record.name));const badges=el('div','deity-badges');const titles=record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);for(const name of titles.length?titles:['待分类'])badges.append(el('span','deity-badge',name));if(record.archivedAt)badges.append(el('span','deity-badge','已归档'));title.append(badges);const edit=el('button','linkbutton','编辑档案');edit.type='button';edit.addEventListener('click',()=>startEdit(record));heading.append(title,edit);node.append(heading);
    const distribution=el('a','deity-map-distribution','在地图中查看分布 ↗');distribution.href=A.exploreURL(record.id,returnMap);node.append(distribution);
    if(record.aliases.length)node.append(section('别名与地方称谓',record.aliases.join('、')));
    node.append(section('神明简介',record.description),section('身份差异与争议说明',record.identityNote));
    const relations=el('section','deity-section'),villages=faith?A.villagesFor(record.id,faith.records):[];
    const count=faith?' · '+villages.length+' 个村庄 · '+villages.reduce((n,village)=>n+village.records.length,0)+' 条记录':'';
    relations.append(el('h3','','关联村庄'+count));
    if(!faith)relations.append(el('p','note',faithError||'正在读取关联记录…'));
    else if(!villages.length)relations.append(el('p','archive-prose is-empty','暂无关联的村庄记录。'));
    for(const village of villages){const article=el('article','village-relation'),heading=el('div','village-relation-heading'),link=el('a','',village.name);link.href=A.mapURL(village.kind,village.id);heading.append(link,el('span','',village.records.length+' 条记录'));article.append(heading);
      for(const {record:entry,links} of village.records){const body=el('div','relation-record');for(const relation of links){body.append(el('p','','当地称谓：'+(relation.localName||entry.deities[relation.nameIndex])));if(relation.localTitle)body.append(el('p','','当地神函：'+relation.localTitle));}if(entry.temple)body.append(el('p','','宫庙：'+entry.temple));if(entry.festival)body.append(el('p','','祭期：'+entry.festival));if(entry.source||entry.visitedOn)body.append(el('p','', [entry.source,entry.visitedOn].filter(Boolean).join(' · ')));const go=el('a','','地图中查看记录');go.href=A.mapURL(village.kind,village.id,entry.id);body.append(go,el('p','deity-identity','记录 ID · '+entry.id));article.append(body);}relations.append(article);}
    node.append(relations,section('资料来源',record.source,'暂无来源资料'));
    const meta=el('p','deity-identity','档案 ID · '+record.id+'\n创建 '+record.createdAt+'\n更新 '+record.updatedAt);meta.style.whiteSpace='pre-wrap';node.append(meta);
    const actions=el('div','deity-footer-actions'),archive=el('button','linkbutton',record.archivedAt?'恢复档案':'归档');archive.type='button';archive.addEventListener('click',async()=>{if(!mayLeave()||!window.confirm(record.archivedAt?'恢复这份神明档案？':'归档后从默认列表隐藏，已有村庄关联仍保留。继续吗？'))return;archive.disabled=true;try{await catalog.saveRecord({...record,archivedAt:record.archivedAt?'':new Date().toISOString()});}catch(error){$('deity-status').textContent=error.message;archive.disabled=false;}});actions.append(archive);node.append(actions);
  }
  function render(){
    renderNavigation();renderList();
    $('deity-form').hidden=!editing;$('deity-record').hidden=!!editing||!selected;$('deity-placeholder').hidden=!!editing||!!selected;document.querySelector('.deity-layout').classList.toggle('has-selection',!!editing||!!selected);
    if(!editing&&selected){const record=catalog.get(selected);if(record)renderRecord(record);else{$('deity-record').replaceChildren(el('p','note','未找到这份神明档案。'));const back=el('button','linkbutton deity-mobile-back','返回神明列表');back.type='button';back.addEventListener('click',()=>choose(null));$('deity-record').prepend(back);}}
  }
  function startEdit(record=null){if(!mayLeave()||!catalog.state)return;editing={record};dirty=false;$('deity-form-heading').textContent=record?'编辑神明档案':'新增神明';$('deity-form-status').textContent='';fields=A.createFields($('deity-fields'),catalog,record||{});render();$('deity-detail').scrollTop=0;fields.focus();}
  $('deity-new').addEventListener('click',()=>startEdit());$('deity-search').addEventListener('input',renderList);
  $('deity-form').addEventListener('input',()=>{dirty=true;});
  $('deity-form').addEventListener('submit',async event=>{event.preventDefault();if(saving||!editing||!$('deity-form').reportValidity())return;saving=true;$('deity-form').inert=true;$('deity-form-status').textContent='保存中…';try{const record=await catalog.saveRecord({...editing.record,...fields.read()});selected=record.id;editing=null;dirty=false;filter=record.archivedAt?'archived':'all';$('deity-search').value='';setURL(selected);render();}catch(error){$('deity-form-status').textContent=error.message;}finally{saving=false;$('deity-form').inert=false;}});
  $('deity-cancel').addEventListener('click',()=>{if(!mayLeave())return;editing=null;dirty=false;render();});
  catalog.subscribe(render);
  catalog.ready.then(()=>{for(const id of ['deity-new','deity-titles-edit','deity-export','deity-import'])$(id).disabled=false;$('deity-status').textContent='';render();}).catch(error=>{$('deity-status').textContent=error.message;});
  async function loadFaith(){try{const response=await fetch('/api/faith',{cache:'no-store'});if(!response.ok)throw Error();const result=await response.json();if(result.version!==1||!Array.isArray(result.records))throw Error();faith=result;}catch{faithError='关联资料暂未读取，请刷新重试。';}if(catalog.state)render();}
  loadFaith();
  window.addEventListener('popstate',()=>{if(!mayLeave()){setURL(selected);return;}editing=null;dirty=false;selected=new URLSearchParams(location.search).get('id');render();});
  window.addEventListener('beforeunload',event=>{if(dirty||titlesDirty||saving||catalog.saving){event.preventDefault();event.returnValue='';}});
  const titleDialog=$('deity-titles-dialog');
  $('deity-titles-edit').addEventListener('click',()=>{if(!mayLeave()||!catalog.state)return;$('deity-title-fields').replaceChildren();for(const title of catalog.state.titles){const row=el('div','title-index-row'),input=el('input');input.value=title.name;input.maxLength=80;input.required=true;input.dataset.titleId=title.id;input.setAttribute('aria-label','神函名称 '+title.name);input.readOnly=['hui-zhu','jing-zhu','jun-zhu','ying-zhu','bu-zhu','fu-zhu','he-zhu','an-zhu'].includes(title.id);row.append(input);$('deity-title-fields').append(row);}$('deity-title-new').value='';$('deity-titles-status').textContent='';titlesDirty=false;titleDialog.showModal();});
  $('deity-titles-form').addEventListener('input',()=>{titlesDirty=true;});
  function cancelTitles(event){if(catalog.saving||(titlesDirty&&!window.confirm('神函修改尚未保存。要放弃填写吗？'))){event?.preventDefault();return;}titlesDirty=false;titleDialog.close();}
  $('deity-titles-cancel').addEventListener('click',cancelTitles);titleDialog.addEventListener('cancel',cancelTitles);
  $('deity-titles-form').addEventListener('submit',async event=>{event.preventDefault();if(catalog.saving)return;const titles=[...$('deity-title-fields').querySelectorAll('input')].map(input=>({id:input.dataset.titleId,name:input.value.trim()}));if($('deity-title-new').value.trim())titles.push({id:A.uid(),name:$('deity-title-new').value.trim()});$('deity-titles-form').inert=true;try{await catalog.saveTitles(titles);titlesDirty=false;titleDialog.close();}catch(error){$('deity-titles-status').textContent=error.message;}finally{$('deity-titles-form').inert=false;}});
  $('deity-export').addEventListener('click',()=>{if(!catalog.state)return;const url=URL.createObjectURL(new Blob([JSON.stringify(catalog.state,null,2)],{type:'application/json;charset=utf-8'})),link=el('a');link.href=url;link.download='硇洲岛神明谱系-'+new Date().toLocaleDateString('sv-SE')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);});
  $('deity-import').addEventListener('click',()=>{if(mayLeave())$('deity-import-file').click();});
  $('deity-import-file').addEventListener('change',async()=>{const file=$('deity-import-file').files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('备份超过 5 MB。');await catalog.importCatalog(JSON.parse(await file.text()));$('deity-status').textContent='已导入；同编号现有档案保留。';}catch(error){$('deity-status').textContent=error.message;}finally{$('deity-import-file').value='';}});
})();
