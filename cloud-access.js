/* Netlify-only editor sessions. Local PowerShell storage stays unchanged. */
(() => {
  if (document.documentElement.dataset.deployment !== 'netlify') return;
  const $ = id => document.getElementById(id);
  const dialog = $('cloud-login'), form = $('cloud-login-form');
  let editable=false, pendingLogin=null, finishLogin=null;
  function showAccess(value,reason='session') {
    editable=value;
    $('cloud-access').hidden=false;
    $('cloud-access-button').textContent=value?'退出编辑':'登录编辑';
    $('cloud-access-status').textContent=value?'已登录 · 云端保存':'公开浏览 · 登录后可编辑';
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
  const ready=fetch('/api/auth',{cache:'no-store'}).then(async response=>{
    if (!response.ok) throw Error();
    const result=await response.json();showAccess(!!result.editable);
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
