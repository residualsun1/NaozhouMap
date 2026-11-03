/* Read-only cartographic overlay. It never changes places or survey records. */
window.createLandCover = ({group,coastPath,project,checkbox,legend,note,credit}) => {
  const source=window.NAOZHOU_LAND_COVER,NS='http://www.w3.org/2000/svg';
  const classes={forest:'树木覆盖',cropland:'耕地',inland_water:'内陆水面',grassland:'草地',shrubland:'灌木',bare_open:'裸地 / 稀疏植被',wetland:'草本湿地',mangrove:'红树林'};
  const originalLegend=[...legend.children].map(node=>node.cloneNode(true));
  if(!source?.metadata||!source.levels?.overview||!source.levels?.detail){
    checkbox.checked=false;checkbox.disabled=true;note.textContent='地表覆盖资料未加载，保留原有底图。';credit.hidden=true;
    return {updateZoom(){},prepareExport(){},get metadata(){return null;}};
  }
  const pathFor=geometry=>{
    const parts=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return parts.map(polygon=>polygon.map(ring=>ring.map(([lng,lat],index)=>{const point=project(lng,lat);return (index?'L':'M')+point.x.toFixed(2)+' '+point.y.toFixed(2);}).join(' ')+' Z').join(' ')).join(' ');
  };
  const background=document.createElementNS(NS,'path');background.setAttribute('d',coastPath);background.setAttribute('class','land-cover-base');background.dataset.coverClass='unknown';group.append(background);
  const levels={};let level='overview';
  for(const [name,features] of Object.entries(source.levels)){
    const layer=document.createElementNS(NS,'g');layer.dataset.coverLod=name;layer.style.display=name===level?'':'none';
    for(const feature of features){
      const kind=feature.properties.class;if(!classes[kind])continue;
      const path=document.createElementNS(NS,'path');path.setAttribute('class','land-cover-feature '+kind);path.dataset.coverClass=kind;path.setAttribute('d',pathFor(feature.geometry));path.setAttribute('fill-rule','evenodd');layer.append(path);
    }
    levels[name]=layer;group.append(layer);
  }
  const swatch=(kind,text)=>{const item=document.createElement('span'),icon=document.createElement('i');icon.className='cover-swatch '+kind;icon.setAttribute('aria-hidden','true');item.append(icon,document.createTextNode(text));return item;};
  function sync(){
    const enabled=checkbox.checked;group.style.display=enabled?'':'none';credit.hidden=!enabled;
    legend.replaceChildren();
    if(enabled){
      const present=new Set(source.levels.detail.map(feature=>feature.properties.class));
      for(const [kind,label] of Object.entries(classes))if(present.has(kind))legend.append(swatch(kind,label));
      const built=swatch('settlement-swatch','聚落建成区');legend.append(built,swatch('unknown','未确认'));
    }else legend.append(...originalLegend.map(node=>node.cloneNode(true)));
  }
  checkbox.addEventListener('change',sync);sync();
  return {
    updateZoom(zoom){
      const next=level==='overview'&&zoom>=1.85?'detail':level==='detail'&&zoom<1.6?'overview':level;
      if(next===level)return;levels[level].style.display='none';levels[next].style.display='';level=next;
    },
    prepareExport(output){
      const target=output.querySelector('#land-cover-layer');if(!target)return;
      if(!checkbox.checked){target.remove();return;}
      // The full-island export uses the same overview classification, with resolved colors.
      target.querySelector('[data-cover-lod="detail"]')?.remove();target.querySelector('[data-cover-lod="overview"]').style.display='';
      const palette=getComputedStyle(document.documentElement);
      for(const path of target.querySelectorAll('[data-cover-class]')){
        const kind=path.dataset.coverClass;path.setAttribute('fill',palette.getPropertyValue('--map-cover-'+kind.replaceAll('_','-')).trim());path.setAttribute('stroke','none');
        if(kind!=='unknown'&&kind!=='inland_water')path.setAttribute('fill-opacity',palette.getPropertyValue('--map-cover-overview-opacity').trim());
      }
    },
    get metadata(){return checkbox.checked?source.metadata:null;}
  };
};
