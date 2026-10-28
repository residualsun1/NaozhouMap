/* Canonical names live on places. Abbreviations are computed only for map labels. */
window.PlaceNames=(()=>{
  'use strict';
  const places=new Map();
  function register(items){for(const place of items||[])places.set(place.id,place);}
  register(window.NAOZHOU_DATA?.places);
  function name(kind,id,fallback=''){return kind==='reference'?(places.get(id)?.name||fallback):fallback;}
  function mapLabel(place,isOverview=false,isSelected=false){
    const full=place.name;
    return isOverview&&!isSelected&&place.placeKind==='natural_village'&&full.endsWith('村')?full.slice(0,-1):full;
  }
  function matches(place,query){
    const term=query.trim().toLocaleLowerCase();
    const values=[place.name,mapLabel(place,true),place.pinyin,...(place.aliases||[])];
    // Retain exact suffix alternatives for aliases and older locality names.
    return values.some(value=>value?.toLocaleLowerCase().includes(term)||
      term.endsWith('村')&&term.length>1&&value?.toLocaleLowerCase().replace(/村$/,'')===term.slice(0,-1));
  }
  return {register,name,mapLabel,matches};
})();
