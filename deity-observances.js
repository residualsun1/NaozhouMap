window.DeityObservances = (() => {
  'use strict';
  const {element: el} = window.DeityAtlas;
  const months = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'].map(month => month+'月');
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const days = [...digits.map(day => '初'+day), '初十', ...digits.map(day => '十'+day), '二十', ...digits.map(day => '廿'+day), '三十'];

  function field(host, title, control) {
    const label = el('label', 'observance-field');
    label.append(el('span', '', title), control);
    host.append(label);
    return control;
  }

  function lunarSelect(host, title, options, value) {
    const select = field(host, title, el('select'));
    select.add(new Option('未填写', ''));
    options.forEach((label, index) => select.add(new Option(label, String(index+1))));
    select.value = value == null ? '' : String(value);
    return select;
  }

  function createFields(host, record) {
    const date = el('fieldset', 'observance-date');
    date.append(el('legend', '', '神明诞辰'));
    const month = lunarSelect(date, '农历月份', months, record.birthdayMonth);
    const day = lunarSelect(date, '农历日期', days, record.birthdayDay);
    const time = el('input');
    time.type = 'text';
    time.maxLength = 1000;
    time.placeholder = '例如：农历每月十八日';
    time.value = record.rotationTime || '';
    host.replaceChildren(date);
    field(host, '过衙／迓时间', time);
    return () => ({
      birthdayMonth: month.value ? Number(month.value) : null,
      birthdayDay: day.value ? Number(day.value) : null,
      rotationTime: time.value.trim()
    });
  }

  function render(host, record) {
    const month = months[record.birthdayMonth-1] || '';
    const day = days[record.birthdayDay-1] || '';
    if (month || day) {
      const section = el('section', 'deity-section');
      section.append(el('h3', '', '神明诞辰'), el('p', 'archive-prose', '农历'+month+day));
      host.append(section);
    }
    if (record.rotationTime) {
      const section = el('div', 'deity-section');
      const time = el('p', 'archive-prose');
      time.append(el('strong', '', '过衙／迓时间：'), record.rotationTime);
      section.append(time);
      host.append(section);
    }
  }

  return {createFields, render};
})();
