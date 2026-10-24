/* A read-only spatial companion to the single people catalog. */
window.createPeopleExplorer = options => {
  'use strict';
  const P=window.PeopleArchive,el=P.element,$=id=>document.getElementById(id),catalog=options.catalog;
  const panel=$('people-explorer'),toggle=$('people-explorer-toggle'),workspace=$('workspace');
  const desktop=matchMedia('(min-width:801px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  let opened=false,selectedId=null,collapsed=false,pendingFocus=false,error='',roleSignature='';
  const storageKey='naozhou-people-map-context-v1';
  const active=person=>!person.archivedAt&&!person.mergedInto;
  const relationName=value=>P.relations.find(row=>row[0]===value)?.[1]||value;
  function locations(person=catalog.get(selectedId)){
    const grouped=new Map();
    for(const link of person?.placeLinks||[]){
      const key=link.placeKind+':'+link.placeId;
      if(!grouped.has(key)){
        const resolved=options.resolvePlace(link.placeKind,link.placeId),point=resolved&&Number.isFinite(resolved.lng)&&Number.isFinite(resolved.lat)?resolved:null;
        grouped.set(key,{key,id:link.placeId,kind:link.placeKind,name:resolved?.name||'地点名称待确认',point,links:[]});
      }
      grouped.get(key).links.push(link);
    }
    return [...grouped.values()];
  }
  function syncURL(){
    const url=new URL(location.href);for(const name of ['person','peopleExplore','peopleReturn'])url.searchParams.delete(name);
    if(opened){url.searchParams.set('peopleExplore','1');if(selectedId)url.searchParams.set('person',selectedId);for(const name of ['deity','explore','mapReturn','placeId','placeKind','faithId','entryId','view'])url.searchParams.delete(name);}
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }
  function setCollapsed(value){
    collapsed=!!value;workspace.classList.toggle('explorer-collapsed',opened&&collapsed);
    $('person-explore-sheet-toggle').textContent=collapsed?'展开':'收起';$('person-explore-sheet-toggle').setAttribute('aria-expanded',String(!collapsed));
    $('person-explore-heading').textContent=collapsed&&catalog.get(selectedId)?catalog.get(selectedId).displayName:'人物探索';
  }
  function showPanel(value){opened=value;panel.hidden=!value;workspace.classList.toggle('explorer-open',value);toggle.setAttribute('aria-expanded',String(value));setCollapsed(collapsed);}
  function scrollButtons(){
    const list=$('person-explore-list'),overflow=desktop.matches&&list.scrollWidth>list.clientWidth+2;
    for(const id of ['person-explore-previous','person-explore-next'])$(id).hidden=!overflow;
    $('person-explore-previous').disabled=list.scrollLeft<=2;$('person-explore-next').disabled=list.scrollLeft+list.clientWidth>=list.scrollWidth-2;
  }
  function renderRoles(){
    const roles=[...new Set((catalog.state?.records||[]).filter(active).flatMap(person=>person.roles||[]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const signature=JSON.stringify(roles);if(signature===roleSignature)return;roleSignature=signature;
    const value=$('person-explore-role').value;$('person-explore-role').replaceChildren(new Option('全部身份',''),...roles.map(role=>new Option(role,role)));
    if(roles.includes(value))$('person-explore-role').value=value;
  }
  function render(){
    if(!opened)return;
    const canonical=catalog.get(selectedId);if(canonical&&canonical.id!==selectedId){selectedId=canonical.id;syncURL();}
    setCollapsed(collapsed);renderRoles();$('person-explore-status').textContent=error;$('person-explore-retry').hidden=!error;
    const list=$('person-explore-list'),scroll=list.scrollLeft,role=$('person-explore-role').value;
    const records=catalog.search($('person-explore-search').value).filter(person=>active(person)&&(!role||person.roles?.includes(role))).sort((a,b)=>a.displayName.localeCompare(b.displayName,'zh-CN')||a.id.localeCompare(b.id));
    list.replaceChildren();
    for(const person of records){
      const row=el('button','explorer-deity-row people-explorer-card'+(person.id===selectedId?' is-selected':''));row.type='button';row.setAttribute('aria-pressed',String(person.id===selectedId));row.dataset.personId=person.id;
      const media=el('span','explorer-card-media people-explorer-media');media.setAttribute('aria-hidden','true');
      const portrait=document.createElementNS('http://www.w3.org/2000/svg','svg');portrait.setAttribute('viewBox','0 0 24 24');portrait.setAttribute('fill','none');portrait.setAttribute('stroke','currentColor');portrait.setAttribute('stroke-width','1');
      const shape=document.createElementNS(portrait.namespaceURI,'path');shape.setAttribute('d','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z');portrait.append(shape);media.append(portrait,el('span','','暂无肖像'));
      const copy=el('span','explorer-card-copy');copy.append(el('strong','',person.displayName));
      const meta=el('span','explorer-row-meta');meta.append(el('span','',(person.roles||[]).join(' · ')||'身份未详'),el('span','',locations(person).length+' 个地点'));copy.append(meta);
      if(person.religiousName||person.aliases?.length)copy.append(el('small','people-card-alias',[person.religiousName,...(person.aliases||[])].filter(Boolean).join(' / ')));
      row.title=[person.displayName,person.religiousName,...(person.aliases||[]),person.id.slice(-8)].filter(Boolean).join(' · ');row.append(media,copy);row.addEventListener('click',()=>select(person.id));list.append(row);
    }
    if(!records.length)list.append(el('p','note',!catalog.state?'正在读取人物资料…':!catalog.state.records.length?'尚无可浏览的人物档案':$('person-explore-search').value?'没有找到匹配的人物':'暂无符合条件的活跃人物'));
    list.scrollLeft=scroll;requestAnimationFrame(scrollButtons);
    const person=catalog.get(selectedId),relations=person?locations(person):[],located=relations.filter(place=>place.point);
    options.onHighlight(person?person.id:null,located);
    $('person-explore-selected').hidden=!person;$('person-explore-gallery').hidden=!desktop.matches&&!!person;$('person-explore-controls').hidden=!desktop.matches&&!!person;
    $('person-explore-change').textContent=desktop.matches?'取消选择':'更换人物';
    if(!person){for(const id of ['person-explore-name','person-explore-summary','person-explore-count'])$(id).textContent='';$('person-explore-villages').replaceChildren();return;}
    $('person-explore-name').textContent=person.displayName;$('person-explore-name').title=person.displayName;
    $('person-explore-summary').textContent=[person.religiousName,...(person.roles||[])].filter(Boolean).join(' · ');$('person-explore-summary').hidden=!$('person-explore-summary').textContent;
    $('person-explore-count').textContent='关联地点 '+relations.length+' 处 · 可定位 '+located.length+' 处';
    $('person-explore-fit').disabled=!located.length;$('person-explore-full-record').href=P.profileURL(person.id);
    const villages=$('person-explore-villages');villages.replaceChildren();
    for(const relation of relations){
      const row=el(relation.point?'button':'article','explorer-village');if(relation.point){row.type='button';row.setAttribute('aria-label','定位并查看'+relation.name+'档案');row.addEventListener('click',()=>options.onPlace(relation));}
      const heading=el('div','explorer-village-heading');heading.append(el('strong','',relation.name),el('span','',relation.point?'定位并查看档案 ↗':'位置待确认'));row.append(heading);
      const types=[...new Set(relation.links.map(link=>relationName(link.relationType)))].join(' · ');row.append(el('small','people-location-relation',types));
      const notes=relation.links.map(link=>link.notes).filter(Boolean);if(notes.length)row.append(el('p','',notes.join('\n')));
      row.title=[relation.name,types,...notes].join('\n');villages.append(row);
    }
    if(!relations.length)villages.append(el('p','note','暂无关联地点'));
    if(pendingFocus){pendingFocus=false;if(located.length)options.onFocus(located);}
  }
  function select(id,fit=true){selectedId=id;pendingFocus=fit;syncURL();render();$('person-explore-content').scrollTop=0;}
  function open(id){
    if(!opened&&options.beforeOpen?.()===false)return false;showPanel(true);setCollapsed(false);
    if(id!==undefined){$('person-explore-search').value='';$('person-explore-role').value='';select(id);}else{syncURL();render();}
    (!selectedId&&desktop.matches?$('person-explore-search'):$('person-explore-close')).focus({preventScroll:true});return true;
  }
  function close({focus=true}={}){pendingFocus=false;options.onClose?.();selectedId=null;showPanel(false);syncURL();options.onHighlight(null,[]);if(focus)toggle.focus({preventScroll:true});}
  function suspend(){pendingFocus=false;options.onClose?.();showPanel(false);syncURL();options.onHighlight(null,[]);}
  toggle.addEventListener('click',()=>opened?close():open());$('person-explore-close').addEventListener('click',()=>close());
  $('person-explore-change').addEventListener('click',()=>{select(null,false);$('person-explore-search').focus({preventScroll:true});});
  $('person-explore-sheet-toggle').addEventListener('click',()=>setCollapsed(!collapsed));
  for(const id of ['person-explore-search','person-explore-role'])$(id).addEventListener(id.endsWith('role')?'change':'input',render);
  $('person-explore-fit').addEventListener('click',()=>{const located=locations().filter(place=>place.point);if(located.length)options.onFocus(located);});
  for(const [id,direction] of [['person-explore-previous',-1],['person-explore-next',1]])$(id).addEventListener('click',()=>{const list=$('person-explore-list');list.scrollBy({left:direction*Math.max(180,list.clientWidth*.8),behavior:reduced.matches?'instant':'smooth'});});
  $('person-explore-list').addEventListener('scroll',scrollButtons,{passive:true});new ResizeObserver(scrollButtons).observe($('person-explore-list'));
  $('person-explore-retry').addEventListener('click',async()=>{try{await catalog.load();error='';}catch(err){error=err.message;}render();});
  for(const id of ['person-explore-full-record','person-explore-workbench'])$(id).addEventListener('click',event=>{
    const token=P.uid();try{sessionStorage.setItem(storageKey,JSON.stringify({version:1,token,personId:selectedId,query:$('person-explore-search').value,role:$('person-explore-role').value,collapsed,view:options.captureView()}));const url=new URL(P.profileURL(selectedId),location.origin);url.searchParams.set('peopleReturn',token);event.currentTarget.href=url.pathname+url.search;}catch{}
  });
  catalog.subscribe(()=>{error='';if(opened)render();});catalog.ready.catch(err=>{error=err.message;if(opened)render();});desktop.addEventListener('change',()=>{if(opened)render();});
  document.addEventListener('naozhou-archive-change',()=>catalog.load().catch(err=>{error=err.message;if(opened)render();}));
  window.addEventListener('pageshow',event=>{if(event.persisted&&opened)catalog.load().catch(err=>{error=err.message;render();});});
  function restoreFromURL(){
    const query=new URLSearchParams(location.search),requested=query.get('person'),token=query.get('peopleReturn');let saved=null;
    if(token)try{const value=JSON.parse(sessionStorage.getItem(storageKey));if(value?.version===1&&value.token===token)saved=value;}catch{}
    if(!requested&&!saved&&query.get('peopleExplore')!=='1')return false;
    if(!open(requested||saved?.personId||undefined))return false;
    if(saved&&(!requested||requested===saved.personId)){$('person-explore-search').value=saved.query||'';const restore=()=>{renderRoles();if([...$('person-explore-role').options].some(option=>option.value===saved.role))$('person-explore-role').value=saved.role;render();};restore();catalog.ready.then(restore).catch(()=>{});pendingFocus=options.restoreView(saved.view)===false&&!!selectedId;setCollapsed(saved.collapsed);render();}
    return true;
  }
  return {open,close,suspend,restoreFromURL,get isOpen(){return opened;},cancelAutoFocus(){pendingFocus=false;}};
};
