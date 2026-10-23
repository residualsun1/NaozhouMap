/* One live archive, two presentations. Moving its nodes preserves forms and record links. */
window.createPlaceReader = options => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog=$('place-reader'),trigger=$('expand-reading'),scroll=$('reader-scroll');
  const documentBody=$('reader-document'),content=$('detail-content'),heading=document.querySelector('.detail-heading');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),positions=new Map();
  let place=null,opened=false,closing=false,closeTimer=null,frame=null,restoringHistory=false;
  let headingHome,contentHome,quickScroll=0,quickTimelineScroll=0,sourceWasOpen=false,returnURL='',chapters=[],sheetStyle=null;
  const key = selected => selected ? selected.kind+':'+selected.id : '';
  const withoutMarker = () => {const state={...history.state};delete state.naozhouPlaceReader;return state;};
  function quickURL() {const url=new URL(location.href);url.searchParams.delete('view');url.searchParams.delete('entryId');return url;}
  function setMenu(value) {dialog.classList.toggle('is-menu-open',value);$('reader-menu').setAttribute('aria-expanded',String(value));}
  function markChapter() {
    frame=null;if(!opened||!chapters.length)return;
    const top=scroll.getBoundingClientRect().top+100;
    const current=chapters.filter(section=>section.getBoundingClientRect().top<=top).at(-1)||chapters[0];
    for(const button of $('reader-chapters').children)button.setAttribute('aria-current',button.getAttribute('aria-controls')===current.id?'location':'false');
  }
  function scheduleChapter() {if(frame===null)frame=requestAnimationFrame(markChapter);}
  function updateChapters() {
    if(!opened)return;
    chapters=[...content.children].filter(section=>section.hasAttribute('data-reading-label')&&!section.hidden);
    const buttons=chapters.map(section=>{
      const button=document.createElement('button');button.type='button';button.textContent=section.dataset.readingLabel;button.setAttribute('aria-controls',section.id);
      button.addEventListener('click',()=>{setMenu(false);section.tabIndex=-1;section.focus({preventScroll:true});section.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});});
      return button;
    });
    $('reader-chapters').replaceChildren(...buttons);scheduleChapter();
  }
  new MutationObserver(changes=>{
    if(opened&&changes.some(change=>change.target===content||change.type==='attributes'&&change.target.parentElement===content))updateChapters();
  }).observe(content,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  scroll.addEventListener('scroll',scheduleChapter,{passive:true});
  function rememberURL() {
    const url=new URL(location.href),alreadyReading=url.searchParams.get('view')==='reading';
    returnURL=alreadyReading?quickURL().href:url.href;
    for(const name of ['explore','deity','mapReturn'])url.searchParams.delete(name);
    url.searchParams.set('placeId',place.id);url.searchParams.set('placeKind',place.kind);url.searchParams.set('view','reading');
    if(alreadyReading&&history.state?.naozhouPlaceReader===key(place))return;
    if(alreadyReading)history.replaceState(withoutMarker(),'',returnURL);
    history.pushState({...history.state,naozhouPlaceReader:key(place)},'',url);
  }
  function open({fromHistory=false}={}) {
    if(!place||$('detail-panel').hidden||options.beforeOpen?.()===false)return false;
    if(opened)return true;
    if(closing)finishClose(false);
    quickScroll=content.scrollTop;quickTimelineScroll=$('journal-timeline').scrollTop;sourceWasOpen=$('reference-more').open;
    if(matchMedia('(max-width:800px)').matches){const style=$('workspace').style;sheetStyle={value:style.getPropertyValue('--sheet-size'),priority:style.getPropertyPriority('--sheet-size')};style.setProperty('--sheet-size',$('detail-panel').getBoundingClientRect().height+'px','important');}
    headingHome=document.createComment('quick archive heading');contentHome=document.createComment('quick archive content');
    heading.before(headingHome);content.before(contentHome);documentBody.append(heading,content);
    $('reference-more').open=true;$('reader-place-name').textContent=place.name;$('reader-scroll').setAttribute('aria-label',place.name+'完整档案');
    dialog.classList.remove('is-leaving');setMenu(false);dialog.showModal();opened=true;trigger.setAttribute('aria-expanded','true');
    if(!fromHistory)rememberURL();else returnURL=quickURL().href;
    updateChapters();scroll.scrollTop=positions.get(key(place))||0;$('reference-name').focus({preventScroll:true});
    if(!positions.has(key(place))){const active=content.querySelector('.journal-record[open]');if(active)requestAnimationFrame(()=>{if(opened&&active.isConnected)active.closest('.journal-entry').scrollIntoView({block:'start'});});}
    return true;
  }
  function finishClose(restoreFocus=true) {
    clearTimeout(closeTimer);closing=false;
    if(dialog.open)dialog.close();
    headingHome?.replaceWith(heading);contentHome?.replaceWith(content);headingHome=contentHome=null;
    if(sheetStyle){const style=$('workspace').style;if(sheetStyle.value)style.setProperty('--sheet-size',sheetStyle.value,sheetStyle.priority);else style.removeProperty('--sheet-size');sheetStyle=null;}
    $('reference-more').open=sourceWasOpen;content.scrollTop=quickScroll;$('journal-timeline').scrollTop=quickTimelineScroll;
    dialog.classList.remove('is-leaving');
    if(restoreFocus&&!trigger.disabled&&!$('detail-panel').hidden)trigger.focus({preventScroll:true});
  }
  function close({immediate=false,historyMode='replace',restoreFocus=true}={}) {
    if(!opened){if(closing&&immediate)finishClose(restoreFocus);return;}
    positions.set(key(place),scroll.scrollTop);opened=false;trigger.setAttribute('aria-expanded','false');setMenu(false);
    if(historyMode==='replace'&&new URL(location.href).searchParams.get('view')==='reading')history.replaceState(withoutMarker(),'',returnURL||quickURL());
    if(immediate||reduced.matches){finishClose(restoreFocus);return;}
    closing=true;dialog.classList.add('is-leaving');closeTimer=setTimeout(()=>finishClose(restoreFocus),180);
  }
  function returnToMap() {
    if(history.state?.naozhouPlaceReader===key(place)&&new URL(location.href).searchParams.get('view')==='reading')history.back();
    else close();
  }
  $('reader-back').addEventListener('click',returnToMap);
  $('reader-close').addEventListener('click',()=>options.closeArchive());
  trigger.addEventListener('click',()=>open());
  $('reader-menu').addEventListener('click',()=>setMenu(!dialog.classList.contains('is-menu-open')));
  dialog.addEventListener('pointerdown',event=>{if(!event.target.closest('#reader-toc,#reader-menu'))setMenu(false);});
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.classList.contains('is-menu-open'))setMenu(false);else returnToMap();});
  // Actions that intentionally return to geographic exploration keep their existing handlers.
  dialog.addEventListener('click',event=>{
    if(event.target.closest('#parent-village,#parent-administration,#settlement-list button,#settlement-related button,#administration-member-list button,#administration-view,#use-reference,#place-overview-edit,#faith-add,.faith-card-heading .linkbutton,.field-note-heading .linkbutton,#journal-add,.journal-edit,#people-add,.people-village-heading button'))close({immediate:true,restoreFocus:false});
  },true);
  window.addEventListener('popstate',()=>{
    const query=new URLSearchParams(location.search);
    if(query.get('view')!=='reading'){close({historyMode:'none'});return;}
    restoringHistory=true;
    const id=query.get('placeId'),kind=query.get('placeKind');
    const found=id&&['reference','survey'].includes(kind)&&(key(place)===kind+':'+id||options.selectPlace(kind,id));
    restoringHistory=false;
    if(found)open({fromHistory:true});
    else {
      const url=quickURL();if(place){url.searchParams.set('placeId',place.id);url.searchParams.set('placeKind',place.kind);}
      if(opened){url.searchParams.set('view','reading');history.replaceState({...history.state,naozhouPlaceReader:key(place)},'',url);}
      else history.replaceState(withoutMarker(),'',url);
    }
  });
  return {
    open,close,get isOpen(){return opened;},
    selectPlace(selected){
      if(key(selected)!==key(place))close({immediate:true,historyMode:restoringHistory?'none':'replace',restoreFocus:false});
      place=selected;trigger.disabled=!selected;
    }
  };
};
