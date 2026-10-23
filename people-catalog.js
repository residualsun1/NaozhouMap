/* Shared people records. Names support discovery; stable IDs establish identity. */
window.PeopleArchive = (() => {
  'use strict';
  const uid=()=>crypto.randomUUID(), el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const profileURL=id=>'/people'+(id?'?'+new URLSearchParams({id}):'');
  const mapURL=(kind,id,entryId='')=>'/?'+new URLSearchParams({placeKind:kind,placeId:id,...(entryId?{entryId,view:'reading'}:{})});
  const split=value=>[...new Set(value.split(/[\n,，、]/).map(x=>x.trim()).filter(Boolean))];
  const roles=['道士','法师','仪式主持者','宫庙管理者','信仰实践者','长者','受访者','口述历史提供者'];
  const relations=[['residence','居住'],['birth','出生'],['activity','活动'],['ritual','仪式主持'],['fieldwork','走访关联'],['other','其他']];
  const narratorRoles=[['unknown','尚未注明'],['participant','事件参与者'],['eyewitness','亲历叙述者'],['reteller','转述者'],['mentioned','叙述涉及人物']];
  let confirmQueue=Promise.resolve();
  function confirm(message,accept='确认'){
    const task=()=>new Promise(resolve=>{const dialog=el('dialog','people-confirm'),form=el('form');form.method='dialog';const title=el('h2','','确认操作'),copy=el('p','people-prose',message),actions=el('div','button-row form-actions'),cancel=el('button','','取消'),yes=el('button','primary',accept);cancel.value='cancel';cancel.autofocus=true;yes.value='accept';actions.append(cancel,yes);form.append(title,copy,actions);dialog.append(form);dialog.setAttribute('aria-label','确认操作');dialog.addEventListener('close',()=>{const result=dialog.returnValue==='accept';dialog.remove();resolve(result);},{once:true});document.body.append(dialog);dialog.showModal();});
    const result=confirmQueue.then(task);confirmQueue=result.catch(()=>false);return result;
  }
  function validate(data){if(data?.version!==1||!Array.isArray(data.records)||!(data.revision===null||Number.isInteger(data.revision)))throw Error('人物资料格式无效。');return data;}
  function createCatalog(){
    let state=null,saving=false,sequence=0;const listeners=new Set();const emit=()=>listeners.forEach(fn=>fn());
    const request=(url,options)=>(window.NaozhouCloud?.request||fetch)(url,options);
    async function load(){const serial=++sequence;await window.NaozhouCloud?.ready;const response=await request('/api/people',{cache:'no-store'});if(!response.ok)throw Error('人物资料暂未读取，请重试。');const data=validate(await response.json());if(serial===sequence){state=data;emit();}return data;}
    const ready=load();
    document.addEventListener('naozhou-access-change',()=>{sequence++;state=null;emit();load().catch(()=>{});});
    return {
      ready,load,get state(){return state;},get saving(){return saving;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},get(id){return state?.records.find(p=>p.id===id);},
      search(query=''){const term=query.trim().toLocaleLowerCase();return (state?.records||[]).filter(p=>!term||[p.displayName,p.religiousName,...(p.aliases||[])].some(x=>x?.toLocaleLowerCase().includes(term)));},
      async saveRecord(values){
        await ready.catch(()=>{});if(saving)throw Error('正在保存，请稍候。');
        if(window.NaozhouCloud&&!await window.NaozhouCloud.requireEditor())throw Error('登录后可保存人物档案。');
        if(!state?.editable)await load();if(!state?.editable)throw Error('目前没有编辑权限。');
        const previous=values.id?this.get(values.id):null;
        const record={...previous,...values,id:values.id||uid(),visibility:values.visibility||previous?.visibility||'editors'};
        const broaden=record.visibility!=='editors'&&(!previous||previous.visibility==='editors'||(record.visibility==='public'&&previous.visibility!=='public')||record.publishIdentity&&!previous.publishIdentity||record.publishOralHistory&&!previous.publishOralHistory||(record.placeLinks||[]).some(l=>l.public&&!(previous.placeLinks||[]).some(p=>p.id===l.id&&p.public)));
        if(broaden&&!await confirm('此档案中允许公开的内容将对访客可见。请确认已获得相关许可。真实姓名和内部研究备注始终仅供编辑者查看。','确认公开'))throw Error('尚未公开，填写内容已保留。');
        saving=true;
        try{const response=await request('/api/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,revision:state.revision,action:'save',record,baseUpdatedAt:values.updatedAt||previous?.updatedAt||null,confirmPublic:broaden})}),result=await response.json();
          if(response.status===409){if(Array.isArray(result.records)){state=validate(result);emit();}throw Error(result.error||'资料已在其他页面更新，当前填写仍保留，请先核对。');}
          if(!response.ok)throw Error(result.error||'保存未完成，填写内容已保留。');state=validate(result);emit();return this.get(record.id);
        }finally{saving=false;}
      }
    };
  }
  let placesPromise;
  function places(){
    if(!placesPromise)placesPromise=(async()=>{const rows=(window.NAOZHOU_DATA?.places||[]).map(p=>({...p,kind:'reference'}));try{const response=await (window.NaozhouCloud?.request||fetch)('/api/points',{cache:'no-store'});if(response.ok){const data=await response.json();for(const p of data.points||[])rows.push({...p,kind:'survey'});}}catch{}return rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));})();return placesPromise;
  }
  function createFields(host,record={},prefix='person',options={}){
    host.replaceChildren();host.classList.add('people-fields');const inputs={},draftId=record.id||uid(),lifetime={active:true};
    function field(parent,key,label,kind='text',max=500,help=''){
      const wrap=el('div','people-field'),caption=el('label','',label),input=el(kind==='textarea'?'textarea':'input');input.id=prefix+'-'+key;caption.htmlFor=input.id;if(kind!=='textarea')input.type=kind;input.maxLength=max;input.value=Array.isArray(record[key])?record[key].join('、'):record[key]||'';if(kind==='textarea')input.rows=key==='biography'||key==='oralHistory'?5:3;if(key==='displayName')input.required=true;inputs[key]=input;wrap.append(caption,input);if(help)wrap.append(el('small','people-help',help));parent.append(wrap);return input;
    }
    function group(title,open=false){const d=el('details','people-form-group');d.open=open;d.append(el('summary','',title));host.append(d);return d;}
    field(host,'displayName','显示名称（可用化名）','text',200);field(host,'religiousName','法号 / 道号','text',200);field(host,'aliases','别名与地方称谓','text',10000,'以顿号或逗号分隔。');
    const role=field(host,'roles','身份标签','text',3000,'可输入多个身份，以顿号分隔；无需正式职衔。');const roleList=el('datalist');roleList.id=prefix+'-role-suggestions';for(const label of roles){const opt=el('option');opt.value=label;roleList.append(opt);}role.setAttribute('list',roleList.id);host.append(roleList);
    field(host,'biography','基本情况 / 人物简介','textarea',100000);
    const oral=group('人物经历与口述');field(oral,'oralHistory','原始口述 / 人物经历','textarea',100000);const narrative=el('div','people-field'),nlabel=el('label','','人物在叙述中的角色'),nselect=el('select');nselect.id=prefix+'-narratorRole';nlabel.htmlFor=nselect.id;for(const [id,label] of narratorRoles){const o=el('option','',label);o.value=id;nselect.append(o);}nselect.value=record.narratorRole||'unknown';inputs.narratorRole=nselect;narrative.append(nlabel,nselect);oral.append(narrative);field(oral,'narratedAt','讲述时间（按原始资料填写）','text',100);field(oral,'eventDateText','所述事件时间','text',300);field(oral,'narrativeSource','叙述来源','textarea',3000);field(oral,'ritualQualificationNote','仪式身份、资格与说明','textarea',20000);
    const privacy=group('可见范围与内部资料',true),vwrap=el('div','people-field'),vl=el('label','','档案可见性'),vs=el('select');vs.id=prefix+'-visibility';vl.htmlFor=vs.id;for(const [id,name] of [['editors','私人资料 · 仅授权编辑者'],['summary','公开摘要'],['public','公开完整档案']]){const o=el('option','',name);o.value=id;vs.append(o);}vs.value=record.visibility||'editors';inputs.visibility=vs;vwrap.append(vl,vs,el('small','people-help','项目共用编辑身份；非公开资料仅授权编辑者可读。'));privacy.append(vwrap);field(privacy,'publicSummary','公开摘要','textarea',3000);
    for(const [key,title] of [['publishIdentity','允许公开姓氏、法号、别名及身份标签'],['publishOralHistory','允许公开人物经历、口述及其来源（完整公开时）']]){const label=el('label','people-check'),check=el('input');check.type='checkbox';check.checked=!!record[key];inputs[key]=check;label.append(check,document.createTextNode(title));privacy.append(label);}
    field(privacy,'surname','姓氏（可选）','text',100);field(privacy,'realName','真实姓名（仅内部）','text',200);field(privacy,'researchNotes','内部研究备注（不公开）','textarea',100000);
    field(host,'source','资料来源 / 许可说明','textarea',3000);
    const deityGroup=group('相关神明'),deityHost=el('div','people-deity-checks');deityGroup.append(deityHost);const deityIds=new Set(record.deityIds||[]);
    (window.NaozhouCloud?.request||fetch)('/api/deities',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.records))throw Error();if(!lifetime.active)return;for(const deity of data.records){const label=el('label','people-check'),check=el('input');check.type='checkbox';check.checked=deityIds.has(deity.id);check.addEventListener('change',()=>check.checked?deityIds.add(deity.id):deityIds.delete(deity.id));label.append(check,document.createTextNode(deity.name+(deity.archivedAt?' · 已归档':'')));deityHost.append(label);}if(!data.records.length)deityHost.append(el('p','people-help','神明总库暂无可关联档案。'));}).catch(()=>{if(lifetime.active)deityHost.append(el('p','people-help','神明总库暂未读取，原有关联仍会保留。'));});
    const retainedLinks=(record.placeLinks||[]).map(l=>({...l}));let linkRows=[];
    if(options.places!==false){
      const pg=group('关联村庄'),rows=el('div','people-place-fields'),add=el('button','','+ 关联村庄');add.type='button';pg.append(rows,add);
      function linkRow(link={}){const row=el('fieldset','people-place-row'),legend=el('legend','','地点关联'),place=el('select'),relation=el('select'),notes=el('textarea'),source=el('input'),publicCheck=el('input'),remove=el('button','linkbutton','移除此关联');place.setAttribute('aria-label','关联地点');const blank=el('option','','选择地点');blank.value='';place.append(blank);place.required=true;for(const [id,name] of relations){const o=el('option','',name);o.value=id;relation.append(o);}if(link.relationType&&!relations.some(r=>r[0]===link.relationType)){const o=el('option','',link.relationType);o.value=link.relationType;relation.append(o);}relation.value=link.relationType||'activity';relation.setAttribute('aria-label','关联类型');notes.rows=2;notes.maxLength=5000;notes.value=link.notes||'';notes.placeholder='关联说明';notes.setAttribute('aria-label','地点关联说明');source.maxLength=3000;source.value=link.source||'';source.placeholder='关联依据 / 来源';source.setAttribute('aria-label','地点关联来源');publicCheck.type='checkbox';publicCheck.checked=!!link.public;const pl=el('label','people-check');pl.append(publicCheck,document.createTextNode('允许公开此地点关联'));remove.type='button';const item={id:link.id||uid(),row,place,relation,notes,source,publicCheck};linkRows.push(item);remove.addEventListener('click',()=>{row.remove();linkRows=linkRows.filter(x=>x!==item);host.dispatchEvent(new Event('input',{bubbles:true}));});
        row.append(legend,place,relation,notes,source,pl,remove);rows.append(row);places().then(items=>{if(!lifetime.active)return;for(const p of items){const o=el('option','',p.name+(p.kind==='survey'?' · 调查点':''));o.value=p.kind+':'+p.id;place.append(o);}if(link.placeId){const key=(link.placeKind||'reference')+':'+link.placeId;if(![...place.options].some(o=>o.value===key)){const o=el('option','','未匹配地点 · '+link.placeId);o.value=key;place.append(o);}place.value=key;}});
      }
      for(const link of retainedLinks)linkRow(link);add.addEventListener('click',()=>{linkRow();host.dispatchEvent(new Event('input',{bubbles:true}));});
    }
    return {focus:()=>inputs.displayName.focus(),destroy:()=>{lifetime.active=false;},read:()=>{
      const result={id:draftId,...(record.updatedAt?{updatedAt:record.updatedAt}:{})};for(const [key,input] of Object.entries(inputs))result[key]=input.type==='checkbox'?input.checked:input.value.trim();result.aliases=split(result.aliases);result.roles=split(result.roles);result.deityIds=[...deityIds];
      result.placeLinks=options.places===false?retainedLinks:linkRows.map(r=>{const splitAt=r.place.value.indexOf(':');return {id:r.id,placeKind:r.place.value.slice(0,splitAt),placeId:r.place.value.slice(splitAt+1),relationType:r.relation.value,notes:r.notes.value.trim(),source:r.source.value.trim(),public:r.publicCheck.checked};});return result;
    }};
  }
  return {uid,element:el,confirm,profileURL,mapURL,roles,relations,narratorRoles,createCatalog,createFields,places};
})();
