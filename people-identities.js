/* Identity definitions share the people catalog and its existing editor permission. */
(() => {
  'use strict';
  const A=window.PeopleArchive,el=A.element;let activeDialog=null;
  window.managePersonIdentities=async catalog=>{
    if(activeDialog){activeDialog.focus();return;}
    if(window.NaozhouCloud&&!await window.NaozhouCloud.requireEditor())return;
    try{if(!catalog.state?.editable)await catalog.load();if(!catalog.state?.editable)throw Error('目前没有编辑权限。');}
    catch(error){await A.confirm(error.message,'关闭');return;}
    const dialog=el('dialog','people-identities-dialog'),header=el('header','people-identities-header'),close=el('button','linkbutton','关闭');close.type='button';
    header.append(el('h2','','管理身份类型'),close);dialog.setAttribute('aria-label','管理身份类型');
    const intro=el('p','people-identities-intro','身份可多选；归档类型保留原有关联。管理人数含已归档人物。'),list=el('div','people-identity-list'),preview=el('section','people-identity-delete'),form=el('form','people-identity-form'),title=el('h3','','新增身份类型');
    const nameLabel=el('label','','身份名称'),name=el('input'),descriptionLabel=el('label','','身份说明（选填）'),description=el('textarea'),actions=el('div','button-row'),save=el('button','primary','新增身份'),cancelEdit=el('button','','取消编辑'),status=el('p','status');
    name.id='identity-name';nameLabel.htmlFor=name.id;name.required=true;name.maxLength=100;name.autocomplete='off';description.id='identity-description';descriptionLabel.htmlFor=description.id;description.rows=2;description.maxLength=3000;
    save.type='submit';cancelEdit.type='button';cancelEdit.hidden=true;actions.append(save,cancelEdit);form.append(title,nameLabel,name,descriptionLabel,description,actions);status.setAttribute('role','status');status.setAttribute('aria-live','polite');preview.hidden=true;dialog.append(header,intro,list,preview,form,status);
    let editingId=null,dirty=false,busy=false,pendingDelete=null;
    const usage=id=>catalog.state?.identityStats?.byId?.[id]?.total||0;
    function reset(){editingId=null;dirty=false;form.reset();title.textContent='新增身份类型';save.textContent='新增身份';cancelEdit.hidden=true;}
    async function run(action,message){
      if(busy)return;busy=true;dialog.inert=true;status.textContent='保存中…';
      try{await action();status.textContent=message;render();}
      catch(error){status.textContent=error.message;if(error.identityInUse)render();}
      finally{busy=false;dialog.inert=false;}
    }
    async function edit(type){if(dirty&&!await A.confirm('当前身份名称或说明尚未保存，要放弃填写吗？','放弃填写'))return;editingId=type.id;dirty=false;name.value=type.name;description.value=type.description||'';title.textContent='编辑身份类型';save.textContent='保存身份';cancelEdit.hidden=false;name.focus({preventScroll:true});form.scrollIntoView({block:'nearest'});}
    async function setActive(type){
      const count=usage(type.id),message=type.isActive?'归档「'+type.name+'」？'+(count?'现有 '+count+' 份人物关联将保留，':'')+'它将退出普通筛选和新增身份选项。':'恢复「'+type.name+'」为启用身份？';
      if(!await A.confirm(message,type.isActive?'归档身份':'恢复身份'))return;
      run(async()=>{await catalog.manageIdentities('identity-status',{id:type.id,isActive:!type.isActive,confirm:true});if(pendingDelete===type.id)pendingDelete=null;},type.isActive?'身份已归档，历史关联已保留':'身份已恢复');
    }
    function renderDelete(){
      preview.replaceChildren();const type=A.identityTypes(catalog.state).find(type=>type.id===pendingDelete);preview.hidden=!type;if(!type)return;
      const count=usage(type.id);preview.append(el('h3','','删除「'+type.name+'」'),el('p','',count+' 份人物档案仍关联此身份。可选择归档，或将这些关联转移到其他启用身份后删除。'));
      const alternatives=A.identityTypes(catalog.state).filter(item=>item.isActive&&item.id!==type.id),row=el('div','button-row'),archive=el('button','','归档身份'),cancel=el('button','','取消');archive.type=cancel.type='button';archive.addEventListener('click',()=>setActive(type));cancel.addEventListener('click',()=>{pendingDelete=null;renderDelete();});row.append(archive,cancel);
      if(alternatives.length){
        const label=el('label','','转移到身份'),select=el('select'),blank=el('option','','请选择目标身份');blank.value='';select.append(blank);select.id='identity-reassign';label.htmlFor=select.id;
        for(const alternative of alternatives){const option=el('option','',alternative.name);option.value=alternative.id;select.append(option);}
        const transfer=el('button','','转移关联并删除');transfer.type='button';transfer.disabled=true;select.addEventListener('change',()=>{transfer.disabled=!select.value;});
        transfer.addEventListener('click',async()=>{const target=alternatives.find(item=>item.id===select.value);if(!target||!await A.confirm('将 '+count+' 份人物的「'+type.name+'」身份转移为「'+target.name+'」，然后删除原身份？人物档案及其其他关联保留。','转移并删除'))return;run(async()=>{await catalog.manageIdentities('identity-delete',{id:type.id,reassignToId:target.id,confirm:true});if(editingId===type.id)reset();pendingDelete=null;},'关联已转移，原身份已删除');});
        preview.append(label,select);row.prepend(transfer);
      }else preview.append(el('p','','暂无其他启用身份。请先新增替代类型，或使用归档。'));
      preview.append(row);
    }
    function render(){
      const types=A.identityTypes(catalog.state);list.replaceChildren();
      for(const [index,type]of types.entries()){
        const item=el('article','people-identity-row'),heading=el('div','people-identity-heading');heading.append(el('strong','',type.name),el('span','',usage(type.id)+' 人'+(type.isActive?'':' · 已停用')));item.append(heading);if(type.description)item.append(el('p','',type.description));
        const tools=el('div','people-identity-actions');
        function button(label,callback){const node=el('button','linkbutton',label);node.type='button';node.addEventListener('click',callback);tools.append(node);return node;}
        button('编辑',()=>edit(type));
        for(const [delta,label]of [[-1,'上移'],[1,'下移']]){const node=button(label,()=>{const ids=types.map(item=>item.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];run(()=>catalog.manageIdentities('identity-reorder',{orderedIds:ids}),'身份顺序已更新');});node.disabled=index+delta<0||index+delta>=types.length;node.setAttribute('aria-label',label+type.name);}
        button(type.isActive?'归档':'恢复',()=>setActive(type));button('删除',async()=>{if(usage(type.id)){pendingDelete=type.id;renderDelete();preview.scrollIntoView({block:'nearest'});return;}if(!await A.confirm('删除未关联人物的身份「'+type.name+'」？','删除身份'))return;run(async()=>{await catalog.manageIdentities('identity-delete',{id:type.id,confirm:true});if(editingId===type.id)reset();},'身份已删除');});
        item.append(tools);list.append(item);
      }
      if(!types.length)list.append(el('p','people-help','还没有身份类型，可在下方新增。'));renderDelete();
    }
    form.addEventListener('input',()=>{dirty=true;});
    form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;run(async()=>{await catalog.manageIdentities('identity-save',{identity:{...(editingId?{id:editingId}:{}),name:name.value,description:description.value}});reset();},'身份类型已保存');});
    cancelEdit.addEventListener('click',async()=>{if(!dirty||await A.confirm('放弃当前身份类型的修改？','放弃修改'))reset();});
    async function leave(){if(busy||catalog.saving)return;if(dirty&&!await A.confirm('身份名称或说明尚未保存，要放弃填写吗？','放弃填写'))return;dialog.close();}
    close.addEventListener('click',leave);dialog.addEventListener('cancel',event=>{event.preventDefault();leave();});
    const unsubscribe=catalog.subscribe(render),beforeUnload=event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}},beforeLogout=event=>{if(dirty||busy){event.preventDefault();status.textContent='请先保存或取消身份类型的修改。';}},access=event=>{if(event.detail?.reason==='logout')dialog.close();};
    window.addEventListener('beforeunload',beforeUnload);document.addEventListener('naozhou-before-logout',beforeLogout);document.addEventListener('naozhou-access-change',access);
    dialog.addEventListener('close',()=>{unsubscribe();window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('naozhou-before-logout',beforeLogout);document.removeEventListener('naozhou-access-change',access);dialog.remove();activeDialog=null;},{once:true});
    document.body.append(dialog);activeDialog=dialog;render();dialog.showModal();name.focus();
  };
})();
