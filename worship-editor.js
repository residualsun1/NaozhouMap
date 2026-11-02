/* Edit one existing deity-place link through the shared faith API. */
'use strict';
window.createWorshipEditor = ({beforeOpen = () => true, onSaved = async () => {}} = {}) => {
  const el = window.DeityAtlas.element, W = window.FaithWorship;
  let dialog = null, dirty = false, busy = false, revision = null, target = null, opener = null;
  let scope, surname, surnameLabel, status, fields, discard, reload, submit;
  const button = (text, handler, cls = '') => { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', handler); return node; };
  async function request(body) {
    const response = await (window.NaozhouCloud?.request || fetch)('/api/faith', body ? {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
    } : {cache: 'no-store'});
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || '信仰资料暂未能读取。'), {status: response.status});
    return result;
  }
  async function loadCurrent(context = target) {
    const state = await request();
    if (!dialog || context !== target) throw Error('编辑窗口已关闭。');
    const record = state.records.find(record => record.id === target.recordId);
    const link = record?.deityLinks?.find(link => link.id === target.linkId);
    if (!link || link.deityId !== target.deityId || record.villageId !== target.villageId || record.villageKind !== target.villageKind) {
      throw Error('此关联已移除或变更，请关闭后重新选择。');
    }
    revision = state.revision;
    return link;
  }
  function close(force = false) {
    if (busy || !dialog) return;
    if (dirty && !force) { discard.hidden = false; return; }
    dialog.close(); dialog.remove(); dialog = null; dirty = false;
    const replacement = [...document.querySelectorAll('[data-worship-link]')].find(node => node.dataset.worshipLink === target.linkId);
    (opener?.isConnected ? opener : replacement)?.focus();
  }
  function syncScope() { surnameLabel.hidden = scope.value !== 'specific_surname'; surname.required = !surnameLabel.hidden; surname.setCustomValidity(''); }
  async function save(event) {
    event.preventDefault();
    if (busy || revision === null || !dialog.querySelector('form').reportValidity()) return;
    let values;
    try { values = W.normalize({worship_scope: scope.value, worship_surname: surname.value}); }
    catch (error) { surname.setCustomValidity(error.message); surname.reportValidity(); return; }
    busy = true; fields.disabled = submit.disabled = true; status.textContent = '保存中…'; reload.hidden = true;
    try {
      const result = await request({version: 1, action: 'update-worship', revision, ...target, ...values});
      try { localStorage.setItem('naozhou-faith-changed', JSON.stringify({revision: result.faithRevision, at: Date.now()})); } catch {}
      document.dispatchEvent(new Event('naozhou-faith-change'));
      dirty = false; await onSaved(result); busy = false; close(true);
    } catch (error) { status.textContent = error.message; reload.hidden = error.status !== 409; }
    finally { busy = false; if (dialog) fields.disabled = submit.disabled = revision === null; }
  }
  async function open(value) {
    if (dialog || !beforeOpen() || window.NaozhouCloud && !await window.NaozhouCloud.requireEditor()) return;
    target = value; opener = document.activeElement; revision = null; dirty = false;
    dialog = el('dialog', 'worship-dialog'); dialog.setAttribute('aria-labelledby', 'worship-title');
    const form = el('form'), heading = el('h2', '', '编辑供奉信息'); heading.id = 'worship-title';
    const context = el('p', 'worship-context', [value.deityName + ' · ' + value.villageName, value.recordLabel].filter(Boolean).join('\n'));
    fields = el('fieldset'); fields.disabled = true;
    const scopeLabel = el('label', '', '供奉范围'); scope = el('select'); scope.id = 'worship-scope'; scopeLabel.htmlFor = scope.id;
    for (const [id, name] of [['unknown', '尚未确认'], ['specific_surname', '特定姓氏供奉'], ['village_wide', '全村共同供奉']]) {
      const option = el('option', '', name); option.value = id; scope.append(option);
    }
    scopeLabel.append(scope);
    surnameLabel = el('label', '', '供奉姓氏'); surname = el('input'); surname.id = 'worship-surname'; surname.maxLength = 40;
    surname.placeholder = '如：陈或欧阳'; surnameLabel.htmlFor = surname.id; surnameLabel.append(surname);
    fields.append(scopeLabel, surnameLabel);
    const actions = el('div', 'button-row form-actions'); submit = el('button', 'primary', '保存供奉信息'); submit.type = 'submit'; submit.disabled = true;
    actions.append(submit, button('取消', () => close()));
    status = el('p', 'status', '正在读取关联…'); status.setAttribute('role', 'status');
    reload = button('重新载入关联', async () => {
      if (busy) return; busy = true; fields.disabled = true;
      try { const link = await loadCurrent(); status.textContent = '当前服务器：' + W.description(link) + '。请核对填写内容后再次保存。'; reload.hidden = true; }
      catch (error) { status.textContent = error.message; }
      finally { busy = false; fields.disabled = submit.disabled = revision === null; }
    }, 'linkbutton'); reload.hidden = true;
    discard = el('div', 'worship-discard'); discard.hidden = true;
    discard.append(el('p', '', '供奉信息尚未保存。'), button('继续填写', () => { discard.hidden = true; }), button('放弃修改', () => close(true)));
    form.append(heading, context, fields, actions, status, reload, discard); dialog.append(form); document.body.append(dialog); dialog.showModal(); syncScope();
    form.addEventListener('input', () => { dirty = true; surname.setCustomValidity(''); });
    scope.addEventListener('change', () => { dirty = true; syncScope(); });
    form.addEventListener('submit', save); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    const currentDialog = dialog;
    try { const link = await loadCurrent(), info = W.info(link); if(dialog!==currentDialog)return; scope.value = info.worship_scope; surname.value = info.worship_surname || ''; syncScope(); fields.disabled = submit.disabled = false; status.textContent = ''; scope.focus(); }
    catch (error) { if(dialog!==currentDialog)return; status.textContent = error.message; reload.hidden = false; }
  }
  return {open, get dirty() { return dirty; }, get saving() { return busy; }, mayLeave() { return !busy && !dirty; }};
};
