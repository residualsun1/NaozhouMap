/* Read-only map companion to the existing deity catalog and faith records. */
window.createDeityExplorer = options => {
  'use strict';
  const {faith,resolvePlace,beforeOpen,onHighlight,onFocus,onPlace,captureView,restoreView}=options;
  const A=window.DeityAtlas,catalog=faith.catalog,$=id=>document.getElementById(id),el=A.element;
  const workspace=$('workspace'),panel=$('deity-explorer'),toggle=$('deity-explorer-toggle');
  const desktop=matchMedia('(min-width:801px)'),reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
  const storageKey='naozhou-deity-map-context-v1';
  let opened=false,selectedId=null,collapsed=false,loading=false,catalogError='',pendingFocus=false,categorySignature='';
  function syncURL(){
    const url=new URL(location.href);
    for(const key of ['explore','deity','mapReturn'])url.searchParams.delete(key);
    if(opened){url.searchParams.set('explore','1');if(selectedId)url.searchParams.set('deity',selectedId);for(const key of ['placeKind','placeId','faithId'])url.searchParams.delete(key);}
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }
  function relations(){return selectedId&&faith.records?A.locatedVillagesFor(selectedId,faith.records,resolvePlace):[];}
  function setCollapsed(value){collapsed=!!value;workspace.classList.toggle('explorer-collapsed',opened&&collapsed);$('explorer-sheet-toggle').textContent=collapsed?'展开':'收起';$('explorer-sheet-toggle').setAttribute('aria-expanded',String(!collapsed));$('explorer-heading').textContent=collapsed&&catalog.get(selectedId)?catalog.get(selectedId).name:'神明探索';}
  function showPanel(value){opened=value;panel.hidden=!value;workspace.classList.toggle('explorer-open',value);toggle.setAttribute('aria-expanded',String(value));setCollapsed(collapsed);}
  function empty(title,copy='',link=false){$('explorer-empty').hidden=false;$('explorer-gallery').hidden=true;$('explorer-empty-title').textContent=title;$('explorer-empty-copy').textContent=copy;$('explorer-empty-link').hidden=!link;if(link)$('explorer-workbench').hidden=true;}
  function renderCategories(){
    const signature=JSON.stringify(catalog.state?.titles||[]);if(signature===categorySignature)return;categorySignature=signature;
    const value=$('explorer-category').value;$('explorer-category').replaceChildren();
    for(const title of [{id:'all',name:'全部神函'},...(catalog.state?.titles||[]),{id:'unclassified',name:'待分类'}]){const option=el('option','',title.name);option.value=title.id;$('explorer-category').append(option);}
    if([...$('explorer-category').options].some(option=>option.value===value))$('explorer-category').value=value;
  }
  function titleNames(record){return record.titleIds.map(id=>catalog.state.titles.find(title=>title.id===id)?.name).filter(Boolean);}
  function syncScrollButtons(){
    const list=$('explorer-list'),overflow=desktop.matches&&!list.hidden&&list.scrollWidth>list.clientWidth+2;
    for(const id of ['explorer-previous','explorer-next'])$(id).hidden=!overflow;
    $('explorer-previous').disabled=list.scrollLeft<=2;$('explorer-next').disabled=list.scrollLeft+list.clientWidth>=list.scrollWidth-2;
  }
  function renderCards(){
    const list=$('explorer-list'),scroll=list.scrollLeft,focused=document.activeElement?.closest('.explorer-deity-row')?.dataset.deityId;
    list.replaceChildren();
    const category=$('explorer-category').value;
    const matches=catalog.search($('explorer-search').value).filter(record=>category==='all'||(category==='unclassified'?!record.titleIds.length:record.titleIds.includes(category))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
    if(!matches.length)empty('没有找到匹配的神明');
    for(const record of matches){
      const row=el('button','explorer-deity-row'+(record.id===selectedId?' is-selected':''));row.type='button';row.dataset.deityId=record.id;row.setAttribute('aria-pressed',String(record.id===selectedId));
      const media=el('span','explorer-card-media');media.setAttribute('aria-hidden','true');
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1');
      const frame=document.createElementNS(icon.namespaceURI,'rect');for(const [key,value] of Object.entries({x:3,y:3,width:18,height:18,rx:3}))frame.setAttribute(key,value);
      const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','m3 16 5-5 4 4 3-3 6 6M8 7h.01');icon.append(frame,path);media.append(icon,el('span','','暂无图片'));
      const copy=el('span','explorer-card-copy');copy.append(el('strong','',record.name));
      const meta=el('span','explorer-row-meta');meta.append(el('span','',titleNames(record).join(' · ')||'待分类'),el('span','',faith.records&&!faith.error?A.villagesFor(record.id,faith.records).length+' 个村庄':'关联读取中'));copy.append(meta);
      if(record.aliases.length)copy.append(el('small','explorer-card-alias',record.aliases.join(' / ')));
      const sameName=catalog.state.records.filter(item=>item.name===record.name).length>1;
      if(sameName)copy.append(el('small','explorer-card-identity','独立档案 · '+record.id.slice(-8)));
      row.title=[record.name,record.aliases.join(' / '),sameName?record.identityNote:''].filter(Boolean).join('\n');row.append(media,copy);
      row.addEventListener('click',()=>select(record.id));list.append(row);
    }
    list.scrollLeft=scroll;
    if(focused)[...list.children].find(row=>row.dataset.deityId===focused)?.focus({preventScroll:true});
    requestAnimationFrame(syncScrollButtons);
  }
  function render(){
    renderCategories();setCollapsed(collapsed);
    $('explorer-empty').hidden=true;$('explorer-retry').hidden=true;$('explorer-status').textContent='';
    const browsing=desktop.matches||!selectedId;
    $('explorer-gallery').hidden=!browsing;$('explorer-list').hidden=!browsing;$('explorer-controls').hidden=!browsing;$('explorer-selected').hidden=true;$('explorer-workbench').hidden=!!selectedId;
    $('explorer-change').textContent=desktop.matches?'取消选择':'更换神明';
    const error=catalogError||faith.error;
    const locations=relations(),located=locations.filter(village=>village.point);
    onHighlight(selectedId,error?[]:located);
    if(loading||!catalog.state&&!catalogError){$('explorer-gallery').hidden=true;$('explorer-status').textContent='正在读取神明资料…';return;}
    if(catalogError){$('explorer-gallery').hidden=true;$('explorer-status').textContent=catalogError;$('explorer-retry').hidden=false;return;}
    if(browsing){
      if(!catalog.state.records.length){empty('尚未收录神明档案','可前往神明谱系建立档案，再关联到村庄。',true);if(!selectedId)return;}
      else renderCards();
    }
    if(selectedId){
      const record=catalog.get(selectedId);
      if(!record){empty('未找到这份神明档案','可在完整神明谱系中核对档案编号。',true);$('explorer-controls').hidden=false;return;}
      $('explorer-selected').hidden=false;$('explorer-name').textContent=record.name;$('explorer-name').title=record.name;$('explorer-titles').replaceChildren();
      for(const name of titleNames(record).length?titleNames(record):['待分类'])$('explorer-titles').append(el('span','deity-badge',name));
      if(record.archivedAt)$('explorer-titles').append(el('span','deity-badge','已归档'));
      $('explorer-description').textContent=record.description||'';$('explorer-description').hidden=!record.description;
      $('explorer-full-record').href=A.profileURL(record.id);
      $('explorer-villages').replaceChildren();$('explorer-fit').disabled=!located.length||!!error;$('explorer-fit').hidden=!located.length;
      if(faith.error||!faith.records){$('explorer-count').textContent='';$('explorer-status').textContent=faith.error||'正在读取村庄关联…';$('explorer-retry').hidden=!faith.error;return;}
      $('explorer-count').textContent='关联村庄 '+locations.length+' 处 · 可定位 '+located.length+' 处';
      if(!locations.length){$('explorer-villages').append(el('h4','explorer-no-relations','暂无关联村庄'),el('p','note','该神明尚未与村庄信仰记录建立关联。'));}
      for(const village of locations){
        const row=el(village.point?'button':'article','explorer-village');if(village.point){row.type='button';row.setAttribute('aria-label','定位并查看'+village.name+'档案');row.addEventListener('click',()=>onPlace(village));}
        row.dataset.placeKey=village.key;
        const heading=el('div','explorer-village-heading');heading.append(el('strong','',village.name),el('span','',village.point?'定位并查看档案 ↗':'位置待确认'));row.append(heading);
        const kind=village.point?.placeKind,type=kind==='natural_village'?'自然村':kind==='administrative_seat'?'行政驻地':kind==='locality'?'地点':village.kind==='survey'?'调查点位':'';
        if(type)row.append(el('small','',type+' · '+village.records.length+' 条记录'));
        else row.append(el('small','',village.records.length+' 条记录'));
        const names=[...new Set(village.records.flatMap(({record,links})=>links.map(link=>link.localName||record.deities[link.nameIndex]).filter(Boolean)))];
        const titles=[...new Set(village.records.flatMap(({links})=>links.map(link=>link.localTitle).filter(Boolean)))];
        if(names.length)row.append(el('p','','当地称谓：'+names.join('、')));if(titles.length)row.append(el('p','','当地神函：'+titles.join('、')));
        row.title=[type,village.records.length+' 条记录',names.length?'当地称谓：'+names.join('、'):'',titles.length?'当地神函：'+titles.join('、'):''].filter(Boolean).join('\n');
        $('explorer-villages').append(row);
      }
      if(pendingFocus&&opened){pendingFocus=false;if(located.length)onFocus(located);}
      return;
    }
    if(faith.error){$('explorer-status').textContent=faith.error;$('explorer-retry').hidden=false;}
  }
  function select(id,fit=true){selectedId=id;pendingFocus=fit;syncURL();render();$('explorer-content').scrollTop=0;}
  function open(id){
    if(!opened&&beforeOpen()===false)return false;
    showPanel(true);setCollapsed(false);if(id!==undefined){$('explorer-search').value='';$('explorer-category').value='all';select(id);}else{syncURL();render();}
    if(!matchMedia('(max-width:800px)').matches&&!selectedId)$('explorer-search').focus({preventScroll:true});
    else $('explorer-close').focus({preventScroll:true});
    return true;
  }
  function close(){pendingFocus=false;selectedId=null;options.onClose?.();showPanel(false);syncURL();onHighlight(null,[]);toggle.focus({preventScroll:true});}
  function suspend(){pendingFocus=false;showPanel(false);syncURL();}
  async function reload(){
    if(loading)return;loading=true;render();
    const results=await Promise.allSettled([catalog.load(),faith.reload()]);
    catalogError=results[0].status==='rejected'?results[0].reason.message:'';loading=false;render();
  }
  function captureReturn(){
    try{const token=A.uid();sessionStorage.setItem(storageKey,JSON.stringify({version:1,token,deityId:selectedId,query:$('explorer-search').value,category:$('explorer-category').value,collapsed,view:captureView()}));return token;}catch{return '';}
  }
  function prepareLink(event){const token=captureReturn();event.currentTarget.href=selectedId?A.profileURL(selectedId,token):'/deities'+(token?'?mapReturn='+encodeURIComponent(token):'');}
  for(const id of ['explorer-full-record','explorer-workbench','explorer-empty-link'])$(id).addEventListener('click',prepareLink);
  $('explorer-close').addEventListener('click',close);toggle.addEventListener('click',()=>opened?close():open());
  $('explorer-search').addEventListener('input',render);$('explorer-category').addEventListener('change',render);
  $('explorer-change').addEventListener('click',()=>{select(null,false);$('explorer-search').focus({preventScroll:true});});
  $('explorer-fit').addEventListener('click',()=>{const located=relations().filter(village=>village.point);if(located.length)onFocus(located);});
  $('explorer-retry').addEventListener('click',reload);$('explorer-sheet-toggle').addEventListener('click',()=>setCollapsed(!collapsed));
  for(const [id,direction] of [['explorer-previous',-1],['explorer-next',1]])$(id).addEventListener('click',()=>{const list=$('explorer-list');list.scrollBy({left:direction*Math.max(180,list.clientWidth*.8),behavior:reducedMotion.matches?'instant':'smooth'});});
  $('explorer-list').addEventListener('scroll',syncScrollButtons,{passive:true});
  new ResizeObserver(syncScrollButtons).observe($('explorer-list'));
  desktop.addEventListener('change',()=>{if(opened)render();});
  catalog.subscribe(()=>{catalogError='';if(opened||selectedId)render();});faith.subscribe(()=>{if(opened||selectedId)render();});
  catalog.ready.catch(error=>{catalogError=error.message;if(opened)render();});
  function restoreFromURL(){
    const query=new URLSearchParams(location.search),token=query.get('mapReturn'),requested=query.get('deity');let saved=null;
    if(token)try{const candidate=JSON.parse(sessionStorage.getItem(storageKey));if(candidate?.version===1&&candidate.token===token)saved=candidate;}catch{}
    if(!requested&&!saved&&query.get('explore')!=='1')return false;
    if(!open(requested||saved?.deityId||undefined))return false;
    if(saved){
      $('explorer-search').value=typeof saved.query==='string'?saved.query:'';
      const setCategory=()=>{renderCategories();if([...$('explorer-category').options].some(option=>option.value===saved.category))$('explorer-category').value=saved.category;render();};setCategory();catalog.ready.then(setCategory).catch(()=>{});
      if(!requested||requested===saved.deityId){pendingFocus=restoreView(saved.view)===false&&!!selectedId;setCollapsed(saved.collapsed);}
      render();
    }
    return true;
  }
  window.addEventListener('pageshow',event=>{if(event.persisted&&opened)reload();});
  return {open,close,suspend,restoreFromURL,get isOpen(){return opened;},cancelAutoFocus(){pendingFocus=false;}};
};
