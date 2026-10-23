/* Village relationships and journal pickers share the independent people catalog. */
window.createVillagePeople = options => {
  const $=id=>document.getElementById(id),A=window.PeopleArchive,catalog=A.createCatalog(),el=window.DeityAtlas.element;
  const dialog=$('people-picker'),form=$('people-link-form'),createForm=$('people-create-form');
  let place=null,selected=null,linkId=null,fields=null,dirty=false,saving=false,error='';
  const matches=link=>place&&link.placeId===place.id&&link.placeKind===place.kind;
  function render(){
    $('people-section').hidden=!place;$('people-add').disabled=!place||saving;
    const list=$('people-village-list');list.replaceChildren();
    for(const person of catalog.state?.records||[]){
      const links=(person.placeLinks||[]).filter(matches);if(!links.length)continue;
      const row=el('article','people-village-row'),heading=el('div','people-village-heading'),go=el('a','',person.displayName);go.href=A.profileURL(person.id);heading.append(go);
      const edit=el('button','linkbutton','关联');edit.type='button';edit.setAttribute('aria-label','编辑人物关联：'+person.displayName);edit.addEventListener('click',()=>open(person.id));heading.append(edit);row.append(heading);
      const identity=[person.religiousName,...(person.roles||[])].filter(Boolean);if(identity.length)row.append(el('p','note',identity.join(' · ')));
      row.append(el('p','people-relation-copy',links.map(link=>[A.relations.find(item=>item[0]===link.relationType)?.[1]||link.relationType,link.notes].filter(Boolean).join(' · ')).join('\n')));list.append(row);
    }
    if(!list.childNodes.length)list.append(el('p','note',error||(!catalog.state?'正在读取人物资料…':'暂无关联人物')));
  }
  function results(){
    const host=$('people-search-results');host.replaceChildren();
    for(const person of catalog.search($('people-search').value).slice(0,20)){
      const button=el('button','result-button');button.type='button';button.append(el('strong','',person.displayName),el('span','',[person.religiousName,...(person.roles||[]),person.id.slice(-6)].filter(Boolean).join(' · ')));button.addEventListener('click',()=>choose(person));host.append(button);
    }
    if(!host.childNodes.length)host.append(el('p','note','没有找到匹配人物，可以新建档案。'));
  }
  function choose(person){
    selected=person;const link=person.placeLinks?.find(matches);linkId=link?.id||crypto.randomUUID();
    $('people-selected').textContent=person.displayName;$('people-link-fields').hidden=false;
    $('people-relation').value=link?.relationType||'走访关联';$('people-link-note').value=link?.notes||'';$('people-link-source').value=link?.source||'';$('people-link-public').checked=link?.public===true;
    $('people-unlink').hidden=!link;dirty=false;
  }
  async function open(id){
    if(!place||saving||options.beforeEdit?.()===false)return;
    try{if(window.NaozhouCloud&&!await window.NaozhouCloud.requireEditor())return;await catalog.load();if(!catalog.state.editable)return;
      selected=null;fields=null;dirty=false;form.hidden=false;createForm.hidden=true;$('people-link-fields').hidden=true;$('people-search').value='';$('people-picker-status').textContent='';
      if(id){const person=catalog.get(id);if(person)choose(person);}results();dialog.showModal();$('people-search').focus();
    }catch(err){$('people-status').textContent=err.message;}
  }
  function close(){dialog.close();dirty=false;selected=null;fields=null;form.reset();createForm.reset();}
  function mayLeave(){return !saving&&(!dirty||window.confirm('人物资料尚未保存。要放弃填写吗？'));}
  async function saveLink(remove=false){
    if(!selected||!place)return;
    const current=catalog.get(selected.id);if(!current)throw Error('人物档案已更新，请重新选择。');
    const links=(current.placeLinks||[]).filter(link=>link.id!==linkId);
    if(!remove)links.push({id:linkId,placeId:place.id,placeKind:place.kind,relationType:$('people-relation').value.trim()||'走访关联',notes:$('people-link-note').value.trim(),source:$('people-link-source').value.trim(),public:$('people-link-public').checked});
    await catalog.saveRecord({...current,updatedAt:selected.updatedAt,placeLinks:links});
  }
  async function run(action){if(saving)return;saving=true;form.inert=createForm.inert=true;$('people-picker-status').textContent='保存中…';try{await action();close();$('people-status').textContent='已保存人物关联';}catch(err){$('people-picker-status').textContent=err.message;}finally{saving=false;form.inert=createForm.inert=false;render();}}
  $('people-add').addEventListener('click',()=>open());$('people-search').addEventListener('input',results);
  $('people-create').addEventListener('click',()=>{form.hidden=true;createForm.hidden=false;fields=A.createFields($('people-create-fields'),{displayName:$('people-search').value.trim()},'village-person',{places:false});fields.focus();});
  $('people-create-back').addEventListener('click',()=>{if(!mayLeave())return;dirty=false;createForm.hidden=true;form.hidden=false;});
  for(const f of [form,createForm])f.addEventListener('input',()=>{dirty=true;});
  form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())run(()=>saveLink());});
  createForm.addEventListener('submit',event=>{event.preventDefault();if(!createForm.reportValidity())return;run(async()=>{const person=await catalog.saveRecord(fields.read());choose(person);createForm.hidden=true;form.hidden=false;await saveLink();});});
  $('people-unlink').addEventListener('click',async()=>{if(await A.confirm('解除该人物与本村的这一项关联？人物档案及其他村庄关联会保留。','解除关联'))run(()=>saveLink(true));});
  $('people-picker-close').addEventListener('click',()=>{if(mayLeave())close();});dialog.addEventListener('cancel',event=>{event.preventDefault();if(mayLeave())close();});
  document.addEventListener('naozhou-before-logout',event=>{if(!mayLeave())event.preventDefault();});
  document.addEventListener('naozhou-access-change',event=>{if(!event.detail.editable&&event.detail.reason==='logout'&&dialog.open)close();});
  catalog.subscribe(()=>{error='';render();if(dialog.open&&!selected&&createForm.hidden)results();});catalog.ready.catch(err=>{error=err.message;render();});
  return {catalog,mayLeave,get dirty(){return dirty;},get saving(){return saving;},selectPlace(value){if(dialog.open)close();place=value;render();}};
};

window.createJournalPeople = (host,catalog,onChange) => {
  const el=window.DeityAtlas.element,A=window.PeopleArchive;let links=[];
  const section=el('details','journal-people'),summary=el('summary','','关联人物'),label=el('label','','查找姓名、法号或别名'),search=el('input'),results=el('div','people-entry-results'),chosen=el('div');
  search.type='search';search.setAttribute('aria-label','查找日志相关人物');section.append(summary,label,search,results,chosen);host.append(section);
  const change=()=>{onChange();renderChoices();};
  function renderChoices(){chosen.replaceChildren();for(const link of links){const person=catalog.get(link.personId),row=el('div','journal-person-choice'),heading=el('div','people-village-heading'),go=el('a','',person?.displayName||'人物档案');go.href=A.profileURL(link.personId);const remove=el('button','linkbutton','移除关联');remove.type='button';remove.addEventListener('click',()=>{links=links.filter(item=>item!==link);change();});heading.append(go,remove);row.append(heading);
    const roleLabel=el('label','','本条记录中的角色'),role=el('input');role.value=link.roleInEntry||'';role.placeholder='如：受访者、亲历叙述者、转述者';role.maxLength=100;role.setAttribute('aria-label','人物角色：'+(person?.displayName||'人物档案'));role.addEventListener('input',()=>{link.roleInEntry=role.value;onChange();});row.append(roleLabel,role);
    const more=el('details'),caption=el('summary','','补充叙述来源与时间');more.append(caption);
    for(const [field,title,limit] of [['notes','关联说明（勾选公开后随关联展示）',5000],['narratedAt','讲述时间',100],['eventDateText','所述事件时间（原始表述）',300],['narrativeSource','叙述来源',3000]]){const caption=el('label','',title),input=el(field==='notes'?'textarea':'input');input.value=link[field]||'';input.maxLength=limit;input.addEventListener('input',()=>{link[field]=input.value;onChange();});more.append(caption,input);}row.append(more);
    const publishLabel=el('label','people-inline-check'),publish=el('input');publish.type='checkbox';publish.checked=link.public===true;publish.addEventListener('change',()=>{link.public=publish.checked;onChange();});publishLabel.append(publish,document.createTextNode('允许公开此人物关联（仍受人物档案权限限制）'));row.append(publishLabel);chosen.append(row);}}
  function renderResults(){results.replaceChildren();if(!search.value.trim())return;for(const person of catalog.search(search.value).slice(0,12)){const button=el('button','result-button');button.type='button';button.append(el('strong','',person.displayName),el('span','',[person.religiousName,...(person.roles||[]),person.id.slice(-6)].filter(Boolean).join(' · ')));button.addEventListener('click',()=>{if(!links.some(link=>link.personId===person.id)){links.push({personId:person.id,roleInEntry:'参与者',public:false});onChange();}search.value='';renderResults();renderChoices();});results.append(button);}if(!results.childNodes.length){const note=el('p','note','没有匹配人物。可先在人物档案或本村「相关人物」中新建。');results.append(note);}}
  search.addEventListener('input',renderResults);catalog.subscribe(()=>{renderChoices();renderResults();});
  return {set(value=[]){links=structuredClone(value);search.value='';section.open=!!links.length;renderResults();renderChoices();},read(){return structuredClone(links);}};
};
