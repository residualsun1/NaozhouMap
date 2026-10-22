(() => {
  'use strict';
  const data = window.NAOZHOU_DATA;
  const $ = id => document.getElementById(id);
  const STORE = 'naozhou-field-map-v1';
  const NS = 'http://www.w3.org/2000/svg';
  const R = 6378137, RAD = Math.PI / 180;
  const originX = R * 110.596 * RAD, originY = R * Math.log(Math.tan(Math.PI / 4 + 20.91 * RAD / 2));
  const project = (lng, lat) => ({x: R * lng * RAD - originX, y: originY - R * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2))});
  const unproject = (x, y) => ({lng:(x + originX) / R / RAD, lat:(2 * Math.atan(Math.exp((originY-y) / R)) - Math.PI/2) / RAD});
  const coast = data.coastline.map(([lng,lat]) => project(lng,lat));
  const bounds = {left:Math.min(...coast.map(p=>p.x)),right:Math.max(...coast.map(p=>p.x)),top:Math.min(...coast.map(p=>p.y)),bottom:Math.max(...coast.map(p=>p.y))};
  const bw = bounds.right - bounds.left, bh = bounds.bottom - bounds.top;
  const center = {x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
  const svg = $('vector-map'), stage = $('map-stage');
  let view, home, points = [], activeId = null, editingId = null, reference = null, draft = null;
  let picking = false, blockedStorage = false, toastTimer, downloadURL, raf;
  let projectRevision = null, saving = false, ready = false, formDirty = false;
  let explorer=null,exploringDeityId=null,highlightSignature='';
  let deityPlaceKeys=new Set();
  const projectMode = location.protocol !== 'file:';
  const cloudMode = document.documentElement.dataset.deployment === 'netlify';
  const storageTarget = cloudMode ? '云端' : '项目文件';
  const pins = new Map(), pointers = new Map();
  const labelSizes=new Map(),labelLeaders=$('label-leaders'),labelMeasure=document.createElement('div');
  labelMeasure.className='label-measurement';labelMeasure.setAttribute('aria-hidden','true');stage.append(labelMeasure);
  let labelTier=0,hoveredPin=null,focusedPin=null,labelFrame=null,labelContext='',wheelLabelTimer=null,hoverLeaveTimer=null,labelObstacleCache=[];
  let drag = null, pinch = null, gestureMoved = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let cameraFrame = null, cameraIntent = null, desktopRetainedWidth = 0;
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'p-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const status = text => { $('search-status').textContent = text; };
  const workspace = $('workspace');
  const mobileSearch = matchMedia('(max-width: 800px)');
  const searchPanel = document.querySelector('.search-panel');
  const searchButton = document.querySelector('.search-submit');
  function setSearchExpanded(expanded,focus=false){
    const open=mobileSearch.matches&&expanded;
    searchPanel.classList.toggle('is-expanded',open);
    workspace.classList.toggle('mobile-search-open',open);
    document.querySelector('.map-toolbar').inert=open;
    if(open){setUtility();if(explorer?.isOpen)explorer.suspend();}
    $('search-input').inert=mobileSearch.matches&&!open;
    searchButton.setAttribute('aria-label',mobileSearch.matches&&!open?'展开搜索':'搜索');
    if(mobileSearch.matches){searchButton.setAttribute('aria-expanded',String(open));searchButton.setAttribute('aria-controls','search-input');}
    else{searchButton.removeAttribute('aria-expanded');searchButton.removeAttribute('aria-controls');}
    if(mobileSearch.matches&&!open){
      $('search-feedback').hidden=true;
      if(searchPanel.contains(document.activeElement))document.activeElement.blur();
    }
    if(focus)(open?$('search-input'):searchButton).focus({preventScroll:true});
    if(view)schedulePinLayout(true);
  }
  mobileSearch.addEventListener('change',()=>setSearchExpanded(false));
  $('search-collapse').addEventListener('click',()=>setSearchExpanded(false,true));
  setSearchExpanded(false);
  let openPanel = null, panelTrigger = null;
  function setUtility(id=null,trigger=null,restoreFocus=false){
    if(id&&mobileSearch.matches){setSearchExpanded(false);if(explorer?.isOpen)explorer.suspend();}
    const previousTrigger=panelTrigger;
    for(const name of ['layers','data']){$(name+'-panel').hidden=id!==name+'-panel';$(name+'-toggle').setAttribute('aria-expanded',String(id===name+'-panel'));}
    $('administrative-key').setAttribute('aria-expanded',String(id==='layers-panel'));
    openPanel=id;panelTrigger=trigger;
    if(id){faith.dismissPreview();$(id).querySelector('button,input,summary')?.focus();}
    else if(restoreFocus)(previousTrigger?.hidden?$('layers-toggle'):previousTrigger)?.focus();
    if(view)schedulePinLayout(true);
  }
  function expandDetails(){workspace.classList.remove('sheet-collapsed');$('sheet-toggle').textContent='收起';$('sheet-toggle').setAttribute('aria-expanded','true');}
  function syncDetails(expand=false){
    const visible=!$('reference-section').hidden||!$('editor-section').hidden;
    if(visible&&explorer?.isOpen)explorer.suspend();
    $('detail-panel').hidden=!visible;workspace.classList.toggle('details-open',visible);
    if(expand){expandDetails();$('detail-content').scrollTop=0;setUtility();$('search-feedback').hidden=true;setSearchExpanded(false);}
  }
  for(const name of ['layers','data'])$(name+'-toggle').addEventListener('click',event=>setUtility(openPanel===name+'-panel'?null:name+'-panel',event.currentTarget));
  $('administrative-key').addEventListener('click',event=>setUtility(openPanel==='layers-panel'?null:'layers-panel',event.currentTarget));
  for(const button of document.querySelectorAll('[data-close-panel]'))button.addEventListener('click',()=>setUtility(null,null,true));
  $('save-indicator').addEventListener('click',()=>setUtility('data-panel',$('data-toggle')));
  $('sheet-toggle').addEventListener('click',()=>{
    const collapsed=workspace.classList.toggle('sheet-collapsed');
    $('sheet-toggle').textContent=collapsed?'展开':'收起';$('sheet-toggle').setAttribute('aria-expanded',String(!collapsed));faith.dismissPreview();
  });
  document.addEventListener('pointerdown',event=>{
    if(openPanel&&!$(openPanel).contains(event.target)&&!event.target.closest('#layers-toggle,#data-toggle,#save-indicator,#administrative-key,#cloud-login'))setUtility();
    if(!event.target.closest('.search-panel')){$('search-feedback').hidden=true;setSearchExpanded(false);}
  });
  $('search-input').addEventListener('input',()=>{if(!$('search-input').value.trim()){$('search-results').replaceChildren();status('');$('search-feedback').hidden=true;}});
  const pathData = (coordinates, closed=false) => coordinates.map(([lng,lat],i)=>{const p=project(lng,lat);return (i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2);}).join(' ')+(closed?' Z':'');
  const coastPath = pathData(data.coastline,true);
  $('coast').setAttribute('d',coastPath); $('island-clip-path').setAttribute('d',coastPath);
  function roadKind(type){
    if(/^(motorway|trunk|primary|secondary|tertiary)(?:_link)?$/.test(type))return 'main';
    if(['track','path','footway','cycleway','steps','bridleway'].includes(type))return 'path';
    if(['service','corridor'].includes(type))return 'minor';
    return 'local';
  }
  function geometryBounds(coordinates){
    const projected=coordinates.map(([lng,lat])=>project(lng,lat));
    return {projected,left:Math.min(...projected.map(p=>p.x)),right:Math.max(...projected.map(p=>p.x)),top:Math.min(...projected.map(p=>p.y)),bottom:Math.max(...projected.map(p=>p.y))};
  }
  function lineAnchor(projected){
    let length=0;const lengths=[];
    for(let i=1;i<projected.length;i++){const d=Math.hypot(projected[i].x-projected[i-1].x,projected[i].y-projected[i-1].y);lengths.push(d);length+=d;}
    let passed=0;
    for(let i=1;i<projected.length;i++){
      const d=lengths[i-1];if(passed+d>=length/2&&d){const a=projected[i-1],b=projected[i],t=(length/2-passed)/d;let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(angle>90)angle-=180;if(angle< -90)angle+=180;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle,length};}passed+=d;
    }
    return {...projected[0],angle:0,length};
  }
  function polygonCenter(projected){
    let area=0,x=0,y=0;
    for(let i=0,j=projected.length-1;i<projected.length;j=i++){const a=projected[j],b=projected[i],cross=a.x*b.y-b.x*a.y;area+=cross;x+=(a.x+b.x)*cross;y+=(a.y+b.y)*cross;}
    if(Math.abs(area)>1)return {x:x/(3*area),y:y/(3*area)};
    return {x:projected.reduce((n,p)=>n+p.x,0)/projected.length,y:projected.reduce((n,p)=>n+p.y,0)/projected.length};
  }
  const roads=data.roads.map(item=>{const geometry=geometryBounds(item.coordinates);return {...item,...geometry,kind:roadKind(item.type),label:item.name||item.ref||'',anchor:lineAnchor(geometry.projected)};});
  const clusters=data.residential.map(item=>{const geometry=geometryBounds(item.coordinates),centroid=polygonCenter(geometry.projected);return {...item,...geometry,...unproject(centroid.x,centroid.y),key:'cluster-'+item.id};});
  const clusterByKey=new Map(clusters.map(p=>[p.key,p]));
  const administrativeAreas=(data.administrativeAreas||[]).map(area=>({...area,...geometryBounds(area.coordinates)}));
  const administrativeById=new Map(administrativeAreas.map(area=>[area.id,area]));
  const placeById=new Map(data.places.map(p=>[p.id,p]));
  const administrativeLabels=new Map();
  const administrativePaths=new Map(),administrativeControls=new Map(),visibleAdministrativeAreas=new Set();
  function administrativeEnabled(areaId){return areaId?visibleAdministrativeAreas.has(areaId):visibleAdministrativeAreas.size>0;}
  function syncAdministrativeViewButton(){
    const enabled=administrativeEnabled(reference?.administrativeAreaId);
    $('administration-view').textContent=enabled?'隐藏范围示意':'查看范围示意';
    $('administration-view').setAttribute('aria-pressed',String(enabled));
  }
  function setAdministrativeLayer(area,enabled,focus=false){
    if(enabled)visibleAdministrativeAreas.add(area.id);else visibleAdministrativeAreas.delete(area.id);
    administrativeControls.get(area.id).checked=enabled;
    for(const path of administrativePaths.get(area.id)){path.classList.toggle('is-visible',enabled);path.style.opacity=enabled?'1':'0';}
    const visible=administrativeAreas.filter(item=>administrativeEnabled(item.id));
    $('administrative-layer').style.display='';
    $('administrative-key').hidden=!visible.length;
    $('administrative-key-name').textContent=visible.length===1?visible[0].committeeName:'行政范围 · '+visible.length+' 个';
    $('administrative-key').setAttribute('aria-label',(visible.length===1?visible[0].name+'范围示意':'行政范围，已显示 '+visible.length+' 个')+'，打开图层设置');
    syncAdministrativeViewButton();
    if(enabled&&focus)focusGeometry(area);
    else if(view)update();
  }
  function selectAdministrativeArea(area){
    if(area.officePlaceId){if(selectReference(placeById.get(area.officePlaceId)))setAdministrativeLayer(area,true,true);return;}
    if(saving||!mayLeaveEditor())return;
    closeEditor();clearReference();reference={kind:'administrative_area',placeKind:'administrative_area',administrativeAreaId:area.id};
    showReference(area.name,'依调查者指定的参考地点制作陆地范围示意；居委会驻地暂未确认。','',false,'社区 · 驻地待确认');
    renderAdministrativeInfo(reference);setAdministrativeLayer(area,true,true);
  }
  function renderAdministrativeInfo(p){
    const area=administrativeById.get(p.administrativeAreaId);
    $('administrative-context').hidden=false;
    $('administrative-member-kind').textContent=p.placeKind==='natural_village'?'自然村':p.placeKind==='administrative_seat'?'行政驻地':p.placeKind==='administrative_area'?'行政范围':p.kind==='survey'?'调查点位':p.kind==='road'?'道路':p.kind==='cluster'?'聚落':p.placeKind==='locality'?'地点':'参考地点';
    const committee=area?.committeeName||p.committeeName||'';
    $('administrative-affiliation').hidden=!committee;
    $('administrative-affiliation-prefix').textContent=['administrative_seat','administrative_area'].includes(p.placeKind)?'':'隶属于';
    $('parent-administration').textContent=committee;
    $('parent-administration').disabled=!area;
    $('administration-section').hidden=!area||!['administrative_seat','administrative_area'].includes(p.placeKind);
    if(!area)return;
    $('parent-administration').onclick=()=>selectAdministrativeArea(area);
    $('administration-name').textContent=area.committeeName;
    $('administration-kind').textContent=area.administrativeType==='community'?'社区':'行政村';
    $('administration-view').onclick=()=>setAdministrativeLayer(area,!administrativeEnabled(area.id),true);
    syncAdministrativeViewButton();
    $('administration-members').open=false;
    const villages=area.memberVillages.filter(member=>member.placeKind!=='locality').length,localities=area.memberVillages.length-villages;
    $('administration-members-summary').textContent=(area.officePlaceId?'已确认 ':'范围参考：')+[villages?villages+' 个自然村':'',localities?localities+' 个地点':''].filter(Boolean).join(' · ');
    $('administration-member-list').replaceChildren();
    for(const member of area.memberVillages){
      const button=document.createElement('button');button.type='button';button.textContent=member.name;
      button.addEventListener('click',()=>selectReference(placeById.get(member.placeId)));
      $('administration-member-list').append(button);
    }
  }
  function renderArchiveOverview(p){
    const visible=p.kind!=='road'&&p.kind!=='cluster';
    $('place-overview-section').hidden=!visible;$('field-notes-section').hidden=!visible;
    const introduction=[p.introduction,p.description,p.summary].find(value=>typeof value==='string'&&value.trim())||'';
    const id=p.id||(p.kind==='administrative_area'?'area:'+p.administrativeAreaId:null);
    archives.selectPlace(visible&&id?{id,kind:p.kind==='survey'?'survey':'reference',name:p.name||administrativeById.get(p.administrativeAreaId)?.name,introduction,note:p.note||''}:null);
  }
  function coverageLabelPositions(x,y,lw,lh){
    const steps=[-4,-3,-2,-1,0,1,2,3,4];
    return steps.flatMap(dx=>steps.map(dy=>({dx:dx*36,dy:dy*32}))).sort((a,b)=>Math.hypot(a.dx,a.dy)-Math.hypot(b.dx,b.dy)).map(({dx,dy})=>[x-lw/2+dx,y-lh/2+dy]);
  }
  function coverageContains(area,p){
    let inside=false;const ring=area.coordinates;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>p.lat)!==(yj>p.lat)&&p.lng<(xj-xi)*(p.lat-yi)/(yj-yi)+xi)inside=!inside;}
    return inside&&onIsland(p.lng,p.lat);
  }
  function layoutAdministrativeLabels(occupied){
    const {w,h}=dimensions();
    for(const area of administrativeAreas){
      const label=administrativeLabels.get(area.id);label.hidden=true;
      if(!administrativeEnabled(area.id))continue;
      const pt=project(...area.labelAnchor),x=(pt.x-view.x)/view.w*w,y=(pt.y-view.y)/view.h*h,lw=160,lh=47;
      const positions=coverageLabelPositions(x,y,lw,lh);
      const chosen=positions.find(([lx,ly])=>lx>8&&ly>8&&lx+lw<w-8&&ly+lh<h-8&&!occupied.some(r=>intersects({x:lx,y:ly,w:lw,h:lh},r,6))&&coverageContains(area,unproject(view.x+(lx+lw/2)*view.w/w,view.y+(ly+lh/2)*view.h/h)));
      if(chosen){const [lx,ly]=chosen;label.style.left=lx+'px';label.style.top=ly+'px';label.hidden=false;occupied.push({x:lx,y:ly,w:lw,h:lh});}
    }
  }
  const roadGroups=new Map();
  for(const road of roads){if(!road.label)continue;const key=road.label;let group=roadGroups.get(key);if(!group){group={label:road.label,ref:road.ref||'',roads:[]};roadGroups.set(key,group);}group.roads.push(road);}
  for(const group of roadGroups.values())group.roads.sort((a,b)=>(b.kind==='main')-(a.kind==='main')||b.anchor.length-a.anchor.length);
  function drawFeatures(items,id,kind){
    const group=$(id),fragment=document.createDocumentFragment();
    for(const item of items){
      const path=document.createElementNS(NS,'path');path.setAttribute('d',pathData(item.coordinates,kind==='building'||kind==='residential'));path.setAttribute('class',kind+(kind==='road'?' '+item.kind:''));
      if(kind==='residential'){path.dataset.clusterKey=item.key;path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-label',(item.name||'未命名聚落')+'，查看轮廓');path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();selectCluster(item);}});}
      if(item.name||kind==='residential'){const title=document.createElementNS(NS,'title');title.textContent=item.name||'未命名聚落轮廓 · 点击记录';path.append(title);}
      if(kind==='road')path.dataset.roadId=String(item.id);
      fragment.append(path);
    }
    group.append(fragment);
  }
  drawFeatures(clusters,'residential-layer','residential');drawFeatures(data.waters,'water-layer','water');drawFeatures(roads,'road-layer','road');drawFeatures(data.buildings,'building-layer','building');
  for(const area of administrativeAreas){
    // Composite opaque fills once so overlapping range sketches retain one tint.
    const geometry=pathData(area.coordinates,true),paths=[];
    for(const [group,className] of [['administrative-fill-layer','administrative-coverage'],['administrative-boundary-layer','administrative-boundary']]){
      const path=document.createElementNS(NS,'path');path.setAttribute('class',className);path.setAttribute('d',geometry);
      path.dataset.administrativeAreaId=area.id;path.style.opacity='0';$(group).append(path);paths.push(path);
    }
    administrativePaths.set(area.id,paths);
    const label=document.createElement('button');label.type='button';label.className='administrative-label';label.hidden=true;
    label.setAttribute('aria-label',area.name+'范围示意，'+area.committeeName);
    const title=document.createElement('strong'),subtitle=document.createElement('small');title.textContent=area.name;subtitle.textContent=(area.officeCaption||area.committeeName)+' · 范围示意';label.append(title,subtitle);
    label.addEventListener('click',()=>selectAdministrativeArea(area));$('administrative-labels').append(label);administrativeLabels.set(area.id,label);
    const control=document.createElement('label');control.className='layer-toggle';
    const input=document.createElement('input');input.type='checkbox';input.id='show-admin-'+area.id;
    input.addEventListener('change',()=>setAdministrativeLayer(area,input.checked,input.checked));
    control.append(input,document.createTextNode(area.committeeName));$('administrative-toggles').append(control);administrativeControls.set(area.id,input);
  }
  function onIsland(lng,lat){let inside=false;const ring=data.coastline;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>lat)!==(yj>lat)&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
  function notify(text,undo){clearTimeout(toastTimer);const toast=$('toast');toast.replaceChildren(document.createTextNode(text));if(undo){const b=document.createElement('button');b.textContent='撤销';b.addEventListener('click',()=>{undo();toast.hidden=true;});toast.append(b);}toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},undo?12000:4500);}
  function dimensions(){return {w:Math.max(stage.clientWidth,1),h:Math.max(stage.clientHeight,1)};}
  function cameraViewport(){
    const {w,h}=dimensions();let top=0;
    if(mobileSearch.matches){
      const stageTop=stage.getBoundingClientRect().top;
      const controlsBottom=Math.max(...[document.querySelector('.map-toolbar'),$('search-form')].map(node=>node?.getBoundingClientRect().bottom||stageTop));
      // Reserve framing space only: the map canvas still extends behind the controls.
      top=Math.min(100,Math.max(76,controlsBottom-stageTop+14),Math.max(0,h-88));
    }else{
      const stageTop=stage.getBoundingClientRect().top;
      const controlsBottom=Math.max(...[document.querySelector('.map-toolbar'),$('search-form')].map(node=>node?.getBoundingClientRect().bottom||stageTop));
      top=Math.min(Math.max(0,controlsBottom-stageTop+16),Math.max(0,h-120));
    }
    return {w,h,top,ratio:w/(h-top)};
  }
  function makeHome(){
    const {w,h,top,ratio}=cameraViewport();let width=bw*1.17,height=bh*1.17;
    if(width/height<ratio)width=height*ratio;else height=width/ratio;
    const fullHeight=width*h/w;
    return {x:center.x-width/2,y:center.y-fullHeight/2-top*width/w/2,w:width,h:fullHeight};
  }
  function cameraWidthLimits(){
    const retained=mobileSearch.matches?0:desktopRetainedWidth;
    return {min:retained?Math.min(home.w/32,retained):home.w/32,max:Math.max(home.w,retained)};
  }
  function cancelCamera(){if(cameraFrame!==null)cancelAnimationFrame(cameraFrame);cameraFrame=null;cameraIntent=null;stage.classList.remove('is-camera-moving');}
  function clampView(){
    const {w,h}=dimensions(),centerX=view.x+view.w/2,centerY=view.y+view.h/2;
    const limits=cameraWidthLimits();view.w=Math.max(limits.min,Math.min(limits.max,view.w));view.h=view.w*h/w;
    const cx=Math.max(bounds.left,Math.min(bounds.right,centerX)),cy=Math.max(bounds.top,Math.min(bounds.bottom,centerY));
    view.x=cx-view.w/2;view.y=cy-view.h/2;
  }
  function update(){
    faith.dismissPreview();
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=null;clampView();svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
      const zoom=home.w/view.w;svg.classList.toggle('detail-minor',zoom>=1.7);svg.classList.toggle('detail-paths',zoom>=2.7);
      layoutPins();drawScale();
    });
  }
  function intentView(intent){
    const {w,h,top,ratio}=cameraViewport(),fullRatio=w/h;
    if(intent.type==='home')return {...home};
    if(intent.type==='view'){const v=intent.view;return {x:v.x,y:v.y+v.h/2-v.w/fullRatio/2,w:v.w,h:v.w/fullRatio};}
    let cx,cy,width;
    if(intent.type==='point'){
      const point=project(intent.point.lng,intent.point.lat);cx=point.x;cy=point.y;width=Math.min(home.w,Math.max(bw*.32,1800));
    }else{
      const f=intent.feature;cx=(f.left+f.right)/2;cy=(f.top+f.bottom)/2;
      width=Math.min(home.w,Math.max((f.right-f.left)*1.45,(f.bottom-f.top)*1.45*ratio,home.w/16));
    }
    return {x:cx-width/2,y:cy-width/fullRatio/2-top*width/w/2,w:width,h:width/fullRatio};
  }
  function flyTo(intent,duration){
    cancelCamera();const start={...view},started=performance.now();cameraIntent=intent;
    if(reducedMotion.matches){view=intentView(intent);cameraIntent=null;update();return;}
    stage.classList.add('is-camera-moving');
    const tick=now=>{
      const goal=intentView(intent),t=Math.min(1,(now-started)/duration),eased=1-Math.pow(1-t,3);
      const cx=start.x+start.w/2+(goal.x+goal.w/2-start.x-start.w/2)*eased;
      const cy=start.y+start.h/2+(goal.y+goal.h/2-start.y-start.h/2)*eased;
      const width=Math.exp(Math.log(start.w)+(Math.log(goal.w)-Math.log(start.w))*eased),{w,h}=dimensions();
      view={x:cx-width/2,y:cy-width*h/w/2,w:width,h:width*h/w};update();
      if(t<1)cameraFrame=requestAnimationFrame(tick);else{cameraFrame=null;cameraIntent=null;stage.classList.remove('is-camera-moving');schedulePinLayout();}
    };
    cameraFrame=requestAnimationFrame(tick);
  }
  function homeView(animate=false){explorer?.cancelAutoFocus();home=makeHome();if(!view||!animate){cancelCamera();view={...home};update();}else flyTo({type:'home'},600);}
  function zoomAt(factor,x,y,animate=false){
    explorer?.cancelAutoFocus();
    const source=animate&&cameraIntent?.zoom?cameraIntent.view:view;
    cancelCamera();const {w,h}=dimensions();x??=w/2;y??=h/2;
    const limits=cameraWidthLimits(),width=Math.max(limits.min,Math.min(limits.max,source.w/factor)),scale=width/source.w;
    const next={x:source.x+x/w*source.w*(1-scale),y:source.y+y/h*source.h*(1-scale),w:width,h:source.h*scale};
    if(animate)flyTo({type:'view',view:next,zoom:true},220);else{view=next;update();}
  }
  function focusPoint(point){flyTo({type:'point',point},500);}
  function focusGeometry(feature){flyTo({type:'geometry',feature},560);}
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches&&cameraIntent){const goal=intentView(cameraIntent);cancelCamera();view=goal;update();}});
  function drawScale(){const metersPerPixel=view.w/dimensions().w*Math.cos(20.91*RAD),target=metersPerPixel*90;const power=10**Math.floor(Math.log10(target));const value=[1,2,5,10].map(n=>n*power).filter(n=>n<=target).at(-1)||power;$('scale-text').textContent=value>=1000?(value/1000)+' km':Math.round(value)+' m';$('scale-line').style.width=(value/metersPerPixel)+'px';}
  function rebuildPins(){
    faith.dismissPreview();
    const entries=[...data.places.map(p=>({...p,key:'ref-'+p.id,saved:false})),...points.map(p=>({...p,key:'saved-'+p.id,saved:true}))];
    if(draft)entries.push({...draft,name:'待保存',key:'draft',draft:true});
    const wanted=new Set(entries.map(p=>p.key));
    for(const [key,item] of pins){if(!wanted.has(key)){item.button.remove();item.label.remove();item.leader?.remove();pins.delete(key);}}
    for(const p of entries){
      let item=pins.get(p.key);
      if(!item){
        const button=document.createElement('button'),label=document.createElement('span');
        button.type='button';button.className='map-point';label.className='place-label';label.setAttribute('aria-hidden','true');
        const select=()=>{const current=pins.get(p.key).point;if(current.draft)return;if(picking){setPickedLocation(current.lng,current.lat);return;}if(current.saved)selectPoint(current);else selectReference(current);};
        button.addEventListener('click',event=>{
          if(pins.get(p.key).point.draft)return;
          if(!event.detail){select();return;}
          // Transparent hit areas can overlap. Choose the nearest visible dot.
          let closest=null,distance=Infinity;
          for(const candidate of pins.values()){
            if(candidate.button.hidden||candidate.point.draft)continue;
            const box=candidate.button.getBoundingClientRect(),d=Math.hypot(event.clientX-(box.left+box.width/2),event.clientY-(box.top+box.height/2));
            if(d<distance){distance=d;closest=candidate.point;}
          }
          if(closest){if(picking)setPickedLocation(closest.lng,closest.lat);else if(closest.saved)selectPoint(closest);else selectReference(closest);}
        });
        label.addEventListener('pointerdown',event=>event.stopPropagation());
        label.addEventListener('click',select);
        for(const node of [button,label]){
          node.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hoverLeaveTimer);hoveredPin=p.key;schedulePinLayout();});
          node.addEventListener('pointerleave',event=>{if(button.contains(event.relatedTarget)||label.contains(event.relatedTarget))return;clearTimeout(hoverLeaveTimer);hoverLeaveTimer=setTimeout(()=>{if(hoveredPin===p.key){hoveredPin=null;schedulePinLayout();}},90);});
        }
        button.addEventListener('focus',()=>{focusedPin=p.key;schedulePinLayout();});
        button.addEventListener('blur',()=>{if(focusedPin===p.key){focusedPin=null;schedulePinLayout();}});
        faith.bindPreview(button,label,()=>{const current=pins.get(p.key).point;return {id:current.id,kind:current.saved?'survey':'reference',name:current.name};});
        $('map-labels').append(button,label);item={button,label};pins.set(p.key,item);
      }
      item.point=p;item.projected=project(p.lng,p.lat);item.hasFaith=faith.hasRecords(p.id,p.saved?'survey':'reference');
      item.button.dataset.placeKind=p.placeKind||'reference';item.label.dataset.placeKind=p.placeKind||'reference';
      item.button.dataset.placeKey=p.key;item.label.dataset.placeKey=p.key;
      const administrative=p.placeKind==='administrative_seat',member=isAdministrativeMember(p);
      item.button.setAttribute('aria-label',p.name+(administrative?'，行政驻地，'+p.committeeName:member?'，'+(p.placeKind==='locality'?'地点':'自然村')+'，'+p.committeeName:p.saved?'，调查点位':'，参考地名')+(item.hasFaith?'，有信仰记录':''));
      if(item.hasFaith)item.button.removeAttribute('title');else item.button.title=administrative?p.committeeName+' · 行政驻地':p.name;
      item.label.replaceChildren(document.createTextNode(p.name));
      if(administrative){const caption=document.createElement('small');caption.textContent=p.administrativeCaption||p.committeeName;item.label.append(caption);}
      if(administrative&&!item.leader){item.leader=document.createElementNS(NS,'line');item.leader.style.display='none';labelLeaders.append(item.leader);}
    }
    rankPinDistribution();labelContext='';
    if(view)update();
  }
  const intersects=(a,b,gap=3)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
  function schedulePinLayout(invalidate=false){
    if(invalidate)labelContext='';
    if(!view||labelFrame!==null)return;
    labelFrame=requestAnimationFrame(()=>{labelFrame=null;layoutPins();});
  }
  // These ranks are presentation-only: spread early labels across the island.
  function rankPinDistribution(){
    const all=[...pins.values()],anchors=all.filter(item=>item.point.placeKind==='administrative_seat').map(item=>item.projected);
    if(!anchors.length)anchors.push(center);
    const remaining=all.filter(item=>item.point.placeKind!=='administrative_seat').sort((a,b)=>a.point.key.localeCompare(b.point.key));
    for(const item of remaining)item.spreadDistance=Math.min(...anchors.map(p=>(item.projected.x-p.x)**2+(item.projected.y-p.y)**2));
    let rank=0;
    while(remaining.length){
      let best=0;for(let i=1;i<remaining.length;i++)if(remaining[i].spreadDistance>remaining[best].spreadDistance)best=i;
      const [chosen]=remaining.splice(best,1);chosen.spreadRank=rank++;
      for(const item of remaining)item.spreadDistance=Math.min(item.spreadDistance,(item.projected.x-chosen.projected.x)**2+(item.projected.y-chosen.projected.y)**2);
    }
  }
  function pinPriority(item){
    const p=item.point;
    return p.draft?70:(p.saved?p.id===activeId:reference?.id===p.id)?60:p.key===focusedPin?56:p.key===hoveredPin?55:deityPlaceKeys.has(p.key)?52:p.placeKind==='administrative_seat'?50:p.saved?40:p.placeKind==='natural_village'?20:10;
  }
  function deityPinClass(p){return deityPlaceKeys.has(p.key)?' is-deity-linked':exploringDeityId&&deityPlaceKeys.size?' is-deity-muted':'';}
  function updateLabelTier(zoom){
    if(labelTier===0&&zoom>=1.38)labelTier=1;
    if(labelTier===1&&zoom>=2.6)labelTier=2;
    if(labelTier===2&&zoom<2.32)labelTier=1;
    if(labelTier===1&&zoom<1.23)labelTier=0;
    stage.dataset.labelLevel=['island','regional','local'][labelTier];
  }
  function labelObstacles(){
    const origin=stage.getBoundingClientRect(),boxes=[];
    for(const node of document.querySelectorAll('.search-panel,.map-toolbar,.utility-panel,.north,.zoom-controls,.map-footer,#administrative-key,#pick-message,#detail-panel,#deity-explorer')){
      if(node.hidden||!node.getClientRects().length)continue;
      const rect=node.getBoundingClientRect(),x=Math.max(0,rect.left-origin.left),y=Math.max(0,rect.top-origin.top),right=Math.min(origin.width,rect.right-origin.left),bottom=Math.min(origin.height,rect.bottom-origin.top);
      if(right>x&&bottom>y)boxes.push({x,y,w:right-x,h:bottom-y});
    }
    return boxes;
  }
  function measurePinLabels(positioned,w){
    const fragment=document.createDocumentFragment(),pending=[];
    for(const entry of positioned){
      const {item,active,emphasized,administrative}=entry,p=item.point,member=isAdministrativeMember(p);
      const classes='place-label'+(p.saved?' is-saved':'')+(active?' is-active':'')+(emphasized?' is-emphasized':'')+(item.hasFaith?' has-faith':'')+(administrative?' is-administrative':'')+(member?' is-member':'')+(member&&administrativeEnabled(p.administrativeAreaId)?' is-member-visible':'')+deityPinClass(p);
      item.label.className=classes+(item.label.classList.contains('is-visible')?' is-visible':'');item.label.hidden=false;
      const maxWidth=Math.min(administrative?180:active?260:220,Math.max(60,w-20));item.label.style.setProperty('--label-max-width',maxWidth+'px');
      entry.sizeKey=[p.key,item.label.textContent,classes,maxWidth].join('|');
      if(!labelSizes.has(entry.sizeKey)){
        const clone=item.label.cloneNode(true);clone.className=classes;clone.style.left='0';clone.style.top='0';fragment.append(clone);pending.push({clone,key:entry.sizeKey});
      }
    }
    if(pending.length){
      labelMeasure.replaceChildren(fragment);
      for(const {clone,key} of pending)labelSizes.set(key,{w:Math.ceil(clone.offsetWidth),h:Math.ceil(clone.offsetHeight)});
      labelMeasure.replaceChildren();
    }
    for(const entry of positioned)entry.size=labelSizes.get(entry.sizeKey);
  }
  function pinLabelPositions(x,y,lw,lh,administrative){
    const gap=administrative?11:10;
    const positions=[[x+gap,y-lh/2],[x-lw-gap,y-lh/2],[x-lw/2,y-lh-gap],[x-lw/2,y+gap],[x+gap,y-lh-gap],[x-lw-gap,y-lh-gap],[x+gap,y+gap],[x-lw-gap,y+gap]];
    if(administrative)for(const distance of [22,36,50])positions.push([x+distance,y-lh/2],[x-lw-distance,y-lh/2],[x-lw/2,y-lh-distance],[x-lw/2,y+distance]);
    return positions.map(([lx,ly],slot)=>({x:lx,y:ly,w:lw,h:lh,slot}));
  }
  function showPinLabel(item,box,x,y){
    item.label.classList.toggle('is-visible',!!box);
    if(item.leader)item.leader.style.display='none';
    if(!box)return;
    item.label.style.left=box.x+'px';item.label.style.top=box.y+'px';
    if(item.leader){
      const ex=Math.max(box.x,Math.min(box.x+box.w,x)),ey=Math.max(box.y,Math.min(box.y+box.h,y)),distance=Math.hypot(ex-x,ey-y);
      if(distance>18){item.leader.setAttribute('x1',x+(ex-x)*7/distance);item.leader.setAttribute('y1',y+(ey-y)*7/distance);item.leader.setAttribute('x2',ex);item.leader.setAttribute('y2',ey);item.leader.style.display='';}
    }
  }
  function layoutPins(){
    const {w,h}=dimensions(),zoom=home.w/view.w,showNames=$('show-labels').checked;
    const moving=stage.classList.contains('is-dragging')||stage.classList.contains('is-camera-moving')||wheelLabelTimer!==null;
    if(!moving||!labelContext)updateLabelTier(zoom);
    const context=[w,h,labelTier,activeId,reference?.id,hoveredPin,focusedPin,showNames,openPanel,searchPanel.className,visibleAdministrativeAreas.size,exploringDeityId].join('|');
    const frozen=moving&&labelContext===context;
    if(!frozen)labelObstacleCache=labelObstacles();
    const occupied=labelObstacleCache.slice(),anchors=[],markerBoxes=[];
    const positioned=[...pins.values()].sort((a,b)=>pinPriority(b)-pinPriority(a)||(a.spreadRank??-1)-(b.spreadRank??-1)||a.point.key.localeCompare(b.point.key)).map(item=>{
      const p=item.point,pt=item.projected;
      return {item,x:(pt.x-view.x)/view.w*w,y:(pt.y-view.y)/view.h*h,active:p.saved?p.id===activeId:reference?.id===p.id,emphasized:p.key===hoveredPin||p.key===focusedPin,administrative:p.placeKind==='administrative_seat'};
    });
    measurePinLabels(positioned,w);labelLeaders.setAttribute('viewBox',`0 0 ${w} ${h}`);
    for(const entry of positioned){
      const {item,x,y,active,administrative}=entry,p=item.point;entry.visible=x>=0&&x<=w&&y>=0&&y<=h;
      item.button.hidden=!entry.visible;item.button.style.left=x+'px';item.button.style.top=y+'px';
      item.button.className='map-point'+(p.saved?' is-saved':'')+(p.draft?' is-draft':'')+(active?' is-active':'')+(item.hasFaith?' has-faith':'')+(administrative?' is-administrative':'')+(isAdministrativeMember(p)?' is-member':'')+deityPinClass(p);
      if(entry.visible)markerBoxes.push({x:x-5,y:y-5,w:10,h:10,key:p.key,important:administrative||active||p.saved});
    }
    const baseSpacing=w<600?66:100;
    const spacing=labelTier===0?baseSpacing/Math.max(1,zoom):labelTier===1?Math.max(0,baseSpacing/1.38*(2.6-zoom)/1.22):0;
    for(const entry of positioned){
      const {item,x,y,active,emphasized,administrative,size}=entry,p=item.point,forced=active||emphasized||p.draft;
      const linked=deityPlaceKeys.has(p.key),eligible=entry.visible&&(showNames||forced)&&(forced||linked||administrative||p.saved||p.placeKind==='natural_village'||labelTier>0);
      let chosen=null;
      if(eligible&&(!frozen||item.layoutVisible||forced)){
        const positions=pinLabelPositions(x,y,size.w,size.h,administrative),last=item.labelSlot;
        const ordered=last===undefined?positions:[positions[last],...positions.filter(box=>box.slot!==last)].filter(Boolean);
        const within=box=>box.x>=5&&box.y>=5&&box.x+box.w<=w-5&&box.y+box.h<=h-5;
        const free=box=>within(box)&&!occupied.some(r=>intersects(box,r,4));
        const dense=!forced&&!linked&&!administrative&&!p.saved&&anchors.some(a=>Math.hypot(a.x-x,a.y-y)<spacing);
        if(!dense){
          const candidates=frozen&&last!==undefined?[positions[last]]:ordered;
          chosen=candidates.find(box=>free(box)&&!markerBoxes.some(r=>r.key!==p.key&&intersects(box,r,1)));
          if(!chosen&&administrative&&!frozen)chosen=ordered.find(box=>free(box)&&!markerBoxes.some(r=>r.key!==p.key&&r.important&&intersects(box,r,1)));
          if(!chosen&&forced){
            const alternatives=ordered.map(box=>({...box,x:Math.max(5,Math.min(w-size.w-5,box.x)),y:Math.max(5,Math.min(h-size.h-5,box.y))}));
            chosen=alternatives.find(free)||alternatives.sort((a,b)=>occupied.filter(r=>intersects(a,r)).length-occupied.filter(r=>intersects(b,r)).length)[0];
          }
        }
      }
      showPinLabel(item,chosen,x,y);
      if(!frozen){item.layoutVisible=!!chosen;if(chosen)item.labelSlot=chosen.slot;}
      if(chosen){occupied.push(chosen);anchors.push({x,y});}
    }
    labelContext=context;
    occupied.push(...markerBoxes);layoutAdministrativeLabels(occupied);
    layoutRoadNames(occupied);
    faith.repositionPreview();
  }
  function roadPlacements(viewport,w,h,occupied,fontSize=10,allDetail=false){
    const scale=w/viewport.w,placements=[];
    for(const group of roadGroups.values()){
      const lw=Array.from(group.label).reduce((n,c)=>n+(c.charCodeAt(0)>255?fontSize:fontSize*.6),8),lh=fontSize+7;
      for(const road of group.roads){
        if(!allDetail&&labelTier===0&&road.kind!=='main')continue;
        if(!allDetail&&((road.kind==='minor'&&home.w/viewport.w<1.7)||(road.kind==='path'&&home.w/viewport.w<2.7)))continue;
        if(road.kind!=='main'&&scale*road.anchor.length<lw*1.8)continue;
        const {x:mx,y:my,angle}=road.anchor,x=(mx-viewport.x)*scale,y=(my-viewport.y)*h/viewport.h;
        const radians=angle*RAD,rw=Math.abs(lw*Math.cos(radians))+Math.abs(lh*Math.sin(radians)),rh=Math.abs(lw*Math.sin(radians))+Math.abs(lh*Math.cos(radians));
        const box={x:x-rw/2,y:y-rh/2,w:rw,h:rh};
        if(box.x<8||box.y<8||box.x+box.w>w-8||box.y+box.h>h-8||road.anchor.length*scale<lw+20||occupied.some(r=>intersects(box,r,5)))continue;
        occupied.push(box);placements.push({road,label:group.label,x,y,angle});break;
      }
    }
    return placements;
  }
  const roadLabelNodes=new Map();
  function layoutRoadNames(occupied){
    const layer=$('road-labels'),{w,h}=dimensions(),wanted=new Set();
    if($('show-road-labels').checked)for(const item of roadPlacements(view,w,h,occupied)){
      wanted.add(item.label);let label=roadLabelNodes.get(item.label);
      if(!label){label=document.createElement('span');label.textContent=item.label;layer.append(label);roadLabelNodes.set(item.label,label);}
      label.hidden=false;label.className='road-label '+item.road.kind;label.style.left=item.x+'px';label.style.top=item.y+'px';label.style.transform=`translate(-50%,-50%) rotate(${item.angle}deg)`;
    }
    for(const [key,label] of roadLabelNodes)if(!wanted.has(key))label.hidden=true;
  }
  function isAdministrativeMember(p){return p.placeKind==='natural_village'||p.placeKind==='locality';}
  function validPoint(p){return p&&typeof p.id==='string'&&p.id.length<=120&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=100&&Number.isFinite(p.lat)&&p.lat>=-90&&p.lat<=90&&Number.isFinite(p.lng)&&p.lng>=-180&&p.lng<=180&&(p.source===undefined||typeof p.source==='string'&&p.source.length<=200)&&(p.note===undefined||typeof p.note==='string'&&p.note.length<=5000);}
  function cleanPoint(p){return {id:p.id,name:p.name.trim(),lat:p.lat,lng:p.lng,source:p.source||'',note:p.note||'',createdAt:typeof p.createdAt==='string'?p.createdAt:new Date().toISOString(),updatedAt:typeof p.updatedAt==='string'?p.updatedAt:new Date().toISOString()};}
  function storageStatus(text,error=false){$('storage-status').hidden=false;$('storage-status').textContent=text;$('storage-status').classList.toggle('error',error);const indicator=$('save-indicator');indicator.textContent=error?'保存需检查':text.startsWith('正在保存')?'保存中…':text.startsWith('正在读取')?'读取中…':text.startsWith('已保存')?'已保存':'已同步';indicator.title=text;indicator.classList.toggle('is-error',error);}
  function enableEditing(){for(const id of ['add-point','use-reference','delete-point','import-button'])$(id).disabled=!ready||saving;$('point-form').querySelector('button[type=submit]').disabled=!ready||saving||blockedStorage;$('point-form').inert=saving;$('close-editor').disabled=saving;}
  function cache(next,projectSaved){try{localStorage.setItem(STORE,JSON.stringify({version:1,points:next,projectSaved}));return true;}catch{return false;}}
  function projectState(obj){if(obj?.version!==1||!Number.isInteger(obj.revision)||!Array.isArray(obj.points)||!obj.points.every(validPoint)||new Set(obj.points.map(p=>p.id)).size!==obj.points.length)throw Error('项目点位文件格式无效，未覆盖记录。');return {...obj,points:obj.points.map(cleanPoint)};}
  async function requestProject(options){const response=await (window.NaozhouCloud?.request || fetch)('./api/points',{cache:'no-store',...options});const obj=await response.json();if(!response.ok){if(response.status===409){const current=projectState(obj);projectRevision=current.revision;points=current.points;renderPoints();throw Error('另一个页面已更新记录。当前填写内容仍保留，请再次点击保存。');}throw Error(obj.error||'项目文件暂时无法读写。');}return projectState(obj);}
  async function load(){
    enableEditing();storageStatus('正在读取调查记录…');let cached;
    try{const text=localStorage.getItem(STORE);if(text){cached=JSON.parse(text);if(cached.version!==1||!Array.isArray(cached.points)||!cached.points.every(validPoint))throw Error();points=cached.points.map(cleanPoint);}}
    catch{blockedStorage=true;storageStatus('浏览器旧记录无法读取，原数据已保留；请导入有效备份恢复。',true);}
    if(projectMode){
      try{
        const saved=await requestProject();projectRevision=saved.revision;points=saved.points;
        // Older browser records migrate once. A stale cache never replaces the project file.
        if(cached&&!cached.projectSaved&&!blockedStorage){const merged=new Map(points.map(p=>[p.id,p]));const deleted=new Set(saved.deletedIds||[]);let changed=false;for(const raw of cached.points){const p=cleanPoint(raw),old=merged.get(p.id);if(!deleted.has(p.id)&&(!old||Date.parse(p.updatedAt)>Date.parse(old.updatedAt))){merged.set(p.id,p);changed=true;}}if(changed){const result=await requestProject({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:projectRevision,points:[...merged.values()]})});projectRevision=result.revision;points=result.points;}}
        const cachedOK=blockedStorage?false:cache(points,true);storageStatus(blockedStorage?'项目记录已读取；浏览器旧记录异常，请先导出备份。':`已读取${storageTarget} · ${points.length} 个点位`+(cachedOK?'':' · 浏览器备用存储不可用'),blockedStorage);
      }catch(err){storageStatus('未连接项目保存：'+err.message+' 当前记录可导出备份。',true);}
    }else if(!blockedStorage)storageStatus('直接打开文件：仅保存到当前浏览器。请用「打开地图.cmd」启用项目文件保存。',true);
    ready=true;enableEditing();renderPoints();
  }
  async function store(next){
    if(blockedStorage||saving||!ready)return false;saving=true;enableEditing();
    try{
      if(projectMode){if(projectRevision===null)throw Error(cloudMode?'云端资料尚未读取，请刷新后重试。':'请通过「打开地图.cmd」启动本地服务，再重新打开地图。');storageStatus(`正在保存到${storageTarget}…`);const saved=await requestProject({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:projectRevision,points:next})});projectRevision=saved.revision;points=saved.points;const cachedOK=cache(points,true);storageStatus(`已保存到${storageTarget} · ${points.length} 个点位`+(cachedOK?'':' · 浏览器备用存储不可用'));}
      else{if(!cache(next,false))throw Error('浏览器存储不可用，请导出备份。');points=next;storageStatus('已保存到当前浏览器；请导出 GeoJSON 备份。',true);}
      return true;
    }catch(err){storageStatus('保存未完成：'+err.message,true);notify('保存未完成，填写内容仍保留。');return false;}
    finally{saving=false;enableEditing();}
  }
  function resultButton(name,detail,action){const b=document.createElement('button');b.type='button';b.className='result-button';const strong=document.createElement('strong');strong.textContent=name;b.append(strong);if(detail){const span=document.createElement('span');span.textContent=detail;b.append(span);}b.addEventListener('click',action);return b;}
  function renderPoints(){const list=$('point-list');list.replaceChildren();$('point-count').textContent=points.length+' 个';$('saved-points-section').hidden=!points.length;for(const p of points){const b=resultButton(p.name,`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`,()=>selectPoint(p));b.setAttribute('aria-current',String(p.id===activeId));list.append(b);}rebuildPins();}
  function mayLeaveEditor(){return !faith.saving&&!archives.saving&&(!(formDirty&&!$('editor-section').hidden)&&!faith.dirty&&!archives.dirty||window.confirm('当前填写内容尚未保存。要放弃填写并继续吗？'));}
  function clearReference(){faith.clearVillage();archives.clear();reference=null;hoveredPin=null;focusedPin=null;$('reference-section').hidden=true;$('administrative-context').hidden=true;$('administration-section').hidden=true;$('place-overview-section').hidden=true;$('field-notes-section').hidden=true;for(const path of svg.querySelectorAll('.is-selected'))path.classList.remove('is-selected');syncDetails();}
  function reviewText(p){const review=p.placeKind==='administrative_seat'?'行政驻地 · 位置待核对':p.locationReview?.status==='field_identified'?'实地指认':'待核对';return p.locationHint?p.locationHint+' · '+review:review;}
  function placeDescription(p){return p.placeKind==='administrative_seat'?p.committeeName+' · 行政驻地':isAdministrativeMember(p)?p.committeeName+' · '+(p.placeKind==='locality'?'地点':'自然村')+(p.locationHint?' · '+p.locationHint:''):reviewText(p);}
  function showReference(name,source,coordinates,canUse=true,review='待核对'){$('reference-section').hidden=false;$('reference-name').textContent=name;$('reference-review').textContent=review;$('reference-source').textContent=source;$('reference-coordinates').textContent=coordinates;$('use-reference').hidden=!canUse;$('reference-more').open=false;renderAdministrativeInfo(reference||{});renderArchiveOverview(reference||{});syncDetails(true);}
  function selectReference(p){if(!p||saving||!mayLeaveEditor())return false;closeEditor();clearReference();reference={...p,kind:'place'};showReference(p.name,`名称：${p.nameSource}；位置：${p.coordinateSource}。`+(p.placeKind==='administrative_seat'?' 行政驻地点，不作为独立自然村。':''),`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`,true,reviewText(p));faith.selectVillage({id:p.id,kind:'reference',name:p.name});focusPoint(p);layoutPins();return true;}
  function selectCluster(p){
    if(saving||!mayLeaveEditor())return;closeEditor();clearReference();reference={...p,kind:'cluster'};
    showReference(p.name||'未命名聚落',p.sourceDescription||'OpenStreetMap 聚落轮廓，不代表村界。名称待现场核对。',`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · 轮廓中心，近似`);
    for(const path of $('residential-layer').children)if(path.dataset.clusterKey===p.key)path.classList.add('is-selected');focusGeometry(p);layoutPins();
  }
  function selectRoad(group){
    if(saving||!mayLeaveEditor())return;closeEditor();clearReference();reference={kind:'road'};
    const extent={left:Math.min(...group.roads.map(p=>p.left)),right:Math.max(...group.roads.map(p=>p.right)),top:Math.min(...group.roads.map(p=>p.top)),bottom:Math.max(...group.roads.map(p=>p.bottom))};
    showReference(group.label,'OpenStreetMap 道路'+(group.ref?' · '+group.ref:''),'',false);
    const ids=new Set(group.roads.map(p=>String(p.id)));for(const path of $('road-layer').children)if(ids.has(path.dataset.roadId))path.classList.add('is-selected');focusGeometry(extent);
  }
  function selectPoint(p){if(saving||!mayLeaveEditor())return;clearReference();activeId=p.id;openEditor(p);renderPoints();focusPoint(p);}
  function openEditor(p=null){if(saving)return;formDirty=false;editingId=p?.id||null;$('editor-section').hidden=false;$('editor-heading').textContent=editingId?'修改调查点位':'新增调查点位';$('reference-name').textContent=p?.name||'新增点位';$('reference-review').textContent=editingId?'调查点位':'';$('point-name').value=p?.name||'';$('point-lat').value=p?.lat??'';$('point-lng').value=p?.lng??'';$('point-source').value=p?.source||'';$('point-note').value=p?.note||'';$('delete-point').hidden=!editingId;draft=p?{lat:p.lat,lng:p.lng}:null;renderAdministrativeInfo({...p,kind:'survey'});renderArchiveOverview({...p,kind:'survey'});$('reference-section').hidden=!editingId;$('reference-coordinates').textContent=p?`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`:'';$('reference-source').textContent=p?.source||'';$('reference-more').open=false;$('use-reference').hidden=true;syncDetails(true);checkCoordinates();rebuildPins();if(editingId)faith.selectVillage({id:p.id,kind:'survey',name:p.name});$('point-name').focus({preventScroll:true});}
  function closeEditor(){if(saving)return;faith.clearVillage();formDirty=false;editingId=null;activeId=null;draft=null;$('editor-section').hidden=true;if(!reference){archives.clear();$('reference-section').hidden=true;$('place-overview-section').hidden=true;$('field-notes-section').hidden=true;}setPicking(false);renderPoints();syncDetails();}
  function checkCoordinates(){const lat=$('point-lat').value,lng=$('point-lng').value;if(lat!==''&&lng!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))){draft={lat:Number(lat),lng:Number(lng)};$('point-location-status').textContent=onIsland(draft.lng,draft.lat)?'':'位置在海岸线外，请核对坐标。';}else{draft=null;$('point-location-status').textContent='';}rebuildPins();}
  function setPicking(enabled){faith.dismissPreview();picking=enabled;$('cancel-pick').hidden=!enabled;$('pick-message').hidden=!enabled;stage.classList.toggle('is-picking',enabled);workspace.classList.toggle('is-picking',enabled);if(view)update();}
  function setPickedLocation(lng,lat){
    if(!onIsland(lng,lat)){notify('请选择岛内位置。');return;}
    $('point-lat').value=lat.toFixed(6);$('point-lng').value=lng.toFixed(6);checkCoordinates();setPicking(false);expandDetails();notify('位置已选好，请填写名称并保存。');$('point-name').focus({preventScroll:true});
  }
  function pick(){formDirty=true;setPicking(true);svg.focus({preventScroll:true});}
  $('add-point').addEventListener('click',()=>{if(!mayLeaveEditor())return;clearReference();openEditor();pick();});
  $('use-reference').addEventListener('click',()=>{const p=reference;if(!p||p.kind==='road'||!mayLeaveEditor())return;clearReference();openEditor(p.kind==='cluster'?{name:'',lat:p.lat,lng:p.lng,source:p.sourceLabel||'OpenStreetMap 聚落轮廓，待现场核对',note:p.sourceDescription||'轮廓中心为近似位置，村名与实际范围待现场核对。'}:{name:p.name,lat:p.lat,lng:p.lng,source:p.nameSource+'；位置：'+p.coordinateSource});formDirty=true;});
  $('close-reference').addEventListener('click',()=>{if(!mayLeaveEditor())return;if(!$('editor-section').hidden)closeEditor();clearReference();layoutPins();});
  $('close-editor').addEventListener('click',()=>{if(mayLeaveEditor())closeEditor();});$('pick-location').addEventListener('click',pick);$('cancel-pick').addEventListener('click',()=>setPicking(false));
  ['point-lat','point-lng'].forEach(id=>$(id).addEventListener('change',checkCoordinates));
  $('point-form').addEventListener('input',()=>{formDirty=true;});
  window.addEventListener('beforeunload',e=>{if(saving||formDirty||faith.saving||faith.dirty||archives.saving||archives.dirty){e.preventDefault();e.returnValue='';}});
  $('point-form').addEventListener('submit',async e=>{e.preventDefault();if(blockedStorage||saving||!ready||!$('point-form').reportValidity()||!faith.mayLeave()||!archives.mayLeave())return;const now=new Date().toISOString(),old=points.find(p=>p.id===editingId);const p={id:editingId||uid(),name:$('point-name').value.trim(),lat:Number($('point-lat').value),lng:Number($('point-lng').value),source:$('point-source').value.trim(),note:$('point-note').value.trim(),createdAt:old?.createdAt||now,updatedAt:now};if(!validPoint(p)){notify('请填写有效名称与经纬度。');return;}const next=points.slice(),i=next.findIndex(item=>item.id===p.id);if(i<0)next.push(p);else next[i]=p;if(await store(next)){closeEditor();notify('已保存：'+p.name);}});
  $('delete-point').addEventListener('click',async()=>{if(!faith.mayLeave()||!archives.mayLeave())return;const i=points.findIndex(p=>p.id===editingId);if(i<0)return;const removed=points[i],next=points.filter(p=>p.id!==removed.id);if(!await store(next))return;closeEditor();notify('已移除：'+removed.name,async()=>{if(!points.some(p=>p.id===removed.id)){const restored=points.slice();restored.splice(Math.min(i,restored.length),0,removed);if(await store(restored))renderPoints();}});});
  $('search-form').addEventListener('submit',e=>{
    e.preventDefault();
    if(mobileSearch.matches&&!searchPanel.classList.contains('is-expanded')){setSearchExpanded(true,true);return;}
    const term=$('search-input').value.trim().toLocaleLowerCase();$('search-results').replaceChildren();$('search-feedback').hidden=false;if(!term){status('请输入村名、神明或道路。');return;}
    const nameMatches=p=>[p.name,p.pinyin,...(p.aliases||[])].some(name=>name?.toLocaleLowerCase().includes(term)||(term.endsWith('村')&&term.length>1&&name?.toLocaleLowerCase().replace(/村$/,'').includes(term.slice(0,-1))));
    const local=points.filter(p=>nameMatches(p)||faith.matches(p.id,'survey',term)),refs=data.places.filter(p=>nameMatches(p)||faith.matches(p.id,'reference',term)),matchedRoads=[...roadGroups.values()].filter(group=>[group.label,group.ref,...group.roads.flatMap(p=>[p.name,p.ref])].some(name=>name?.toLocaleLowerCase().includes(term)));
    const matchedAreas=administrativeAreas.filter(area=>!area.officePlaceId&&[area.name,area.committeeName,...(area.aliases||[])].some(name=>name.toLocaleLowerCase().includes(term)));
    for(const p of local)$('search-results').append(resultButton(p.name,faith.matches(p.id,'survey',term)?'信仰记录':'我的调查点位',()=>selectPoint(p)));
    for(const p of refs)$('search-results').append(resultButton(p.name,faith.matches(p.id,'reference',term)?'信仰记录':placeDescription(p),()=>selectReference(p)));
    for(const area of matchedAreas)$('search-results').append(resultButton(area.name,'社区 · 驻地待确认',()=>selectAdministrativeArea(area)));
    for(const group of matchedRoads)$('search-results').append(resultButton(group.label,'道路 · OpenStreetMap'+(group.ref?' · '+group.ref:''),()=>selectRoad(group)));
    const total=local.length+refs.length+matchedRoads.length+matchedAreas.length;status(total?`找到 ${total} 项。`:'当前清单未收录，可点击聚落轮廓记录线索。');
    if(total===1){if(local.length)selectPoint(local[0]);else if(refs.length)selectReference(refs[0]);else if(matchedAreas.length)selectAdministrativeArea(matchedAreas[0]);else selectRoad(matchedRoads[0]);}
  });
  $('reference-count').textContent=data.places.length+' 个';for(const p of data.places)$('reference-list').append(resultButton(p.name,placeDescription(p),()=>selectReference(p)));
  $('show-labels').addEventListener('change',layoutPins);$('show-road-labels').addEventListener('change',layoutPins);
  $('show-clusters').addEventListener('change',()=>{const visible=$('show-clusters').checked;for(const id of ['residential-layer','building-layer'])$(id).style.display=visible?'':'none';});
  $('zoom-in').addEventListener('click',()=>zoomAt(1.5,undefined,undefined,true));$('zoom-out').addEventListener('click',()=>zoomAt(1/1.5,undefined,undefined,true));
  $('island-view').addEventListener('click',()=>{if(!mayLeaveEditor())return;closeEditor();clearReference();setUtility();setSearchExpanded(false);$('search-feedback').hidden=true;$('search-results').replaceChildren();$('search-input').value='';status('');homeView(true);});
  stage.addEventListener('wheel',e=>{e.preventDefault();clearTimeout(wheelLabelTimer);wheelLabelTimer=setTimeout(()=>{wheelLabelTimer=null;schedulePinLayout();},140);const rect=stage.getBoundingClientRect();zoomAt(Math.exp(-Math.max(-300,Math.min(300,e.deltaY))*.002),e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)});
  stage.addEventListener('pointerdown',e=>{if(e.target.closest('button')||e.button!==0)return;explorer?.cancelAutoFocus();cancelCamera();stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){drag={x:e.clientX,y:e.clientY,view:{...view},clusterKey:e.target.closest('.residential')?.dataset.clusterKey};gestureMoved=false;}else if(pointers.size===2){const [a,b]=[...pointers.values()];pinch=midpoint(a,b);gestureMoved=true;}stage.classList.add('is-dragging');});
  stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const rect=stage.getBoundingClientRect();if(pointers.size===2){const [a,b]=[...pointers.values()],next=midpoint(a,b);if(pinch){const {w,h}=dimensions();view.x-=(next.x-pinch.x)*view.w/w;view.y-=(next.y-pinch.y)*view.h/h;zoomAt(next.d/Math.max(pinch.d,1),next.x-rect.left,next.y-rect.top);}pinch=next;}else if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)gestureMoved=true;const {w,h}=dimensions();view={...drag.view,x:drag.view.x-dx*drag.view.w/w,y:drag.view.y-dy*drag.view.h/h};update();}});
  function endPointer(e){if(!pointers.has(e.pointerId))return;const click=!gestureMoved&&pointers.size===1&&e.type==='pointerup',clusterKey=drag?.clusterKey;pointers.delete(e.pointerId);if(click&&picking){const rect=stage.getBoundingClientRect(),{w,h}=dimensions();const pos=unproject(view.x+(e.clientX-rect.left)/w*view.w,view.y+(e.clientY-rect.top)/h*view.h);setPickedLocation(pos.lng,pos.lat);}else if(click&&clusterKey){const cluster=clusterByKey.get(clusterKey);if(cluster)selectCluster(cluster);}pinch=null;if(pointers.size===1){const p=[...pointers.values()][0];drag={x:p.x,y:p.y,view:{...view}};}else if(!pointers.size){drag=null;stage.classList.remove('is-dragging');schedulePinLayout();}}
  stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);
  svg.addEventListener('keydown',e=>{if(['+','=','-','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();explorer?.cancelAutoFocus();if(e.key==='Home')homeView(true);else if(e.key==='+'||e.key==='=')zoomAt(1.5,undefined,undefined,true);else if(e.key==='-')zoomAt(1/1.5,undefined,undefined,true);else{cancelCamera();if(e.key==='ArrowUp')view.y-=view.h*.12;if(e.key==='ArrowDown')view.y+=view.h*.12;if(e.key==='ArrowLeft')view.x-=view.w*.12;if(e.key==='ArrowRight')view.x+=view.w*.12;update();}}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(openPanel)setUtility(null,null,true);if(searchPanel.classList.contains('is-expanded'))setSearchExpanded(false,true);if(explorer?.isOpen&&!e.target.closest('input,textarea,select'))explorer.close();$('search-feedback').hidden=true;setPicking(false);}});
  let previousWindowWidth=window.innerWidth,previousWindowHeight=window.innerHeight;
  new ResizeObserver(()=>{
    if(!home||!view)return;
    const windowResized=window.innerWidth!==previousWindowWidth||window.innerHeight!==previousWindowHeight;
    previousWindowWidth=window.innerWidth;previousWindowHeight=window.innerHeight;
    const cx=view.x+view.w/2,cy=view.y+view.h/2,wasHome=!cameraIntent&&Math.abs(view.w-home.w)<1&&Math.hypot(cx-(home.x+home.w/2),cy-(home.y+home.h/2))<1;
    // Panel transitions change the visible canvas, not the desktop camera scale.
    if(!mobileSearch.matches)desktopRetainedWidth=windowResized?0:view.w;
    home=makeHome();const {w,h}=dimensions();
    if(wasHome&&(mobileSearch.matches||windowResized))view={...home};else view={x:cx-view.w/2,y:cy-view.w*h/w/2,w:view.w,h:view.w*h/w};
    update();
  }).observe(stage);
  const labelUIObserver=new ResizeObserver(()=>{if(view)schedulePinLayout(true);});
  for(const node of document.querySelectorAll('.search-panel,.utility-panel,.map-toolbar'))labelUIObserver.observe(node);
  document.fonts?.ready.then(()=>{labelSizes.clear();schedulePinLayout(true);});
  function download(name,type,text){if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=downloadURL;a.download=name;a.textContent='下载 '+name;$('export-link').replaceChildren(a);$('export-link').hidden=false;$('export-preview').hidden=false;$('export-content').value=text;setUtility('data-panel',$('data-toggle'));a.click();notify('已生成：'+name);}
  const stamp=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
  function csvCell(value){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
  $('export-csv').addEventListener('click',()=>{const rows=[['编号','名称','纬度','经度','资料来源','调查笔记','创建时间','修改时间'],...points.map(p=>[p.id,p.name,p.lat,p.lng,p.source,p.note,p.createdAt,p.updatedAt])];download('硇洲岛调查点位-'+stamp()+'.csv','text/csv;charset=utf-8','\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));});
  $('export-geojson').addEventListener('click',()=>{const obj={type:'FeatureCollection',name:'硇洲岛调查点位',schemaVersion:1,coordinateSystem:'WGS84',exportedAt:new Date().toISOString(),features:points.map(p=>({type:'Feature',id:p.id,geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{name:p.name,source:p.source,note:p.note,createdAt:p.createdAt,updatedAt:p.updatedAt}}))};download('硇洲岛调查点位-'+stamp()+'.geojson','application/geo+json;charset=utf-8',JSON.stringify(obj,null,2));});
  $('import-button').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async()=>{const file=$('import-file').files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('文件超过 10 MB。');const obj=JSON.parse(await file.text());if(obj.type!=='FeatureCollection'||!Array.isArray(obj.features)||obj.features.length>10000)throw Error('请选择本地图导出的 GeoJSON 备份。');const incoming=obj.features.map(f=>{if(f.type!=='Feature'||f.geometry?.type!=='Point'||!Array.isArray(f.geometry.coordinates))throw Error('备份包含无效点位。');const props=f.properties||{},p={id:typeof f.id==='string'?f.id:uid(),name:props.name,lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],source:props.source,note:props.note,createdAt:props.createdAt,updatedAt:props.updatedAt};if(!validPoint(p))throw Error('备份中的名称或坐标无效。');return cleanPoint(p);});if(new Set(incoming.map(p=>p.id)).size!==incoming.length)throw Error('备份内存在重复编号。');const ids=new Set(points.map(p=>p.id)),added=incoming.filter(p=>!ids.has(p.id));blockedStorage=false;if(await store([...points,...added])){renderPoints();notify(`导入 ${added.length} 个点位；同编号的现有记录已保留。`);}}catch(err){notify('导入失败：'+err.message);}finally{$('import-file').value='';}});
  $('export-svg').addEventListener('click',()=>{
    const output=svg.cloneNode(true),exportView={x:bounds.left-bw*.06,y:bounds.top-bh*.06,w:bw*1.12,h:bh*1.12},width=1000,height=width*exportView.h/exportView.w,unit=exportView.w/width;
    output.removeAttribute('tabindex');output.removeAttribute('class');output.setAttribute('width',String(width));output.setAttribute('height',String(Math.round(height)));output.setAttribute('viewBox',`${exportView.x} ${exportView.y} ${exportView.w} ${exportView.h}`);output.setAttribute('preserveAspectRatio','xMidYMid meet');
    for(const node of output.querySelectorAll('[tabindex]')){node.removeAttribute('tabindex');node.removeAttribute('role');}
    for(const node of output.querySelectorAll('.is-selected'))node.classList.remove('is-selected');
    const style=document.createElementNS(NS,'style');style.textContent='.coast{fill:#f0ece4;stroke:#d0cdc4;stroke-width:1.25;vector-effect:non-scaling-stroke}.road{fill:none;stroke:#d2d0c8;stroke-width:.75;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.road.main{stroke:#c4c4bc;stroke-width:1.35}.road.minor{stroke:#dedbd3;stroke-width:.55}.road.path{stroke:#d5d6cb;stroke-width:.6;stroke-opacity:.8;stroke-dasharray:2 4}.residential{fill:#d8ddd0;fill-opacity:.76;stroke:#aeb9a6;stroke-width:.35;stroke-opacity:.08;vector-effect:non-scaling-stroke}.building{fill:#d9d7cc;stroke:#c3c2b7;stroke-width:.4;vector-effect:non-scaling-stroke}.water{fill:none;stroke:#b6c7cd;stroke-width:.7;vector-effect:non-scaling-stroke}text{font-family:system-ui,Microsoft YaHei,sans-serif;fill:#4d5450;paint-order:stroke;stroke:#f0ece4;stroke-linejoin:round}';output.prepend(style);
    // A background rectangle changes only the page, never the map geometry.
    const sea=document.createElementNS(NS,'rect');sea.setAttribute('x',exportView.x);sea.setAttribute('y',exportView.y);sea.setAttribute('width',exportView.w);sea.setAttribute('height',exportView.h);sea.setAttribute('fill','#b6c7cd');sea.setAttribute('data-decoration','sea');output.insertBefore(sea,output.querySelector('#coast'));
    const adminStyle=document.createElementNS(NS,'style');adminStyle.textContent='#administrative-fill-layer{opacity:.45}#administrative-boundary-layer{opacity:.9}.administrative-coverage{fill:#b8cec4;stroke:none}.administrative-boundary{fill:none;stroke:#789789;stroke-width:1.6;stroke-dasharray:5 3;stroke-linejoin:round;vector-effect:non-scaling-stroke}';output.prepend(adminStyle);
    const meta=document.createElementNS(NS,'metadata');meta.textContent=JSON.stringify({coordinateSystem:'WGS84',projection:'Web Mercator',attribution:'© OpenStreetMap contributors (ODbL), GeoNames (CC BY 4.0)',osmSnapshot:data.meta?.osmTimestamp,settlementMeaning:'建成区轮廓，不代表村界。',administrativeLayerVisible:administrativeEnabled(),visibleAdministrativeAreaIds:[...visibleAdministrativeAreas],administrativeAreas:data.administrativeAreas||[],note:'行政驻地点不作为独立自然村；行政范围仅为已确认地点分布示意，按海岸线裁剪，不表示法定村界或海域管辖。地点位置仍需实地核对。'});output.append(meta);
    const occupied=[],entries=[...points.map(p=>({...p,saved:true})),...data.places.map(p=>({...p,saved:false}))].sort((a,b)=>(b.placeKind==='administrative_seat')-(a.placeKind==='administrative_seat'));
    for(const p of entries){const pos=project(p.lng,p.lat);occupied.push({x:(pos.x-exportView.x)/unit-4,y:(pos.y-exportView.y)/unit-4,w:8,h:8});}
    for(const area of administrativeAreas){
      if(!administrativeEnabled(area.id))continue;
      const pos=project(...area.labelAnchor),x=(pos.x-exportView.x)/unit,y=(pos.y-exportView.y)/unit,lw=180,lh=42;
      const chosen=coverageLabelPositions(x,y,lw,lh).find(([lx,ly])=>lx>0&&ly>0&&lx+lw<width&&ly+lh<height&&!occupied.some(r=>intersects({x:lx,y:ly,w:lw,h:lh},r))&&coverageContains(area,unproject(exportView.x+(lx+lw/2)*unit,exportView.y+(ly+lh/2)*unit)));
      if(!chosen)continue;const [lx,ly]=chosen;occupied.push({x:lx,y:ly,w:lw,h:lh});const label=document.createElementNS(NS,'text');label.setAttribute('x',exportView.x+(lx+lw/2)*unit);label.setAttribute('y',exportView.y+(ly+16)*unit);label.setAttribute('font-size',16*unit);label.setAttribute('font-weight','600');label.setAttribute('text-anchor','middle');label.setAttribute('stroke-width',4*unit);label.textContent=area.name;const caption=document.createElementNS(NS,'tspan');caption.setAttribute('x',label.getAttribute('x'));caption.setAttribute('dy',18*unit);caption.setAttribute('font-size',10*unit);caption.setAttribute('font-weight','400');caption.textContent=(area.officeCaption||area.committeeName)+' · 范围示意';label.append(caption);output.append(label);
    }
    for(const p of entries){
      const pos=project(p.lng,p.lat),x=(pos.x-exportView.x)/unit,y=(pos.y-exportView.y)/unit;
      const administrative=p.placeKind==='administrative_seat',natural=p.placeKind==='natural_village',dot=document.createElementNS(NS,administrative?'rect':'circle');
      if(administrative){dot.setAttribute('x',pos.x-4.25*unit);dot.setAttribute('y',pos.y-4.25*unit);dot.setAttribute('width',8.5*unit);dot.setAttribute('height',8.5*unit);dot.setAttribute('rx',.75*unit);}else{dot.setAttribute('cx',pos.x);dot.setAttribute('cy',pos.y);dot.setAttribute('r',3.375*unit);}
      const ink=p.saved?'#343a40':administrative?'#343b3c':natural?'#4b5351':'#626b68';dot.setAttribute('fill',p.saved||administrative||natural?ink:'#f4f0e8');dot.setAttribute('stroke',ink);dot.setAttribute('stroke-width',(administrative?1.5:1.25)*unit);dot.dataset.placeKind=p.placeKind||'reference';const title=document.createElementNS(NS,'title');title.textContent=p.name+' · '+(p.saved?'调查点位':placeDescription(p));dot.append(title);output.append(dot);
      if(!$('show-labels').checked)continue;
      const lw=p.name.length*12+8+(administrative?(p.administrativeCaption||p.committeeName).length*9+10:0),lh=18,positions=[[x+8,y-lh/2],[x-lw-8,y-lh/2],[x-lw/2,y-lh-8],[x-lw/2,y+8],[x+8,y-lh-8],[x-lw-8,y+8]];
      const chosen=positions.find(([lx,ly])=>lx>=0&&ly>=0&&lx+lw<width&&ly+lh<height&&!occupied.some(r=>intersects({x:lx,y:ly,w:lw,h:lh},r)));
      if(!chosen)continue;const [lx,ly]=chosen;occupied.push({x:lx,y:ly,w:lw,h:lh});
      const text=document.createElementNS(NS,'text');text.setAttribute('x',exportView.x+lx*unit);text.setAttribute('y',exportView.y+(ly+13)*unit);text.setAttribute('font-size',12*unit);text.setAttribute('stroke-width',3*unit);if(p.saved||administrative)text.setAttribute('font-weight','650');text.textContent=p.name;if(administrative){const caption=document.createElementNS(NS,'tspan');caption.setAttribute('dx',6*unit);caption.setAttribute('font-size',9*unit);caption.setAttribute('font-weight','400');caption.textContent=p.administrativeCaption||p.committeeName;text.append(caption);}output.append(text);
    }
    if($('show-road-labels').checked){
      for(const item of roadPlacements(exportView,width,height,occupied,10,true)){
        const x=exportView.x+item.x*unit,y=exportView.y+item.y*unit,text=document.createElementNS(NS,'text');text.setAttribute('x',x);text.setAttribute('y',y);text.setAttribute('transform',`rotate(${item.angle} ${x} ${y})`);text.setAttribute('font-size',10*unit);text.setAttribute('stroke-width',3*unit);text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','middle');text.setAttribute('style','fill:#888c89');text.textContent=item.label;output.append(text);
      }
    }
    const credit=document.createElementNS(NS,'text');credit.setAttribute('x',bounds.left);credit.setAttribute('y',bounds.bottom+bh*.045);credit.setAttribute('font-size',8*unit);credit.setAttribute('stroke-width',2*unit);credit.textContent='© OpenStreetMap contributors · openstreetmap.org/copyright · GeoNames (CC BY 4.0)'+(data.meta?.supplementalSettlementAreaCount?' · 补充建成区：高德卫星影像人工判读（近似）':'');output.append(credit);
    if(administrativeEnabled()){const note=credit.cloneNode(false);note.setAttribute('y',bounds.bottom+bh*.058);note.textContent='灰绿色区域：'+administrativeAreas.filter(area=>administrativeEnabled(area.id)).map(area=>area.committeeName).join('、')+'范围示意，按已确认地点分布制作；仅陆地，不表示法定行政边界。';output.append(note);}
    download('硇洲岛田野地图-'+stamp()+'.svg','image/svg+xml;charset=utf-8','<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(output));
  });
  if(data.meta?.osmTimestamp)$('geometry-date').textContent='道路快照：'+data.meta.osmTimestamp.slice(0,10)+'。';
  const archives = window.createPlaceArchives({download,editSurveyNote:()=>$('point-note').focus()});
  const faith = window.createFaithRecords({download,onChange:rebuildPins,onExploreDeity:id=>explorer?.open(id)});
  explorer=window.createDeityExplorer({
    faith,
    resolvePlace:(kind,id)=>kind==='reference'?placeById.get(id):kind==='survey'?points.find(point=>point.id===id):null,
    beforeOpen(){if(saving||!mayLeaveEditor())return false;closeEditor();clearReference();cancelCamera();setUtility();setSearchExpanded(false);$('search-feedback').hidden=true;return true;},
    onClose:cancelCamera,
    onHighlight(id,villages){
      const keys=villages.map(village=>(village.kind==='survey'?'saved-':'ref-')+village.id),signature=JSON.stringify([id,keys.slice().sort()]);if(signature===highlightSignature)return;
      highlightSignature=signature;exploringDeityId=id;deityPlaceKeys=new Set(keys);labelContext='';if(view)update();
    },
    onFocus(villages){
      if(villages.length===1){focusPoint(villages[0].point);return;}
      if(!villages.length)return;const positions=villages.map(village=>project(village.point.lng,village.point.lat));
      focusGeometry({left:Math.min(...positions.map(p=>p.x)),right:Math.max(...positions.map(p=>p.x)),top:Math.min(...positions.map(p=>p.y)),bottom:Math.max(...positions.map(p=>p.y))});
    },
    onPlace(village){if(!village.point)return;if(village.kind==='survey')selectPoint(village.point);else selectReference(village.point);},
    captureView(){return {center:unproject(view.x+view.w/2,view.y+view.h/2),width:view.w};},
    restoreView(saved){if(!saved||!Number.isFinite(saved.center?.lng)||Math.abs(saved.center.lng)>180||!Number.isFinite(saved.center?.lat)||Math.abs(saved.center.lat)>85||!Number.isFinite(saved.width)||saved.width<=0)return false;const p=project(saved.center.lng,saved.center.lat),{w,h}=dimensions();flyTo({type:'view',view:{x:p.x-saved.width/2,y:p.y-saved.width*h/w/2,w:saved.width,h:saved.width*h/w}},300);return true;}
  });
  for(const area of administrativeAreas)setAdministrativeLayer(area,false);
  function openLinkedPlace(){
    if(explorer.restoreFromURL())return;
    const query=new URLSearchParams(location.search),id=query.get('placeId'),kind=query.get('placeKind');if(!id)return;
    const point=kind==='survey'?points.find(point=>point.id===id):kind==='reference'?placeById.get(id):null;
    if(!point){notify('未找到对应地点，资料可能已更新。');return;}
    if(kind==='survey')selectPoint(point);else selectReference(point);
    if(query.get('faithId'))faith.focusRecord(query.get('faithId'));
  }
  renderPoints();homeView();load().then(openLinkedPlace);
})();
