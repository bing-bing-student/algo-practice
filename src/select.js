(function () {
  'use strict';
  const components = new WeakMap();
  let serial = 0, active = null, frame = null, observer = null;

  function labelFor(select) {
    if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    const named = (select.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)).filter(Boolean).map(el => el.textContent.trim()).join(' ');
    if (named) return named;
    const text = Array.from(select.labels || []).map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('select, .picker, input, textarea, button').forEach(el => el.remove());
      return copy.textContent.trim();
    }).filter(Boolean).join(' ');
    return text || select.title || '选择选项';
  }
  function sync(component) {
    const { select, trigger, wrapper, value } = component;
    const selected = select.options[select.selectedIndex];
    value.textContent = selected ? selected.textContent : '请选择';
    trigger.title = value.textContent;
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.setAttribute('aria-required', String(select.required));
    wrapper.classList.toggle('is-disabled', select.disabled);
    if (select.validity.valid) { wrapper.classList.remove('is-invalid'); trigger.removeAttribute('aria-invalid'); }
  }
  function close(restoreFocus) {
    if (!active) return;
    const component = active;
    active = null;
    if (observer) { observer.disconnect(); observer = null; }
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    const menu = component.menu;
    component.menu = null;
    component.items = [];
    component.trigger.setAttribute('aria-expanded', 'false');
    component.trigger.removeAttribute('aria-activedescendant');
    component.wrapper.classList.remove('is-open');
    if (menu) {
      try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch (_) {}
      menu.remove();
    }
    if (restoreFocus && component.trigger.isConnected && !component.trigger.disabled) component.trigger.focus({ preventScroll: true });
  }
  function position() {
    if (!active) return;
    const { trigger, menu } = active;
    if (!trigger.isConnected || trigger.disabled || !menu) { close(); return; }
    const rect = trigger.getBoundingClientRect();
    const height = window.innerHeight, width = window.innerWidth;
    if (rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) { close(); return; }
    const menuWidth = Math.min(Math.max(rect.width, 180), Math.max(80, width - 16));
    menu.style.left = Math.min(Math.max(8, rect.left), width - menuWidth - 8) + 'px';
    menu.style.top = rect.bottom + 6 + 'px';
    menu.style.width = menuWidth + 'px';
    menu.style.maxHeight = Math.max(12, Math.min(320, height - rect.bottom - 14)) + 'px';
  }
  function schedulePosition(event) {
    if (!active || (event && event.target instanceof Node && active.menu && active.menu.contains(event.target))) return;
    if (frame === null) frame = requestAnimationFrame(() => { frame = null; position(); });
  }
  function makeRoom(trigger) {
    let needed = Math.min(220, window.innerHeight * .4) - (window.innerHeight - trigger.getBoundingClientRect().bottom - 14);
    if (needed <= 0) return;
    for (let el = trigger.parentElement; el && el !== document.body && needed > 0; el = el.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight) continue;
      const before = el.scrollTop;
      el.scrollTop += needed;
      needed -= el.scrollTop - before;
    }
    if (needed > 0) window.scrollBy({ top: needed, behavior: 'instant' });
  }
  function enabledIndices(component) { return component.items.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0); }
  function highlight(component, index, reveal) {
    if (active !== component || !component.items[index] || component.items[index].disabled) return;
    component.highlighted = index;
    component.items.forEach((item, i) => item.element.classList.toggle('highlighted', i === index));
    const item = component.items[index].element;
    component.trigger.setAttribute('aria-activedescendant', item.id);
    if (reveal && component.menu) {
      const menu = component.menu, top = item.offsetTop, bottom = top + item.offsetHeight;
      if (top < menu.scrollTop + 5) menu.scrollTop = Math.max(0, top - 5);
      else if (bottom > menu.scrollTop + menu.clientHeight - 5) menu.scrollTop = bottom - menu.clientHeight + 5;
    }
  }
  function choose(component, index) {
    const item = component.items[index];
    if (!item || item.disabled || component.select.disabled) return;
    const changed = component.select.selectedIndex !== index;
    component.select.selectedIndex = index;
    sync(component);
    close(true);
    if (changed) component.select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function open(component, preferLast) {
    if (component.select.disabled || !component.trigger.isConnected) return;
    if (active === component) return;
    close(); sync(component); makeRoom(component.trigger);
    const menu = document.createElement('div');
    menu.className = 'picker-menu'; menu.id = component.menuId; menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', component.trigger.getAttribute('aria-label'));
    menu.tabIndex = -1;
    component.menu = menu; component.items = [];
    const options = Array.from(component.select.options);
    let lastGroup = null;
    options.forEach((option, index) => {
      const group = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
      if (group && group !== lastGroup) {
        const heading = document.createElement('div'); heading.className = 'picker-group'; heading.textContent = group.label; heading.setAttribute('role', 'presentation'); menu.appendChild(heading);
      }
      lastGroup = group;
      const disabled = option.disabled || !!(group && group.disabled);
      const element = document.createElement('div');
      element.className = 'picker-option' + (index === component.select.selectedIndex ? ' selected' : '') + (disabled ? ' disabled' : '');
      element.id = component.select.id + '-option-' + index;
      element.setAttribute('role', 'option'); element.setAttribute('aria-selected', String(index === component.select.selectedIndex)); element.setAttribute('aria-disabled', String(disabled));
      element.dataset.pickerIndex = String(index); element.textContent = option.textContent;
      component.items.push({ element, disabled, text: option.textContent.toLocaleLowerCase() }); menu.appendChild(element);
    });
    const container = component.select.closest('dialog[open]') || document.body;
    const usePopover = typeof menu.showPopover === 'function';
    if (usePopover) menu.setAttribute('popover', 'manual');
    container.appendChild(menu);
    active = component;
    position();
    if (usePopover) { try { menu.showPopover(); } catch (_) { menu.removeAttribute('popover'); } }
    component.wrapper.classList.add('is-open'); component.trigger.setAttribute('aria-expanded', 'true');
    component.trigger.focus({ preventScroll: true });
    const allowed = enabledIndices(component);
    const selected = component.select.selectedIndex;
    const initial = allowed.includes(selected) ? selected : preferLast ? allowed[allowed.length - 1] : allowed[0];
    if (initial !== undefined) highlight(component, initial, true);
    menu.addEventListener('mousedown', event => { if (event.target.closest('.picker-option')) event.preventDefault(); });
    menu.addEventListener('click', event => {
      const option = event.target.closest('.picker-option');
      if (option) { event.preventDefault(); choose(component, Number(option.dataset.pickerIndex)); }
    });
    menu.addEventListener('pointermove', event => {
      const option = event.target.closest('.picker-option');
      if (option) highlight(component, Number(option.dataset.pickerIndex), false);
    });
    menu.addEventListener('keydown', event => keydown(component, event));
    observer = new MutationObserver(() => { if (active === component && !component.trigger.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function keydown(component, event) {
    const key = event.key;
    if (component.select.disabled || event.isComposing) return;
    if (key === 'Tab') { if (active === component) close(true); return; }
    if (key === 'Escape') {
      if (active === component) { event.preventDefault(); event.stopPropagation(); close(true); } return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const wasOpen = active === component;
      if (!wasOpen) open(component, key === 'ArrowUp' || key === 'End');
      const allowed = enabledIndices(component);
      if (!allowed.length) return;
      let i = allowed.indexOf(component.highlighted);
      if (key === 'Home') i = 0;
      else if (key === 'End') i = allowed.length - 1;
      else if (wasOpen) i = (i + (key === 'ArrowDown' ? 1 : -1) + allowed.length) % allowed.length;
      highlight(component, allowed[Math.max(0, i)], true); return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (active === component) choose(component, component.highlighted); else open(component);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (active !== component) open(component);
      const time = Date.now();
      component.search = time - component.searchAt < 700 ? component.search + key : key;
      component.searchAt = time;
      const query = component.search.toLocaleLowerCase();
      let match = component.items.findIndex(item => !item.disabled && item.text.trim().startsWith(query));
      if (match < 0) { component.search = key; match = component.items.findIndex(item => !item.disabled && item.text.trim().startsWith(key.toLocaleLowerCase())); }
      if (match >= 0) highlight(component, match, true);
    }
  }
  function enhance(root) {
    close();
    root.querySelectorAll('select:not([multiple])').forEach(select => {
      if (components.has(select)) { sync(components.get(select)); return; }
      if (!select.id) select.id = 'planner-select-' + (++serial);
      const wrapper = document.createElement('div'); wrapper.className = 'picker';
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'picker-trigger'; trigger.id = select.id + '-trigger';
      trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', labelFor(select));
      const menuId = select.id + '-menu'; trigger.setAttribute('aria-controls', menuId);
      const value = document.createElement('span'); value.className = 'picker-value';
      const chevron = document.createElement('span'); chevron.className = 'picker-chevron'; chevron.textContent = '⌄'; chevron.setAttribute('aria-hidden', 'true');
      trigger.append(value, chevron);
      select.parentNode.insertBefore(wrapper, select); wrapper.append(select, trigger);
      select.classList.add('picker-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      const component = { select, trigger, wrapper, value, menuId, menu: null, items: [], highlighted: -1, search: '', searchAt: 0 };
      components.set(select, component); sync(component);
      trigger.addEventListener('click', () => active === component ? close(true) : open(component));
      trigger.addEventListener('keydown', event => keydown(component, event));
      select.addEventListener('change', () => sync(component));
      select.addEventListener('invalid', event => {
        event.preventDefault(); wrapper.classList.add('is-invalid'); trigger.setAttribute('aria-invalid', 'true'); trigger.focus({ preventScroll: true }); open(component);
      });
    });
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.wrapper.contains(event.target) && !active.menu.contains(event.target)) close();
  }, true);
  document.addEventListener('focusin', event => {
    if (active && !active.wrapper.contains(event.target) && !active.menu.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  }, true);
  document.addEventListener('click', event => {
    const label = event.target.closest('label');
    if (!label || event.target.closest('button, input, textarea, a, .picker')) return;
    const component = components.get(label.control);
    if (component) { event.preventDefault(); component.trigger.focus(); }
  }, true);
  document.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
  window.PlannerSelect = { enhance, close };
}());
