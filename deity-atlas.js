(() => {
  'use strict';
  const $=id=>document.getElementById(id), A=window.DeityAtlas, el=A.element;
  const query=new URLSearchParams(location.search), returnMap=query.get('mapReturn')||'';
  const rituals=window.RitualAtlas;
  const atlasURL='/deities'+(returnMap?'?mapReturn='+encodeURIComponent(returnMap):'');
  $('deity-view-link').href=atlasURL;
  $('ritual-view-link').href=rituals.url('',returnMap);
  if(returnMap)for(const link of document.querySelectorAll('.atlas-brand>a,.atlas-map-link'))link.href=A.exploreURL('',returnMap);
  if(query.get('view')==='rituals'){
    $('deity-view-link').removeAttribute('aria-current');
    $('ritual-view-link').setAttribute('aria-current','page');
    document.querySelector('.deity-layout').hidden=true;
    $('deity-new').hidden=true;
    $('ritual-workspace').hidden=false;
    $('ritual-auth-slot').append($('cloud-access'));
    rituals.mount(A.createCatalog(),returnMap);
    return;
  }
  const catalog=A.createCatalog({archive:true});
  const observances=window.DeityObservances;
  const villageLinks=window.DeityVillageLinks.createPanel({beforeOpen:mayLeave,onSaved:async()=>{if(!await loadFaith())throw Error('关联列表暂未刷新。');}});
  const worshipEditor=window.createWorshipEditor({beforeOpen:mayLeave,onSaved:loadFaith});
  let selected=query.get('id'), filter='all', editing=null, fields=null, readObservances=null, dirty=false, saving=false, faith=null, faithError='', titlesDirty=false;
  window.ArchiveLayout.mount(document.querySelector('.deity-layout'));
  const canEdit=()=>catalog.state?.editable===true;
  function mayLeave(){return !saving&&!catalog.saving&&worshipEditor.mayLeave()&&villageLinks.mayLeave()&&(!dirty||window.confirm('神明档案尚未保存。要放弃填写吗？'));}
  function setURL(id,replace=false){history[replace?'replaceState':'pushState']({},'',id?A.profileURL(id,returnMap):atlasURL);}
  function clearEdit(){
    fields?.destroy();
    $('deity-fields').replaceChildren();
    $('deity-observance-fields').replaceChildren();
    fields=readObservances=editing=null;
    dirty=false;
  }
  function choose(id,replace=false){if(!mayLeave())return;selected=id;clearEdit();setURL(id,replace);render();$('deity-detail').scrollTop=0;}
  function categoryName(){return filter==='all'?'全部神明':filter==='unclassified'?'待分类':filter==='archived'?'已归档':catalog.state?.titles.find(title=>title.id===filter)?.name||'全部神明';}
  function matchesFilter(record,key){return !record.mergedInto&&(key==='archived'?!!record.archivedAt:!record.archivedAt&&(key==='all'||(key==='unclassified'?!record.titleIds.length:record.titleIds.includes(key))));}
  function renderNavigation(){
    const nav=$('deity-categories');nav.replaceChildren();
    const items=[{id:'all',name:'全部神明'},...(catalog.state?.titles||[]),{id:'unclassified',name:'待分类'},{id:'archived',name:'已归档'}];
    for(const item of items){const button=el('button','category-button');button.type='button';button.setAttribute('aria-current',String(filter===item.id));button.append(el('span','',item.name),el('span','',String(catalog.state?.records.filter(record=>matchesFilter(record,item.id)).length||0)));button.addEventListener('click',()=>{if(!mayLeave())return;filter=item.id;clearEdit();selected=null;setURL(null);render();});nav.append(button);}
  }
  function renderList(){
    const term=$('deity-search').value.trim().toLocaleLowerCase();
    const records=(catalog.state?.records||[]).filter(record=>matchesFilter(record,filter)&&(!term||[record.name,...record.aliases].some(name=>name.toLocaleLowerCase().includes(term)))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
    $('deity-filter-name').textContent=categoryName();$('deity-list-count').textContent=records.length+' 份';$('deity-list').replaceChildren();
    for(const record of records){const button=el('button','deity-row');button.type='button';button.setAttribute('aria-current',String(record.id===selected));button.append(el('strong','',record.name));const titleNames=record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);button.append(el('small','',titleNames.join(' · ')||'待分类'));if(record.aliases.length)button.append(el('small','',record.aliases.join(' / ')));if(record.identityNote)button.append(el('small','',record.identityNote.length>80?record.identityNote.slice(0,80)+'…':record.identityNote));else if(record.description&&catalog.state.records.filter(item=>item.name===record.name).length>1)button.append(el('small','',record.description.slice(0,80)));button.addEventListener('click',()=>choose(record.id));$('deity-list').append(button);}
    if(!records.length&&catalog.state)$('deity-list').append(el('p','atlas-list-empty',term?'没有匹配的名称或别名。':'暂无收录档案。'));
  }
  function section(title,content,empty='暂无收录内容'){
    const section=el('section','deity-section');section.append(el('h3','',title));section.append(el('p','archive-prose'+(content?'':' is-empty'),content||empty));return section;
  }
  function localName(entry,link,deity){
    const recorded=entry.deities[link.nameIndex]||'';
    return link.localName?.trim()||(recorded!==deity.name?recorded:'');
  }
  function villageRecords(village,deity,editable){
    const details=el('details','village-records');details.dataset.villageKey=village.key;
    details.append(el('summary','',village.records.length>1?village.records.length+' 条供奉记录':editable?'供奉记录与编辑':'查看供奉记录'));
    village.records.forEach(({record:entry,links},index)=>{
      const body=el('div','relation-record');
      if(village.records.length>1)body.append(el('h4','','供奉记录 '+(index+1)));
      for(const relation of links){
        const name=localName(entry,relation,deity);if(name)body.append(el('p','','当地称谓：'+name));
        if(relation.localTitle)body.append(el('p','','当地神函：'+relation.localTitle));
        if(window.FaithWorship.info(relation).worship_scope!=='unknown')body.append(el('p','worship-description',window.FaithWorship.description(relation)));
        if(editable){
          const edit=el('button','linkbutton','编辑供奉信息');edit.type='button';edit.dataset.worshipLink=relation.id;
          edit.addEventListener('click',()=>worshipEditor.open({recordId:entry.id,linkId:relation.id,deityId:deity.id,villageId:village.id,villageKind:village.kind,deityName:deity.name,villageName:village.name,recordLabel:[entry.temple,entry.visitedOn].filter(Boolean).join(' · ')||'供奉记录 '+(index+1)}));
          body.append(edit);
        }
      }
      for(const [field,label] of [['temple','宫庙'],['festival','祭期'],['source','资料来源'],['visitedOn','走访日期']])if(entry[field])body.append(el('p','',label+'：'+entry[field]));
      const go=el('a','','查看村庄信仰记录 ↗');go.href=A.mapURL(village.kind,village.id,entry.id);body.append(go);details.append(body);
    });
    return details;
  }
  function villageIndexRow(village,deity){
    const article=el('article','village-relation'),heading=el('div','village-relation-heading'),link=el('a','',village.name);
    link.href=A.mapURL(village.kind,village.id);link.setAttribute('aria-label','查看'+village.name+'档案');link.append(el('span','village-record-arrow','↗'));heading.append(link);article.append(heading);
    const place=village.kind==='reference'?villageLinks.place(village.id):null,area=place&&villageLinks.area(place.administrativeAreaId);
    const kindName=village.kind==='survey'?'调查点位':({natural_village:'自然村',administrative_seat:'行政驻地',locality:'聚居点'}[place?.placeKind]||'参考地点');
    article.append(el('p','village-relation-meta',[kindName,area?.committeeName].filter(Boolean).join(' · ')));
    const names=new Set(),surnames=new Set();
    for(const {record:entry,links} of village.records)for(const relation of links){
      const name=localName(entry,relation,deity);if(name)names.add(name);
      const info=window.FaithWorship.info(relation);if(info.worship_scope==='specific_surname')surnames.add(info.worship_surname);
    }
    if(names.size)article.append(el('p','village-relation-summary','当地称谓：'+[...names].join('、')));
    if(surnames.size)article.append(el('p','village-relation-summary','供奉姓氏：'+[...surnames].map(name=>name+'姓').join('、')));
    article.dataset.searchText=[village.name,...(place?.aliases||[]),area?.committeeName||''].join(' ').toLocaleLowerCase();
    article.append(villageRecords(village,deity,canEdit()));return article;
  }
  function renderRecord(record){
    const node=$('deity-record');node.replaceChildren();node.dataset.recordId=record.id;
    const back=el('button','linkbutton deity-mobile-back','返回神明列表');back.type='button';back.addEventListener('click',()=>choose(null));node.append(back,el('span','atlas-eyebrow','神明档案 · DEITY RECORD'));
    const heading=el('div','deity-record-heading'),title=el('div');title.append(el('h2','',record.name));const badges=el('div','deity-badges');const titles=record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);for(const name of titles.length?titles:['待分类'])badges.append(el('span','deity-badge',name));if(record.archivedAt)badges.append(el('span','deity-badge','已归档'));title.append(badges);const edit=el('button','linkbutton','编辑档案');edit.type='button';edit.addEventListener('click',()=>startEdit(record));heading.append(title);if(canEdit())heading.append(edit);node.append(heading);
    const distribution=el('a','deity-map-distribution','在地图中查看分布 ↗');distribution.href=A.exploreURL(record.id,returnMap);node.append(distribution);
    if(record.aliases.length)node.append(section('别名与地方称谓',record.aliases.join('、')));
    node.append(section('神明简介',record.description),section('身份差异与争议说明',record.identityNote));
    observances.render(node,record);
    const related=el('div');
    node.append(related);
    rituals.renderRelated(related,record.id,returnMap);
    const relations=el('section','deity-section'),villages=faith?A.villagesFor(record.id,faith.records):[];
    const relationsHeading=el('div','deity-relations-heading'),relationsTitle=el('h3','','关联村庄');
    if(faith)relationsTitle.append(el('span','deity-relation-count',villages.length+' 个村庄'));relationsHeading.append(relationsTitle);
    if(!record.archivedAt&&canEdit()){const add=el('button','linkbutton','＋ 关联村庄');add.type='button';add.dataset.linkVillages='';add.addEventListener('click',()=>villageLinks.open(record));relationsHeading.append(add);}
    relations.append(relationsHeading);
    let search=null;
    if(villages.length){const label=el('div','deity-relations-search');search=el('input');search.type='search';search.setAttribute('aria-label','检索已关联村庄');search.placeholder='检索村庄或行政归属';search.maxLength=100;label.append(search);relations.append(label);}
    if(!faith&&!faithError)relations.append(el('p','note','正在读取关联记录…'));
    else if(faith&&!villages.length)relations.append(el('p','archive-prose is-empty','暂无关联的村庄记录。'));
    if(faithError){const retry=el('button','linkbutton','重新读取关联村庄');retry.type='button';retry.addEventListener('click',loadFaith);relations.append(el('p','note',faithError),retry);}
    for(const village of villages)relations.append(villageIndexRow(village,record));
    if(search){const empty=el('p','archive-prose is-empty','没有符合检索条件的关联村庄。');empty.hidden=true;relations.append(empty);search.addEventListener('input',()=>{const term=search.value.trim().toLocaleLowerCase();let visible=0;for(const article of relations.querySelectorAll('.village-relation')){article.hidden=!article.dataset.searchText.includes(term);if(!article.hidden)visible++;}empty.hidden=visible>0;});}
    node.append(relations,section('资料来源',record.source,'暂无来源资料'));
    if(record.updatedAt)node.append(el('p','deity-identity','最近更新 '+record.updatedAt.slice(0,10)));
    window.ArchiveManagement?.mount(node,{entity:'deities',record,catalog,beforeOpen:mayLeave,onChange:async result=>{selected=result.deleted?null:result.recordId||record.id;filter=selected&&catalog.get(selected)?.archivedAt?'archived':'all';faith=null;await loadFaith();setURL(selected,true);render();}});
  }
  function render(){
    const browser=document.querySelector('.deity-browser'),navigation=document.querySelector('.deity-navigation'),detail=$('deity-detail'),node=$('deity-record');
    const position={browser:browser.scrollTop,navigation:navigation.scrollTop,detail:detail.scrollTop};
    const sameRecord=node.dataset.recordId===selected,query=node.querySelector('.deity-relations-search input')?.value||'';
    const expanded=new Set([...node.querySelectorAll('.village-records[open]')].map(item=>item.dataset.villageKey));
    renderNavigation();renderList();
    $('deity-new').disabled=$('deity-export').disabled=!catalog.state;
    $('deity-titles-edit').disabled=$('deity-import').disabled=!canEdit();
    $('deity-form').hidden=!editing;$('deity-record').hidden=!!editing||!selected;$('deity-placeholder').hidden=!!editing||!!selected;document.querySelector('.deity-layout').classList.toggle('has-selection',!!editing||!!selected);
    if(!editing&&selected){const record=catalog.get(selected);if(record){if(record.id!==selected){selected=record.id;setURL(selected,true);}renderRecord(record);}else{$('deity-record').replaceChildren(el('p','note','未找到这份神明档案。'));const back=el('button','linkbutton deity-mobile-back','返回神明列表');back.type='button';back.addEventListener('click',()=>choose(null));$('deity-record').prepend(back);}}
    if(sameRecord&&!editing){
      const input=node.querySelector('.deity-relations-search input');if(input&&query){input.value=query;input.dispatchEvent(new Event('input'));}
      for(const item of node.querySelectorAll('.village-records'))item.open=expanded.has(item.dataset.villageKey);
      detail.scrollTop=position.detail;
    }
    browser.scrollTop=position.browser;navigation.scrollTop=position.navigation;
  }
  async function startEdit(record=null){
    if(!mayLeave()||!catalog.state)return;
    try {
      if(!canEdit()){
        if(!await window.NaozhouCloud?.requireEditor())return;
        await catalog.load();
        if(!canEdit())throw Error('当前无法读取编辑资料。');
      }
      if(record){record=catalog.get(record.id);if(!record)throw Error('未找到这份神明档案。');}
      editing={record};dirty=false;
      $('deity-form-heading').textContent=record?'编辑神明档案':'新增神明';
      $('deity-form-status').textContent='';
      fields=A.createFields($('deity-fields'),catalog,record||{},'deity',{onExisting:existing=>choose(existing.id)});
      readObservances=observances.createFields($('deity-observance-fields'),record||{});
      render();$('deity-detail').scrollTop=0;fields.focus();
    } catch(error) {$('deity-status').textContent=error.message;}
  }
  $('deity-new').addEventListener('click',()=>startEdit());$('deity-search').addEventListener('input',renderList);
  $('deity-form').addEventListener('input',()=>{dirty=true;});
  $('deity-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving||!editing||!$('deity-form').reportValidity())return;
    saving=true;$('deity-form').inert=true;$('deity-form-status').textContent='保存中…';
    try {
      const record=await catalog.saveRecord({...editing.record,...fields.read(),...readObservances()});
      selected=record.id;clearEdit();filter=record.archivedAt?'archived':'all';$('deity-search').value='';setURL(selected);render();
    } catch(error) {$('deity-form-status').textContent=error.message;}
    finally {saving=false;$('deity-form').inert=false;}
  });
  $('deity-cancel').addEventListener('click',()=>{if(!mayLeave())return;clearEdit();render();});
  catalog.subscribe(render);
  document.addEventListener('naozhou-access-change',event=>{
    if(event.detail.reason==='logout')clearEdit();
    if(!editing)render();
  });
  catalog.ready.then(()=>{$('deity-status').textContent='';render();}).catch(error=>{$('deity-status').textContent=error.message;});
  async function loadFaith(){try{const response=await fetch('/api/faith',{cache:'no-store'});if(!response.ok)throw Error();const result=await response.json();if(result.version!==1||!Array.isArray(result.records))throw Error();faith=result;faithError='';}catch{faithError='关联资料暂未读取，请刷新重试。';}if(catalog.state)render();return !faithError;}
  loadFaith();
  villageLinks.ready.then(()=>{if(catalog.state&&!editing)render();}).catch(()=>{});
  let refreshingFaith=false;
  async function refreshFaith(){if(refreshingFaith||dirty||titlesDirty||saving||catalog.saving||villageLinks.dirty||villageLinks.saving||worshipEditor.dirty||worshipEditor.saving)return;refreshingFaith=true;try{await loadFaith();}finally{refreshingFaith=false;}}
  window.addEventListener('focus',refreshFaith);
  window.addEventListener('storage',event=>{if(event.key==='naozhou-faith-changed')refreshFaith();});
  document.addEventListener('naozhou-before-logout',event=>{if(!mayLeave())event.preventDefault();});
  window.addEventListener('popstate',()=>{if(!mayLeave()){setURL(selected);return;}clearEdit();selected=new URLSearchParams(location.search).get('id');render();});
  window.addEventListener('beforeunload',event=>{if(dirty||titlesDirty||saving||catalog.saving||villageLinks.dirty||villageLinks.saving||worshipEditor.dirty||worshipEditor.saving){event.preventDefault();event.returnValue='';}});
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
