(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.PlannerCore, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlannerDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, root) {
  'use strict';
  function monthStart(value) { return value.slice(0, 7) + '-01'; }
  function shiftMonth(value, amount) {
    if (!C.isDate(value) || !Number.isInteger(amount)) return null;
    const [year, month, day] = value.split('-').map(Number), total = (year - 1) * 12 + month - 1 + amount;
    if (total < 0 || total >= 9999 * 12) return null;
    const y = Math.floor(total / 12) + 1, m = total % 12 + 1;
    const end = new Date(0); end.setUTCFullYear(y, m, 0);
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(day, end.getUTCDate())).padStart(2, '0');
  }
  function weekday(value) { const d = new Date(0); const p = value.split('-').map(Number); d.setUTCFullYear(p[0], p[1] - 1, p[2]); return (d.getUTCDay() + 6) % 7; }
  function monthGrid(value) {
    if (!C.isDate(value)) return [];
    const start = monthStart(value), offset = weekday(start);
    return Array.from({ length: 42 }, (_, i) => { try { return C.addDays(start, i - offset); } catch (_) { return null; } });
  }
  function allowed(value, min, max) { return C.isDate(value) && (!C.isDate(min) || value >= min) && (!C.isDate(max) || value <= max); }
  function monthAllowed(value, min, max) {
    if (!C.isDate(value)) return false;
    const start = monthStart(value), next = shiftMonth(start, 1), end = next ? C.addDays(next, -1) : '9999-12-31';
    return (!C.isDate(min) || end >= min) && (!C.isDate(max) || start <= max);
  }
  const api = { shiftMonth, monthGrid, allowed, monthAllowed };
  if (!root || !root.document) return api;
  const components = new WeakMap();
  let serial = 0, active = null, observer = null, frame = null;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => C.todayInZone('Asia/Shanghai');
  function labelFor(input) {
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
    return Array.from(input.labels || []).map(label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,button,.date-picker').forEach(el => el.remove()); return copy.textContent.trim(); }).filter(Boolean).join(' ') || '日期';
  }
  function sync(component) {
    const { input, trigger, value } = component;
    value.textContent = input.value ? input.value.replace(/-/g, '/') : '选择日期';
    trigger.classList.toggle('is-empty', !input.value);
    trigger.disabled = input.disabled;
    trigger.setAttribute('aria-label', labelFor(input) + '：' + (input.value || '未设置'));
    trigger.setAttribute('aria-required', String(input.required));
    if (input.validity.valid) trigger.removeAttribute('aria-invalid');
  }
  function close(restoreFocus) {
    if (!active) return;
    const component = active; active = null;
    if (observer) { observer.disconnect(); observer = null; }
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    if (component.menu) { try { if (component.menu.matches(':popover-open')) component.menu.hidePopover(); } catch (_) {} component.menu.remove(); component.menu = null; }
    component.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && component.trigger.isConnected) component.trigger.focus({ preventScroll: true });
  }
  function position() {
    if (!active) return;
    const { trigger, menu } = active, r = trigger.getBoundingClientRect();
    if (!trigger.isConnected || r.bottom < 0 || r.top > innerHeight) return close();
    const width = Math.min(304, innerWidth - 16);
    menu.style.width = width + 'px'; menu.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + 'px';
    menu.style.top = r.bottom + 7 + 'px'; menu.style.maxHeight = Math.max(80, innerHeight - r.bottom - 15) + 'px';
  }
  function schedulePosition(event) {
    if (!active || active.menu.contains(event.target)) return;
    if (frame === null) frame = requestAnimationFrame(() => { frame = null; position(); });
  }
  function makeRoom(trigger) {
    let needed = Math.min(370, innerHeight * .65) - (innerHeight - trigger.getBoundingClientRect().bottom - 15);
    for (let el = trigger.parentElement; el && el !== document.body && needed > 0; el = el.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight) continue;
      const before = el.scrollTop; el.scrollTop += needed; needed -= el.scrollTop - before;
    }
    if (needed > 0) window.scrollBy({ top: needed, behavior: 'instant' });
  }
  function control(text, action, label, disabled) { return '<button type="button" class="date-control" data-date-action="' + action + '" aria-label="' + escape(label) + '"' + (disabled ? ' disabled' : '') + '>' + text + '</button>'; }
  function draw(component, focusDate) {
    const { menu, input } = component, year = Number(component.month.slice(0, 4)), month = Number(component.month.slice(5, 7));
    const previous = shiftMonth(component.month, component.view === 'months' ? -12 : -1), next = shiftMonth(component.month, component.view === 'months' ? 12 : 1);
    const header = control('‹', 'previous', component.view === 'months' ? '上一年' : '上个月', !previous || !monthAllowed(previous, input.min, input.max) && component.view !== 'months') +
      (component.view === 'months' ? '<label class="date-year-label"><span class="sr-only">年份</span><input class="date-year" type="number" min="1" max="9999" value="' + year + '" aria-label="年份"></label>' : '<button type="button" class="date-period" data-date-action="months" aria-label="选择年月">' + year + ' 年 ' + month + ' 月<span aria-hidden="true">⌄</span></button>') +
      control('›', 'next', component.view === 'months' ? '下一年' : '下个月', !next || !monthAllowed(next, input.min, input.max) && component.view !== 'months');
    let body;
    if (component.view === 'months') {
      body = '<div class="date-month-grid">' + Array.from({ length: 12 }, (_, i) => {
        const value = String(year).padStart(4, '0') + '-' + String(i + 1).padStart(2, '0') + '-01';
        return '<button type="button" class="date-month' + (month === i + 1 ? ' selected' : '') + '" data-date-month="' + value + '"' + (!monthAllowed(value, input.min, input.max) ? ' disabled' : '') + '>' + (i + 1) + ' 月</button>';
      }).join('') + '</div>';
    } else {
      body = '<div class="date-weekdays" aria-hidden="true">' + ['一','二','三','四','五','六','日'].map(d => '<span>' + d + '</span>').join('') + '</div><div class="date-days" role="group" aria-label="选择日期">' + monthGrid(component.month).map(value => {
        if (!value) return '<span></span>';
        const disabled = !allowed(value, input.min, input.max), selected = value === input.value;
        return '<button type="button" class="date-day' + (value.slice(0, 7) !== component.month.slice(0, 7) ? ' outside' : '') + (value === today() ? ' today' : '') + (selected ? ' selected' : '') + '" data-date-value="' + value + '" aria-label="' + value + '" aria-pressed="' + selected + '"' + (value === today() ? ' aria-current="date"' : '') + (disabled ? ' disabled' : '') + ' tabindex="-1">' + Number(value.slice(-2)) + '</button>';
      }).join('') + '</div>';
    }
    menu.innerHTML = '<div class="date-menu-header">' + header + '</div>' + body + '<div class="date-menu-footer">' + (!input.required ? control('清除', 'clear', '清除日期') : '<span class="date-footer-hint">选择一天</span>') + control('今天', 'today', '选择今天', !allowed(today(), input.min, input.max)) + '</div>';
    if (component.view === 'days') {
      const cells = Array.from(menu.querySelectorAll('.date-day:not(:disabled)'));
      const current = cells.find(el => el.dataset.dateValue === focusDate) || cells.find(el => el.dataset.dateValue === input.value) || cells.find(el => el.dataset.dateValue === today()) || cells.find(el => !el.classList.contains('outside'));
      if (current) { current.tabIndex = 0; if (focusDate) current.focus({ preventScroll: true }); }
    }
    position();
  }
  function choose(component, value) {
    if (value === '' ? component.input.required : !allowed(value, component.input.min, component.input.max)) return;
    const changed = component.input.value !== value;
    component.input.value = value; sync(component); close(true);
    if (changed) { component.input.dispatchEvent(new Event('input', { bubbles: true })); component.input.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function open(component) {
    if (component.input.disabled) return;
    close(); window.PlannerSelect.close(); window.PlannerEditor.close(); sync(component); makeRoom(component.trigger);
    let value = component.input.value || today();
    if (C.isDate(component.input.min) && value < component.input.min) value = component.input.min;
    if (C.isDate(component.input.max) && value > component.input.max) value = component.input.max;
    component.month = monthStart(value); component.view = 'days';
    const menu = document.createElement('div'); component.menu = menu;
    menu.className = 'date-menu'; menu.id = component.input.id + '-calendar'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', labelFor(component.input) + '日历');
    if (typeof menu.showPopover === 'function') menu.setAttribute('popover', 'manual');
    (component.input.closest('dialog[open]') || document.body).appendChild(menu); active = component;
    draw(component);
    if (menu.hasAttribute('popover')) { try { menu.showPopover(); } catch (_) { menu.removeAttribute('popover'); } }
    component.trigger.setAttribute('aria-expanded', 'true');
    const initial = menu.querySelector('.date-day[tabindex="0"]'); if (initial) initial.focus({ preventScroll: true });
    menu.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.dataset.dateValue) return choose(component, button.dataset.dateValue);
      if (button.dataset.dateMonth) { component.month = button.dataset.dateMonth; component.view = 'days'; draw(component, component.month); return; }
      const action = button.dataset.dateAction;
      if (action === 'clear' || action === 'today') return choose(component, action === 'clear' ? '' : today());
      if (action === 'months') component.view = 'months';
      else { const next = shiftMonth(component.month, (action === 'previous' ? -1 : 1) * (component.view === 'months' ? 12 : 1)); if (next) component.month = next; }
      draw(component); if (action === 'months') menu.querySelector('.date-year').focus({ preventScroll: true });
    });
    menu.addEventListener('input', event => {
      if (!event.target.classList.contains('date-year')) return;
      const year = Number(event.target.value);
      if (!Number.isInteger(year) || year < 1 || year > 9999) return;
      component.month = String(year).padStart(4, '0') + component.month.slice(4);
      menu.querySelectorAll('[data-date-month]').forEach(button => {
        const value = String(year).padStart(4, '0') + button.dataset.dateMonth.slice(4);
        button.dataset.dateMonth = value; button.disabled = !monthAllowed(value, component.input.min, component.input.max);
      });
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      const cell = event.target.closest('[data-date-value]'); if (!cell) return;
      const value = cell.dataset.dateValue; let target;
      try {
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) target = C.addDays(value, ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[event.key]);
        if (event.key === 'Home' || event.key === 'End') target = C.addDays(value, (event.key === 'Home' ? 0 : 6) - weekday(value));
        if (event.key === 'PageUp' || event.key === 'PageDown') target = shiftMonth(value, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
      } catch (_) {}
      if (target) { event.preventDefault(); if (allowed(target, component.input.min, component.input.max)) { component.month = monthStart(target); draw(component, target); } }
    });
    observer = new MutationObserver(() => { if (active === component && !component.trigger.isConnected) close(); }); observer.observe(document.body, { childList: true, subtree: true });
  }
  function enhance(container) {
    container.querySelectorAll('input[type="date"]').forEach(input => {
      if (components.has(input)) return sync(components.get(input));
      if (!input.id) input.id = 'planner-date-' + (++serial);
      const wrapper = document.createElement('div'); wrapper.className = 'date-picker';
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'date-trigger'; trigger.id = input.id + '-trigger';
      trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', input.id + '-calendar'); trigger.setAttribute('aria-expanded', 'false');
      const value = document.createElement('span'); value.className = 'date-value';
      trigger.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="4.5" width="14" height="13" rx="2"></rect><path d="M6.5 2.5v4m7-4v4M3 8.5h14"></path></svg>';
      trigger.prepend(value); input.parentNode.insertBefore(wrapper, input); wrapper.append(input, trigger);
      input.classList.add('date-native'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
      const component = { input, wrapper, trigger, value, menu: null }; components.set(input, component); sync(component);
      trigger.addEventListener('click', () => active === component ? close(true) : open(component));
      trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); open(component); } });
      input.addEventListener('change', () => sync(component));
      input.addEventListener('invalid', event => { event.preventDefault(); trigger.setAttribute('aria-invalid', 'true'); open(component); });
    });
  }
  document.addEventListener('pointerdown', event => { if (active && !active.wrapper.contains(event.target) && !active.menu.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (active && !active.wrapper.contains(event.target) && !active.menu.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }, true);
  document.addEventListener('click', event => {
    const label = event.target.closest('label'); if (!label || event.target.closest('button,input,a,.date-picker')) return;
    const component = components.get(label.control); if (component) { event.preventDefault(); component.trigger.focus(); open(component); }
  }, true);
  document.addEventListener('scroll', schedulePosition, true); window.addEventListener('resize', position);
  return Object.assign(api, { enhance, close });
});
