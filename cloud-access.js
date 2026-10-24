/* Netlify-only editor sessions. Local PowerShell storage stays unchanged. */
(() => {
  if (document.documentElement.dataset.deployment !== 'netlify') return;
  const $ = id => document.getElementById(id);
  const dialog = $('cloud-login'), form = $('cloud-login-form');
  let editable=false, pendingLogin=null, finishLogin=null, canChangePassword=false, changingPassword=false;
  const access=$('cloud-access'),accessButton=$('cloud-access-button');
  const changeButton=document.createElement('button');
  changeButton.type='button';changeButton.id='cloud-password-change';changeButton.textContent='更改口令';changeButton.hidden=true;
  const accessActions=document.createElement('div');accessActions.className='cloud-access-actions';
  accessButton.before(accessActions);accessActions.append(changeButton,accessButton);
  const passwordDialog=document.createElement('dialog');passwordDialog.id='cloud-password-dialog';passwordDialog.className='cloud-login cloud-password-dialog';passwordDialog.setAttribute('aria-labelledby','cloud-password-title');
  const passwordForm=document.createElement('form'),passwordTitle=document.createElement('h2');passwordTitle.id='cloud-password-title';passwordTitle.textContent='更改编辑口令';passwordForm.append(passwordTitle);
  const passwordHelp=document.createElement('p');passwordHelp.id='cloud-password-help';passwordHelp.className='note';passwordHelp.textContent='新口令为 8–128 个字符。';passwordForm.append(passwordHelp);
  const passwordFields={};
  for(const [key,labelText,autocomplete] of [['currentPassword','当前口令','current-password'],['newPassword','新口令','new-password'],['confirmation','再次输入新口令','new-password']]){
    const label=document.createElement('label'),input=document.createElement('input');input.id='cloud-change-'+key;input.name=key;input.type='password';input.autocomplete=autocomplete;input.required=true;input.maxLength=128;
    if(key!=='currentPassword'){input.minLength=8;input.setAttribute('aria-describedby',passwordHelp.id);}
    if(key==='currentPassword')input.maxLength=2048;
    label.htmlFor=input.id;label.textContent=labelText;passwordFields[key]=input;passwordForm.append(label,input);
  }
  const passwordStatus=document.createElement('p');passwordStatus.id='cloud-password-change-status';passwordStatus.className='status';passwordStatus.setAttribute('role','status');passwordStatus.setAttribute('aria-live','polite');
  const passwordActions=document.createElement('div');passwordActions.className='button-row form-actions';
  const passwordSave=document.createElement('button'),passwordCancel=document.createElement('button');passwordSave.type='submit';passwordSave.className='primary';passwordSave.textContent='保存新口令';passwordCancel.type='button';passwordCancel.textContent='取消';passwordActions.append(passwordSave,passwordCancel);passwordForm.append(passwordStatus,passwordActions);passwordDialog.append(passwordForm);document.body.append(passwordDialog);
  function updateCapability(result){if(typeof result?.canChangePassword==='boolean')canChangePassword=result.canChangePassword;changeButton.hidden=!editable||!canChangePassword;changeButton.disabled=changingPassword;}
  function showAccess(value,reason='session') {
    editable=value;
    $('cloud-access').hidden=false;
    $('cloud-access-button').textContent=value?'退出编辑':'登录编辑';
    $('cloud-access-status').textContent=value?'已登录 · 云端保存':'公开浏览 · 登录后可编辑';
    updateCapability();
    document.dispatchEvent(new CustomEvent('naozhou-access-change',{detail:{editable:value,reason}}));
  }
  function login() {
    if (pendingLogin) return pendingLogin;
    $('cloud-login-status').textContent='';
    dialog.showModal();$('cloud-password').focus();
    pendingLogin=new Promise(resolve=>{finishLogin=resolve;});
    return pendingLogin;
  }
  dialog.addEventListener('close',()=>{
    $('cloud-password').value='';
    finishLogin?.(editable);finishLogin=null;pendingLogin=null;
  });
  $('cloud-login-cancel').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('cloud-password').value})});
      const result=await response.json();
      if (!response.ok) throw Error(result.error||'登录未完成。');
      updateCapability(result);
      if(typeof result.canChangePassword!=='boolean'){
        try{const accessResponse=await fetch('/api/auth',{cache:'no-store'});if(accessResponse.ok)updateCapability(await accessResponse.json());}catch{}
      }
      showAccess(true);dialog.close();
    } catch(error) {$('cloud-login-status').textContent=error.message;}
    finally {submit.disabled=false;}
  });
  $('cloud-access-button').addEventListener('click',async()=>{
    if (!editable) {await login();return;}
    if (!document.dispatchEvent(new CustomEvent('naozhou-before-logout',{cancelable:true}))) return;
    const response=await fetch('/api/auth',{method:'DELETE'});
    if (response.ok) showAccess(false,'logout');
  });
  changeButton.addEventListener('click',()=>{
    if(!editable||!canChangePassword||changingPassword)return;
    if(!document.dispatchEvent(new CustomEvent('naozhou-before-logout',{cancelable:true})))return;
    passwordForm.reset();passwordStatus.textContent='';passwordDialog.showModal();passwordFields.currentPassword.focus();
  });
  passwordCancel.addEventListener('click',()=>{if(!changingPassword)passwordDialog.close();});
  passwordDialog.addEventListener('cancel',event=>{if(changingPassword)event.preventDefault();});
  passwordDialog.addEventListener('close',()=>{passwordForm.reset();for(const input of Object.values(passwordFields))input.value='';passwordFields.confirmation.setCustomValidity('');passwordStatus.textContent='';if(editable&&!changeButton.hidden)changeButton.focus();});
  passwordFields.confirmation.addEventListener('input',()=>passwordFields.confirmation.setCustomValidity(''));
  passwordFields.newPassword.addEventListener('input',()=>passwordFields.confirmation.setCustomValidity(''));
  passwordForm.addEventListener('submit',async event=>{
    event.preventDefault();if(changingPassword)return;
    passwordFields.confirmation.setCustomValidity(passwordFields.newPassword.value===passwordFields.confirmation.value?'':'两次输入的新口令不一致。');
    if(!passwordForm.reportValidity())return;
    changingPassword=true;passwordSave.disabled=passwordCancel.disabled=true;for(const input of Object.values(passwordFields))input.readOnly=true;updateCapability();passwordStatus.textContent='正在保存…';
    try{
      const response=await fetch('/api/auth',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:passwordFields.currentPassword.value,newPassword:passwordFields.newPassword.value,confirmation:passwordFields.confirmation.value})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'口令未能更改，填写内容已保留。');
      updateCapability(result);showAccess(true,'password-change');passwordDialog.close();$('cloud-access-status').textContent='编辑口令已更改 · 云端保存';
    }catch(error){passwordStatus.textContent=error.message||'连接暂不可用，填写内容已保留。';}
    finally{changingPassword=false;passwordSave.disabled=passwordCancel.disabled=false;for(const input of Object.values(passwordFields))input.readOnly=false;updateCapability();}
  });
  const ready=fetch('/api/auth',{cache:'no-store'}).then(async response=>{
    if (!response.ok) throw Error();
    const result=await response.json();updateCapability(result);showAccess(!!result.editable);
  }).catch(()=>{showAccess(false);$('cloud-access-status').textContent='云端连接暂不可用';});
  window.NaozhouCloud={
    ready,
    get editable(){return editable;},
    async requireEditor(){await ready;return editable || await login();},
    async request(url,options={}) {
      await ready;
      let response=await fetch(url,options);
      if (response.status===401 && options.method==='POST') {
        showAccess(false);
        if (await login()) response=await fetch(url,options);
      }
      return response;
    }
  };
})();
