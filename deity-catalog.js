/* Shared deity catalog client. Names are search terms; only IDs establish identity. */
window.DeityAtlas = (() => {
  'use strict';
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'deity-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const profileURL = id => '/deities?id='+encodeURIComponent(id);
  const mapURL = (kind,id,recordId='') => '/?'+new URLSearchParams({placeKind:kind,placeId:id,...(recordId?{faithId:recordId}:{})});
  function element(tag,className='',text='') {
    const node=document.createElement(tag); if(className)node.className=className; if(text)node.textContent=text; return node;
  }
  function validate(state) {
    if(state?.version!==1 || !Number.isInteger(state.revision) || state.revision<0 || !Array.isArray(state.titles) || !Array.isArray(state.records))throw Error('神明总库格式无效。');
    const titles=new Set(),ids=new Set();
    for(const title of state.titles){if(typeof title.id!=='string'||!title.id||typeof title.name!=='string'||!title.name.trim()||titles.has(title.id))throw Error('神函索引无效。');titles.add(title.id);}
    for(const item of state.records){if(typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||!Array.isArray(item.aliases)||item.aliases.some(name=>typeof name!=='string')||!Array.isArray(item.titleIds)||item.titleIds.some(id=>!titles.has(id)))throw Error('神明档案无效。');ids.add(item.id);}
    return state;
  }
  function createCatalog() {
    let state=null,saving=false;
    const listeners=new Set();
    const emit=()=>listeners.forEach(callback=>callback());
    const request=(url,options)=> (window.NaozhouCloud?.request || fetch)(url,options);
    async function load(){const response=await request('/api/deities',{cache:'no-store'});if(!response.ok)throw Error('神明总库未能读取，请刷新重试。');state=validate(await response.json());emit();return state;}
    const ready=load();
    async function save(next) {
      if(!state||saving)throw Error('神明总库尚未就绪或正在保存。');
      saving=true;
      try {
        const response=await request('/api/deities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,version:1,revision:state.revision})});
        const result=await response.json();
        if(response.status===409){state=validate(result);emit();throw Error('另一页面已更新总库，填写内容仍保留，请再次保存。');}
        if(!response.ok)throw Error(result.error||'神明档案未能保存，请保留填写内容。');
        state=validate(result);emit();return state;
      } finally {saving=false;}
    }
    return {
      ready,load,get state(){return state;},get saving(){return saving;},
      subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);},
      get(id){return state?.records.find(item=>item.id===id);},
      search(query){const term=query.trim().toLocaleLowerCase();return (state?.records||[]).filter(item=>!item.archivedAt&&(!term||[item.name,...item.aliases].some(name=>name.toLocaleLowerCase().includes(term))));},
      async saveRecord(values){await ready;const previous=values.id?this.get(values.id):null,now=new Date().toISOString();const record={...previous,...values,id:previous?.id||values.id||uid(),createdAt:previous?.createdAt||now,updatedAt:now};await save({titles:state.titles,records:state.records.filter(item=>item.id!==record.id).concat(record)});return this.get(record.id);},
      async saveTitles(titles){await ready;return save({titles,records:state.records});},
      async importCatalog(incoming){validate(incoming);await ready;const titles=state.titles.slice();for(const title of incoming.titles){const old=titles.find(item=>item.id===title.id);if(old&&old.name!==title.name)throw Error('同编号神函名称不同，请人工核对。');if(!old)titles.push(title);}const ids=new Set(state.records.map(item=>item.id));return save({titles,records:state.records.concat(incoming.records.filter(item=>!ids.has(item.id)))});}
    };
  }
  function createFields(host,catalog,record={},prefix='deity') {
    host.replaceChildren();
    const inputs={};
    for(const [field,label,limit,multiline] of [['name','主要名称',100,false],['aliases','别名与地方称谓',10000,true],['description','神明简介',20000,true],['identityNote','身份差异与争议说明',10000,true],['source','资料来源',2000,true]]){
      const caption=element('label','',label);caption.htmlFor=prefix+'-'+field;
      const input=element(multiline?'textarea':'input');input.id=caption.htmlFor;input.maxLength=limit;input.value=field==='aliases'?(record.aliases||[]).join('\n'):record[field]||'';
      if(field==='name')input.required=true;
      if(field==='aliases'){input.rows=2;input.placeholder='每行一个名称';}
      else if(multiline)input.rows=field==='description'?4:3;
      inputs[field]=input;host.append(caption,input);
      if(field==='aliases'){
        const group=element('fieldset','title-checks'),legend=element('legend','','神函（可多选）');group.append(legend);
        for(const title of catalog.state?.titles||[]){const label=element('label');const check=element('input');check.type='checkbox';check.value=title.id;check.checked=!!record.titleIds?.includes(title.id);label.append(check,document.createTextNode(title.name));group.append(label);}
        host.append(group);
      }
    }
    return {focus:()=>inputs.name.focus(),read:()=>({name:inputs.name.value.trim(),aliases:inputs.aliases.value.split(/\n/).map(name=>name.trim()).filter(Boolean),titleIds:[...host.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value),description:inputs.description.value.trim(),identityNote:inputs.identityNote.value.trim(),source:inputs.source.value.trim()})};
  }
  function villagesFor(deityId,records) {
    const villages=new Map();
    for(const record of records){const links=(record.deityLinks||[]).filter(link=>link.deityId===deityId);if(!links.length)continue;const key=record.villageKind+':'+record.villageId;if(!villages.has(key))villages.set(key,{key,id:record.villageId,kind:record.villageKind,name:record.villageName,records:[]});villages.get(key).records.push({record,links});}
    return [...villages.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  }
  return {uid,element,profileURL,mapURL,validate,createCatalog,createFields,villagesFor};
})();
