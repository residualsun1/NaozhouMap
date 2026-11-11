/* Lunar observances and rotation schedules belong to the deity archive. */
window.DeityObservances = (() => {
  'use strict';
  const {element: el, uid, mapURL, entryURL} = window.DeityAtlas;
  const months = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const days = [...digits.map(n => '初'+n), '初十', ...digits.map(n => '十'+n), '二十', ...digits.map(n => '廿'+n), '三十'];
  const leapMonths = [['unknown','待考'],['regular','常月'],['leap','闰月']];
  const verification = [['pending','待核实'],['verified','已核实'],['variant','存在异说']];
  const visibility = [['editors','仅授权编辑者'],['public','公开']];
  const cycles = [['monthly','每农历月'],['yearly','每农历年'],['custom','自定义'],['unknown','待考']];
  const leapPolicies = [['unknown','待考'],['observe','照常举行'],['skip','不举行'],['separate','另行确定']];
  const recipients = [['village','村庄'],['household','家户'],['other','其他地点']];
  const statuses = [['scheduled','已排定'],['occurred','已确认发生'],['adjusted','调整'],['cancelled','取消']];
  const labelFor = (options, value) => options.find(([key]) => key === value)?.[1] || '';
  const placeName = id => window.PlaceNames.name('reference', id);

  function lunarLabel(date) {
    if (!date?.lunarYear && !date?.lunarMonth && !date?.lunarDay) return '';
    const year = date.lunarYear ? date.lunarYear+'年' : '';
    const month = date.lunarMonth ? (date.leapMonth === 'leap' ? '闰' : '')+months[date.lunarMonth-1]+'月' : '';
    const day = date.lunarDay ? days[date.lunarDay-1] : '';
    const missing = month && !day ? '，具体日期待考' : !month && day ? '（月份待考）' : !month ? '，月日待考' : '';
    const leap = date.leapMonth === 'unknown' && month ? ' · 闰月待考' : date.leapMonth === 'leap' && !month ? ' · 闰月' : '';
    return '农历'+year+month+day+missing+leap;
  }

  function action(text, callback, className = '') {
    const button = el('button', className, text);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  function field(host, title, control) {
    const label = el('label', 'observance-field');
    label.append(el('span', '', title), control);
    host.append(label);
    return control;
  }

  function select(host, title, options, value) {
    const control = field(host, title, el('select'));
    for (const [key, text] of options) control.add(new Option(text, key));
    control.value = value ?? options[0][0];
    return control;
  }

  function textField(host, title, value, maxLength, {required = false, multiline = false} = {}) {
    const input = field(host, title, el(multiline ? 'textarea' : 'input'));
    input.value = value || '';
    input.maxLength = maxLength;
    input.required = required;
    if (multiline) input.rows = 2;
    return input;
  }

  function lunarFields(host, data, {year = false, requiredYear = false, leap = true} = {}) {
    const grid = el('div', 'observance-date');
    host.append(grid);
    let yearInput;
    if (year) {
      yearInput = field(grid, '农历年份', el('input'));
      yearInput.type = 'number';
      yearInput.inputMode = 'numeric';
      yearInput.min = '1';
      yearInput.max = '9999';
      yearInput.required = requiredYear;
      yearInput.value = data.lunarYear ?? '';
    }
    const month = select(grid, '农历月份', [['','待考'], ...months.map((name, index) => [String(index+1), name+'月'])], String(data.lunarMonth ?? ''));
    const day = select(grid, '农历日期', [['','待考'], ...days.map((name, index) => [String(index+1), name])], String(data.lunarDay ?? ''));
    const leapMonth = leap ? select(grid, '闰月情况', leapMonths, data.leapMonth) : null;
    return {
      month,
      read() {
        return {
          ...(year ? {lunarYear: yearInput.valueAsNumber || null} : {}),
          lunarMonth: month.disabled ? null : Number(month.value) || null,
          lunarDay: Number(day.value) || null,
          ...(leap ? {leapMonth: leapMonth.value} : {})
        };
      }
    };
  }

  async function choosePlaces(initial, multiple, onSelect) {
    const title = multiple ? '选择适用村庄' : '选择接奉地点';
    const dialog = el('dialog', 'village-link-dialog');
    dialog.setAttribute('aria-label', title);
    const header = el('header', 'village-link-header');
    const close = action('×', () => dialog.close(), 'village-link-close');
    close.setAttribute('aria-label', '关闭地点选择');
    header.append(el('h2', '', title), close);
    const filters = el('div', 'village-link-filters');
    const area = select(filters, '行政归属', [['','全部行政归属']]);
    const query = field(filters, '搜索地名', el('input'));
    query.type = 'search';
    query.placeholder = '地点名称或别名';
    const list = el('div', 'village-link-list');
    list.append(el('p', 'village-link-empty', '正在读取地点索引…'));
    const selected = new Set(initial);
    const footer = el('div', 'village-link-footer');
    const count = el('span', 'village-link-total');
    const actions = el('div', 'village-link-actions');
    const clear = action('清除选择', () => { selected.clear(); render(); });
    const done = action('确认选择', () => { onSelect([...selected]); dialog.close(); }, 'primary');
    done.disabled = true;
    actions.append(clear, action('取消', () => dialog.close()), done);
    footer.append(count, actions);
    dialog.append(header, filters, list, footer);
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    document.body.append(dialog);
    dialog.showModal();
    query.focus();
    let places = [], areaNames = new Map();
    function updateCount() {
      count.textContent = selected.size ? '已选择 '+selected.size+' 个地点' : '未选择地点';
    }
    function render() {
      const visible = places.filter(place => (!area.value || place.administrativeAreaId === area.value) && window.PlaceNames.matches(place, query.value));
      list.replaceChildren();
      for (const place of visible) {
        const row = el('label', 'village-link-row');
        const input = el('input');
        input.type = multiple ? 'checkbox' : 'radio';
        input.name = 'observance-place';
        input.checked = selected.has(place.id);
        input.addEventListener('change', () => {
          if (!multiple) selected.clear();
          if (input.checked) selected.add(place.id);
          else selected.delete(place.id);
          updateCount();
        });
        const copy = el('span', 'village-link-row-text');
        copy.append(el('strong', '', place.name));
        if (areaNames.has(place.administrativeAreaId)) copy.append(el('small', '', areaNames.get(place.administrativeAreaId)));
        row.append(input, copy);
        list.append(row);
      }
      if (!visible.length) list.append(el('p', 'village-link-empty', '没有匹配的地点。'));
      updateCount();
    }
    try {
      const index = await window.DeityVillageLinks.loadIndex();
      if (!dialog.open) return;
      places = index.places.filter(place => !multiple || place.placeKind === 'natural_village' && !place.parentVillageId)
        .sort((a,b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
      areaNames = new Map(index.administrativeAreas.map(item => [item.id, item.committeeName]));
      for (const [id, name] of areaNames) area.add(new Option(name, id));
      query.addEventListener('input', render);
      area.addEventListener('change', render);
      done.disabled = false;
      render();
    } catch {
      list.replaceChildren(el('p', 'village-link-empty', '地点索引暂未读取，请关闭后重试。'));
    }
  }

  function placeField(host, label, initial, multiple, onChange) {
    const row = el('div', 'observance-place-field');
    const description = el('p', 'note');
    let selected = initial.slice();
    function describe() {
      description.textContent = selected.map(id => placeName(id) || '地点待核对').join('、') || (multiple ? '尚未限定适用村庄' : '尚未关联地点');
    }
    row.append(action(label, () => choosePlaces(selected, multiple, ids => {
      selected = ids;
      describe();
      onChange();
    })), description);
    host.append(row);
    describe();
    return () => selected.slice();
  }

  function journalField(host, placeId, initial) {
    const details = el('details', 'observance-journal');
    const summary = el('summary', '', initial ? '已关联田野日志' : '关联田野日志（可选）');
    details.append(summary);
    const choice = select(details, '田野日志', [['','未关联日志']]);
    const status = el('p','note');
    details.append(status);
    host.append(details);
    let entryId = initial || '', villageId = placeId(), sequence = 0;
    async function load() {
      if (!details.open) return;
      const version = ++sequence;
      choice.disabled = true;
      choice.replaceChildren(new Option('未关联日志',''));
      if (!villageId) {status.textContent='请先选择接奉地点。';return;}
      status.textContent='正在读取此地点的日志…';
      try {
        const response = await (window.NaozhouCloud?.request || fetch)('/api/field-entries?'+new URLSearchParams({placeKind:'reference',placeId:villageId}),{cache:'no-store'});
        if (!response.ok) throw Error();
        const result = await response.json();
        if (sequence !== version || !details.isConnected) return;
        for (const record of result.records) choice.add(new Option(record.title+(record.observedAt?' · '+record.observedAt:''),record.id));
        if (entryId && !result.records.some(record=>record.id===entryId)) choice.add(new Option('已记录的日志待核对',entryId));
        choice.value = entryId;
        choice.disabled = false;
        status.textContent = result.records.length ? '' : '此地点暂无可关联的田野日志。';
      } catch {if (sequence === version) status.textContent='日志暂未读取，请重新展开重试。';}
    }
    choice.addEventListener('input',()=>{entryId=choice.value;summary.textContent=entryId?'已关联田野日志':'关联田野日志（可选）';});
    details.addEventListener('toggle',load);
    return {
      read:()=>entryId,
      updatePlace(){
        if (villageId===placeId())return;
        villageId=placeId();entryId='';sequence++;
        summary.textContent='关联田野日志（可选）';
        load();
      }
    };
  }

  function collection(host, title, addLabel, initial, build, onChange) {
    const group = el('section', 'observance-editor-group');
    const heading = el('div', 'deity-relations-heading');
    const list = el('div', 'observance-editor-list');
    const rows = new Map();
    heading.append(el('h3', '', title), action('＋ '+addLabel, () => {
      add({}, true);
      onChange();
    }, 'linkbutton'));
    group.append(heading, list);
    host.append(group);
    function add(item, open = false) {
      const row = el('details', 'observance-editor-row');
      const summary = el('summary');
      const body = el('div', 'observance-editor-fields');
      const id = item.id || uid();
      const editor = build(body, item);
      const summarize = () => { summary.textContent = editor.title() || addLabel; };
      summarize();
      body.addEventListener('input', summarize);
      body.append(action('移除'+title, () => {
        rows.delete(id);
        row.remove();
        onChange();
        heading.querySelector('button').focus();
      }, 'linkbutton observance-remove'));
      rows.set(id, editor);
      row.open = open;
      row.append(summary, body);
      list.append(row);
      if (open) body.querySelector('input,select,textarea,button')?.focus();
    }
    for (const item of initial || []) add(item);
    return () => [...rows].map(([id, editor]) => ({id, ...editor.read()}));
  }

  function revealInvalid(event) {
    const host = event.currentTarget;
    for (let row = event.target.closest('details'); row && host.contains(row); row = row.parentElement.closest('details')) row.open = true;
  }

  function createFields(host, record, onChange) {
    host.replaceChildren();
    host.addEventListener('invalid', revealInvalid, true);
    const birthdays = collection(host, '神明诞辰', '添加诞辰记录', record.birthdays, (body, item) => {
      const date = lunarFields(body, item);
      const places = placeField(body, '选择适用村庄', item.applicablePlaceIds || [], true, onChange);
      const status = select(body, '核实状态', verification, item.verificationStatus);
      const access = select(body, '诞辰可见范围', visibility, item.visibility);
      const original = textField(body, '原始时间说法（公开时可见）', item.originalText, 1000, {multiline: true});
      const source = textField(body, '来源与补充说明（仅编辑者）', item.sourceNote, 4000, {multiline: true});
      return {title: () => lunarLabel(date.read()) || original.value, read: () => ({
        ...date.read(), applicablePlaceIds: places(), verificationStatus: status.value,
        visibility: access.value, originalText: original.value, sourceNote: source.value
      })};
    }, onChange);
    const rotations = collection(host, '过衙／迓', '新增轮祀安排', record.rotationGroups, (body, item) => {
      const name = textField(body, '轮祀组名称', item.name, 160, {required: true});
      const statue = textField(body, '神像辨识（仅编辑者）', item.statueLabel, 500);
      const scope = textField(body, '轮祀范围及地方说明（仅编辑者）', item.scopeDescription, 2000, {multiline: true});
      const access = select(body, '轮祀可见范围', visibility, item.visibility);
      const rules = collection(body, '固定周期', '新增固定周期', item.cycleRules, (rule, value) => {
        const type = select(rule, '周期类型', cycles, value.cycleType || 'unknown');
        const date = lunarFields(rule, value, {leap: false});
        const sync = () => { date.month.disabled = type.value !== 'yearly'; };
        type.addEventListener('input', sync);
        sync();
        const leap = select(rule, '闰月执行规则', leapPolicies, value.leapPolicy);
        const status = select(rule, '核实状态', verification, value.verificationStatus);
        const original = textField(rule, '原始时间说法（公开时可见）', value.originalText, 1000, {multiline: true});
        const source = textField(rule, '周期来源（仅编辑者）', value.sourceNote, 4000, {multiline: true});
        return {title: () => cycleLabel({cycleType: type.value, ...date.read(), originalText: original.value}), read: () => ({
          cycleType: type.value, ...date.read(), leapPolicy: leap.value, verificationStatus: status.value,
          originalText: original.value, sourceNote: source.value
        })};
      }, onChange);
      const batches = collection(body, '抽签排期', '新增排期批次', item.scheduleBatches, (batch, value) => {
        const title = textField(batch, '批次名称', value.name, 160, {required: true});
        const draw = el('fieldset', 'observance-draw');
        draw.append(el('legend', '', '抽签日期（农历，可选）'));
        batch.append(draw);
        const date = lunarFields(draw, value.drawDate || {}, {year: true});
        const scope = textField(batch, '批次适用范围或起止说明（仅编辑者）', value.scopeDescription, 2000, {multiline: true});
        const source = textField(batch, '排期来源（仅编辑者）', value.sourceNote, 4000, {multiline: true});
        const note = textField(batch, '批次备注（仅编辑者）', value.note, 4000, {multiline: true});
        const stops = collection(batch, '接奉站点', '新增接奉站点', value.stops, (stop, entry) => {
          const date = lunarFields(stop, entry, {year: true, requiredYear: true});
          const place = placeField(stop, '选择接奉地点', entry.placeId ? [entry.placeId] : [], false, () => {journal.updatePlace();onChange();});
          const original = textField(stop, '原始接奉地名（仅编辑者）', entry.originalPlaceName, 300);
          const recipient = select(stop, '接奉对象类型', recipients, entry.recipientType);
          const recipientNote = textField(stop, '接奉对象说明（仅编辑者）', entry.recipientNote, 2000, {multiline: true});
          const status = select(stop, '排期状态', statuses, entry.status);
          const note = textField(stop, '站点备注（仅编辑者）', entry.note, 4000, {multiline: true});
          const journal = journalField(stop, () => place()[0], entry.entryId);
          return {title: () => lunarLabel(date.read()), read: () => ({
            ...date.read(), placeId: place()[0] || null, originalPlaceName: original.value,
            recipientType: recipient.value, recipientNote: recipientNote.value, status: status.value, note: note.value,
            entryId: journal.read()
          })};
        }, onChange);
        return {title: () => title.value, read: () => {
          const parts = date.read();
          return {name: title.value, drawDate: parts.lunarYear || parts.lunarMonth || parts.lunarDay || parts.leapMonth !== 'unknown' ? parts : null,
            scopeDescription: scope.value, sourceNote: source.value, note: note.value, stops: stops()};
        }};
      }, onChange);
      return {title: () => name.value, read: () => ({name: name.value, statueLabel: statue.value, scopeDescription: scope.value,
        visibility: access.value, cycleRules: rules(), scheduleBatches: batches()})};
    }, onChange);
    return () => ({birthdays: birthdays(), rotationGroups: rotations()});
  }

  function cycleLabel(rule) {
    if (rule.cycleType === 'monthly') return '每农历月'+(rule.lunarDay ? days[rule.lunarDay-1]+'日' : '，具体日期待考');
    if (rule.cycleType === 'yearly') return '每年'+(lunarLabel(rule) || '农历日期待考');
    return rule.originalText || (rule.cycleType === 'custom' ? '自定义周期' : '周期待考');
  }

  function paragraph(host, value, label = '') {
    if (value) host.append(el('p', 'archive-prose', label ? label+'：'+value : value));
  }

  function placeLink(id) {
    const name = placeName(id);
    if (!name) return null;
    const link = el('a', '', name);
    link.href = mapURL('reference', id);
    return link;
  }

  function render(host, record) {
    if (record.birthdays?.length) {
      const section = el('section', 'deity-section observance-section');
      section.append(el('h3', '', '神明诞辰'));
      for (const item of record.birthdays) {
        const row = el('article', 'observance-reading-row');
        const date = lunarLabel(item);
        row.append(el('h4', '', date || item.originalText || '诞辰待考'));
        const status = [!date ? '日期待考' : '', labelFor(verification, item.verificationStatus), item.visibility === 'editors' ? '仅编辑者' : ''].filter(Boolean);
        row.append(el('p', 'note', status.join(' · ')));
        const places = el('p', 'observance-place-links');
        const links = (item.applicablePlaceIds || []).map(placeLink).filter(Boolean);
        const placeLabel = links.length ? '适用村庄' : item.applicablePlaceIds?.length ? '适用村庄地名待核对' : '尚未限定适用村庄';
        places.append(el('span', '', placeLabel), ...links);
        row.append(places);
        if (date) paragraph(row, item.originalText, '原始说法');
        paragraph(row, item.sourceNote, '来源');
        section.append(row);
      }
      host.append(section);
    }
    if (!record.rotationGroups?.length) return;
    const section = el('section', 'deity-section observance-section');
    section.append(el('h3', '', '过衙／迓'));
    for (const group of record.rotationGroups) {
      const row = el('article', 'observance-reading-row');
      row.append(el('h4', '', group.name));
      if (group.visibility === 'editors') row.append(el('p', 'note', '仅编辑者'));
      paragraph(row, group.statueLabel, '神像辨识');
      paragraph(row, group.scopeDescription);
      for (const rule of group.cycleRules || []) {
        const cycle = el('div', 'observance-cycle');
        paragraph(cycle, cycleLabel(rule), '固定周期');
        cycle.append(el('p', 'note', '闰月：'+labelFor(leapPolicies, rule.leapPolicy)+' · '+labelFor(verification, rule.verificationStatus)));
        if (rule.originalText !== cycleLabel(rule)) paragraph(cycle, rule.originalText, '原始说法');
        paragraph(cycle, rule.sourceNote, '来源');
        row.append(cycle);
      }
      for (const batch of group.scheduleBatches || []) {
        const details = el('details', 'observance-batch');
        details.dataset.batchKey = JSON.stringify([group.id, batch.id]);
        const count = batch.stops.length;
        details.append(el('summary', '', batch.name+(count ? ' · '+count+' 站' : '')));
        paragraph(details, lunarLabel(batch.drawDate), '抽签日期');
        paragraph(details, batch.scopeDescription);
        paragraph(details, batch.sourceNote, '排期来源');
        paragraph(details, batch.note, '备注');
        const stops = el('ul', 'observance-stops');
        for (const stop of batch.stops) {
          const item = el('li');
          const heading = el('div', 'observance-stop-heading');
          heading.append(el('strong', '', lunarLabel(stop)), el('span', 'deity-badge', labelFor(statuses, stop.status)));
          const place = placeLink(stop.placeId);
          item.append(heading, place || el('span', '', stop.originalPlaceName || '接奉地点待核对'));
          if (place && stop.originalPlaceName && stop.originalPlaceName !== place.textContent) paragraph(item, stop.originalPlaceName, '原始地名');
          if (stop.recipientType) paragraph(item, [labelFor(recipients, stop.recipientType), stop.recipientNote].filter(Boolean).join(' · '), '接奉对象');
          paragraph(item, stop.note, '备注');
          if (stop.entryId && stop.placeId) {
            const journal = el('a','observance-journal-link','查看相关田野日志 ↗');
            journal.href = entryURL('reference',stop.placeId,stop.entryId);
            item.append(journal);
          }
          stops.append(item);
        }
        if (count) details.append(stops);
        row.append(details);
      }
      section.append(row);
    }
    host.append(section);
  }
  return {createFields, render};
})();
