(function () {
  'use strict';
  const components = new WeakMap(), live = new Set();
  const commands = [
    { id: 'heading', title: '标题', hint: '## 二级标题', keys: 'heading title h' },
    { id: 'list', title: '无序列表', hint: '- 列表项', keys: 'list bullet ul' },
    { id: 'ordered', title: '有序列表', hint: '1. 列表项', keys: 'ordered number ol' },
    { id: 'task', title: '任务列表', hint: '- [ ] 待办事项', keys: 'task todo check' },
    { id: 'code', title: '代码块', hint: '带语言标记的代码围栏', keys: 'code fence' },
    { id: 'quote', title: '引用', hint: '> 引用内容', keys: 'quote blockquote' },
    { id: 'link', title: '链接', hint: '[文字](https://…) ', keys: 'link url' },
    { id: 'table', title: '表格', hint: 'Markdown 表头、对齐与数据行', keys: 'table grid' }
  ];
  const languages = [
    ['go', 'Go'], ['javascript', 'JavaScript'], ['js', 'JavaScript 简写'], ['typescript', 'TypeScript'], ['ts', 'TypeScript 简写'],
    ['python', 'Python'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['rust', 'Rust'], ['sql', 'SQL'],
    ['json', 'JSON'], ['bash', 'Shell'], ['html', 'HTML'], ['css', 'CSS'], ['text', '纯文本']
  ];
  let active = null, observer = null, serial = 0;
  function prune() { for (const component of live) if (!component.textarea.isConnected) live.delete(component); }
  function close() {
    if (active) {
      const component = active.component;
      active.menu.remove();
      component.textarea.removeAttribute('aria-controls'); component.textarea.removeAttribute('aria-activedescendant');
      active = null;
    }
    if (observer) { observer.disconnect(); observer = null; }
    prune();
  }
  function lineAt(textarea) {
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    const lineStart = start === 0 ? 0 : textarea.value.lastIndexOf('\n', start - 1) + 1;
    const next = textarea.value.indexOf('\n', end);
    return { start, end, lineStart, lineEnd: next < 0 ? textarea.value.length : next,
      before: textarea.value.slice(lineStart, start), after: textarea.value.slice(end, next < 0 ? textarea.value.length : next) };
  }
  function insideFence(text, position) {
    let fence = null;
    for (const line of text.slice(0, position).split('\n')) {
      const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (!match) continue;
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
    }
    return fence !== null;
  }
  // insertText participates in the browser's native undo history. setRangeText
  // is the fallback and never replaces the whole textarea or its DOM node.
  function replace(textarea, start, end, text, selectStart, selectEnd) {
    if (!textarea || textarea.disabled || textarea.readOnly) return;
    const component = components.get(textarea), scroll = textarea.scrollTop;
    if (component) component.busy = true;
    textarea.focus({ preventScroll: true }); textarea.setSelectionRange(start, end);
    const before = textarea.value;
    let emitted = false;
    const notice = () => { emitted = true; };
    textarea.addEventListener('input', notice, true);
    try {
      try { if (typeof document.execCommand === 'function') document.execCommand('insertText', false, text); } catch (_) {}
      if (textarea.value === before && (start !== end || text)) textarea.setRangeText(text, start, end, 'end');
      const from = selectStart === undefined ? start + text.length : selectStart;
      textarea.setSelectionRange(from, selectEnd === undefined ? from : selectEnd);
      textarea.scrollTop = scroll;
      if (!emitted && textarea.value !== before) textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      textarea.removeEventListener('input', notice, true);
      if (component) component.busy = false;
    }
  }
  function wrapSelection(textarea, marker, placeholder) {
    const { start, end } = lineAt(textarea), value = textarea.value;
    if (value.slice(Math.max(0, start - marker.length), start) === marker && value.slice(end, end + marker.length) === marker) {
      replace(textarea, start - marker.length, end + marker.length, value.slice(start, end), start - marker.length, end - marker.length); return;
    }
    const text = value.slice(start, end) || placeholder;
    replace(textarea, start, end, marker + text + marker, start + marker.length, start + marker.length + text.length);
  }
  function lineCommand(textarea, name) {
    const info = lineAt(textarea), old = textarea.value.slice(info.lineStart, info.lineEnd);
    const patterns = { heading: /^(\s*)#{1,6}\s+/, list: /^(\s*)[-+*]\s+/, task: /^(\s*)[-+*]\s+\[[ xX]\]\s*/, quote: /^(\s*)>\s?/, ordered: /^(\s*)\d+[.)]\s+/ };
    const markers = { heading: '## ', list: '- ', task: '- [ ] ', quote: '> ', ordered: '1. ' };
    const lines = old.split('\n'), allMarked = lines.every(line => patterns[name].test(line));
    const transformed = lines.map((line, index) => {
      if (allMarked) return line.replace(patterns[name], '$1');
      const marker = name === 'ordered' ? (index + 1) + '. ' : markers[name];
      return line.replace(/^(\s*)/, '$1' + marker);
    }).join('\n');
    replace(textarea, info.lineStart, info.lineEnd, transformed, info.lineStart, info.lineStart + transformed.length);
  }
  function insertBlock(textarea, text, selectionOffset, selectionLength) {
    const { start, end } = lineAt(textarea), value = textarea.value;
    const leading = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const trailing = end < value.length && value[end] !== '\n' ? '\n' : '';
    replace(textarea, start, end, leading + text + trailing, start + leading.length + selectionOffset, start + leading.length + selectionOffset + (selectionLength || 0));
  }
  function command(textarea, name) {
    if (!textarea || textarea.tagName !== 'TEXTAREA' || textarea.disabled || textarea.readOnly) return;
    close();
    name = ({ bullet: 'list', ul: 'list', ol: 'ordered', todo: 'task', fence: 'code', h: 'heading' })[name] || name;
    if (name === 'bold' || name === 'italic') { wrapSelection(textarea, name === 'bold' ? '**' : '*', name === 'bold' ? '重点' : '思路'); return; }
    if (['heading', 'list', 'ordered', 'task', 'quote'].includes(name)) { lineCommand(textarea, name); return; }
    const { start, end } = lineAt(textarea), selected = textarea.value.slice(start, end);
    if (name === 'link') {
      const label = selected || '链接文字', target = 'https://example.com';
      replace(textarea, start, end, '[' + label + '](' + target + ')', start + label.length + 3, start + label.length + 3 + target.length); return;
    }
    if (name === 'code') {
      const body = selected || '在这里写代码', text = '```go\n' + body + '\n```';
      insertBlock(textarea, text, 6, body.length); return;
    }
    if (name === 'table') {
      insertBlock(textarea, '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |', 2, 2);
    }
  }
  function selectSuggestion(index, reveal) {
    if (!active || !active.items[index]) return;
    active.index = index;
    active.items.forEach((item, i) => { item.element.classList.toggle('highlighted', index === i); item.element.setAttribute('aria-selected', String(index === i)); });
    const element = active.items[index].element;
    active.component.textarea.setAttribute('aria-activedescendant', element.id);
    if (reveal) {
      const menu = active.menu, top = element.offsetTop, bottom = top + element.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
    }
  }
  function chooseSuggestion() {
    if (!active || !active.items[active.index]) return;
    const current = active, item = current.items[current.index], textarea = current.component.textarea;
    close();
    if (current.kind === 'language') { replace(textarea, current.start, current.end, item.id); return; }
    if (current.start !== null) {
      const templates = { heading: '## 标题', list: '- 列表项', ordered: '1. 列表项', task: '- [ ] 待办事项', code: '```go\n在这里写代码\n```', quote: '> 引用内容', link: '[链接文字](https://example.com)', table: '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |' };
      const text = templates[item.id];
      const offset = item.id === 'code' ? 6 : item.id === 'table' ? 2 : item.id === 'link' ? 7 : text.length;
      const length = item.id === 'code' ? 6 : item.id === 'table' ? 2 : item.id === 'link' ? 19 : 0;
      replace(textarea, current.start, current.end, text, current.start + offset, current.start + offset + length); return;
    }
    command(textarea, item.id);
  }
  function showSuggestions(component, items, kind, start, end) {
    close();
    const menu = document.createElement('div'); menu.className = 'md-suggestions'; menu.id = 'md-suggestions-' + (++serial); menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', '本地 Markdown 语法提示');
    menu.style.bottom = '12px'; menu.style.top = 'auto';
    const heading = document.createElement('div'); heading.className = 'md-suggestion-header'; heading.setAttribute('role', 'presentation'); heading.textContent = kind === 'language' ? '代码块语言 · 本地 Markdown 提示' : '本地 Markdown 语法提示'; menu.appendChild(heading);
    const entries = items.map((item, index) => {
      const element = document.createElement('button'); element.type = 'button'; element.className = 'md-suggestion'; element.id = menu.id + '-option-' + index;
      element.setAttribute('role', 'option'); element.setAttribute('aria-selected', 'false'); element.tabIndex = -1; element.dataset.mdSuggestion = item.id;
      const title = document.createElement('span'); title.className = 'md-suggestion-title'; title.textContent = item.title;
      const hint = document.createElement('span'); hint.className = 'md-suggestion-detail'; hint.textContent = item.hint;
      element.append(title, hint); menu.appendChild(element); return Object.assign({}, item, { element });
    });
    const help = document.createElement('div'); help.className = 'md-suggestion-hint'; help.setAttribute('role', 'presentation'); help.textContent = '↑↓ 选择 · Enter / Tab 插入 · Esc 关闭'; menu.appendChild(help);
    component.wrapper.appendChild(menu); component.textarea.setAttribute('aria-controls', menu.id);
    active = { component, menu, items: entries, index: 0, kind, start, end }; selectSuggestion(0, false);
    menu.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('click', event => { const element = event.target.closest('[data-md-suggestion]'); if (!element) return; const index = entries.findIndex(item => item.element === element); if (index >= 0) { selectSuggestion(index, false); chooseSuggestion(); } });
    observer = new MutationObserver(() => { if (active && !active.component.textarea.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function refresh(component, explicit) {
    const textarea = component.textarea;
    if (component.composing || component.busy || document.activeElement !== textarea || textarea.readOnly || textarea.disabled) return;
    const info = lineAt(textarea);
    if (info.start !== info.end) { if (explicit) showSuggestions(component, commands, 'command', null, null); else close(); return; }
    const slash = info.before.match(/^\s*\/([A-Za-z-]*)$/), language = info.before.match(/^\s*(`{3,}|~{3,})([A-Za-z0-9_+-]*)$/);
    if (language && !info.after.trim() && !insideFence(textarea.value, info.lineStart)) {
      const query = language[2].toLowerCase(), items = languages.filter(([id]) => id.startsWith(query)).map(([id, title]) => ({ id, title, hint: id }));
      if (items.length && (explicit || !items.some(item => item.id === query))) { showSuggestions(component, items, 'language', info.start - query.length, info.end); return; }
      close(); return;
    }
    if (slash && !info.after.trim() && !insideFence(textarea.value, info.lineStart)) {
      const query = slash[1].toLowerCase(), items = commands.filter(item => !query || item.keys.split(' ').some(key => key.startsWith(query)));
      if (items.length) { showSuggestions(component, items, 'command', info.lineStart, info.lineEnd); return; }
    } else if (explicit) { showSuggestions(component, commands, 'command', null, null); return; }
    close();
  }
  function indentation(textarea, backwards) {
    const info = lineAt(textarea);
    if (info.start === info.end && !backwards) { replace(textarea, info.start, info.end, '    '); return; }
    const block = textarea.value.slice(info.lineStart, info.lineEnd), lines = block.split('\n');
    const text = lines.map(line => backwards ? line.replace(/^(?: {1,4}|\t)/, '') : '    ' + line).join('\n');
    if (info.start === info.end) { const removed = block.length - text.length; replace(textarea, info.lineStart, info.lineEnd, text, Math.max(info.lineStart, info.start - removed)); }
    else replace(textarea, info.lineStart, info.lineEnd, text, info.lineStart, info.lineStart + text.length);
  }
  function enter(textarea) {
    const info = lineAt(textarea);
    if (info.start !== info.end) return false;
    const line = info.before + info.after, fence = info.before.match(/^(\s*)(`{3,}|~{3,})([A-Za-z0-9_+-]*)\s*$/);
    if (fence && !info.after && !insideFence(textarea.value, info.lineStart)) {
      const hasCloser = textarea.value.slice(info.lineEnd).split('\n').some(line => line.trim().length >= fence[2].length && Array.from(line.trim()).every(char => char === fence[2][0]));
      const suffix = hasCloser ? '\n' + fence[1] : '\n' + fence[1] + '\n' + fence[1] + fence[2];
      replace(textarea, info.start, info.end, suffix, info.start + 1 + fence[1].length); return true;
    }
    if (!insideFence(textarea.value, info.lineStart)) {
      const list = line.match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/);
      if (list) {
        if (!list[4].trim()) { replace(textarea, info.lineStart, info.lineEnd, '', info.lineStart); return true; }
        const marker = /^\d/.test(list[2]) ? (parseInt(list[2], 10) + 1) + list[2].slice(-1) : list[2];
        replace(textarea, info.start, info.end, '\n' + list[1] + marker + ' ' + (list[3] === undefined ? '' : '[ ] ')); return true;
      }
      const quote = line.match(/^(\s*)>\s?(.*)$/);
      if (quote) { if (!quote[2].trim()) replace(textarea, info.lineStart, info.lineEnd, '', info.lineStart); else replace(textarea, info.start, info.end, '\n' + quote[1] + '> '); return true; }
    }
    const whitespace = info.before.match(/^\s+/);
    if (whitespace && !whitespace[0].includes('\n')) { replace(textarea, info.start, info.end, '\n' + whitespace[0]); return true; }
    return false;
  }
  function pairing(textarea, key) {
    const info = lineAt(textarea), value = textarea.value;
    if (info.start === info.end && value[info.start] === key && ')]}`"\''.includes(key)) { textarea.setSelectionRange(info.start + 1, info.start + 1); return true; }
    const pairs = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'" };
    if (!pairs[key] || value[info.start - 1] === '\\') return false;
    if (key === '`' && /^\s*``$/.test(info.before) && !info.after) { replace(textarea, info.start, info.end, '`'); return true; }
    if (info.start === info.end && value[info.start] && !/[\s)\]}>,.;:]/.test(value[info.start])) return false;
    if ((key === '"' || key === "'") && /[\p{L}\p{N}]/u.test(value[info.start - 1] || '') && info.start === info.end) return false;
    const text = value.slice(info.start, info.end);
    replace(textarea, info.start, info.end, key + text + pairs[key], info.start + 1, info.end + 1); return true;
  }
  function keydown(component, event) {
    const textarea = component.textarea;
    if (textarea.disabled || textarea.readOnly || component.composing || event.isComposing || event.keyCode === 229) return;
    if (active && active.component === component && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key) && !(event.shiftKey && (event.key === 'Enter' || event.key === 'Tab'))) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Tab') chooseSuggestion();
      else selectSuggestion((active.index + (event.key === 'ArrowDown' ? 1 : -1) + active.items.length) % active.items.length, true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const name = { b: 'bold', i: 'italic', k: 'link' }[event.key.toLowerCase()];
      if (name) { event.preventDefault(); command(textarea, name); return; }
      if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); refresh(component, true); return; }
      return;
    }
    if (event.altKey) return;
    if (event.key === 'Tab') { event.preventDefault(); indentation(textarea, event.shiftKey); close(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { if (enter(textarea)) event.preventDefault(); close(); return; }
    if (event.key === 'Backspace' && textarea.selectionStart === textarea.selectionEnd) {
      const at = textarea.selectionStart, pair = textarea.value.slice(at - 1, at + 1);
      if (['()', '[]', '{}', '``', '""', "''"].includes(pair)) { event.preventDefault(); replace(textarea, at - 1, at + 1, ''); close(); return; }
    }
    if (event.key.length === 1 && pairing(textarea, event.key)) { event.preventDefault(); close(); refresh(component, false); }
  }
  function enhance(root) {
    close();
    root.querySelectorAll('textarea[data-markdown-editor]').forEach(textarea => {
      if (components.has(textarea)) return;
      const wrapper = document.createElement('div'); wrapper.className = 'md-editor-wrap';
      textarea.parentNode.insertBefore(wrapper, textarea); wrapper.appendChild(textarea);
      const component = { textarea, wrapper, composing: false, busy: false };
      components.set(textarea, component); live.add(component);
      textarea.addEventListener('keydown', event => keydown(component, event));
      textarea.addEventListener('input', event => { if (!event.isComposing) refresh(component, false); });
      textarea.addEventListener('compositionstart', () => { component.composing = true; close(); });
      textarea.addEventListener('compositionend', () => { component.composing = false; refresh(component, false); });
      textarea.addEventListener('click', () => refresh(component, false));
    });
  }
  document.addEventListener('pointerdown', event => { if (active && !active.component.wrapper.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (active && !active.component.wrapper.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }, true);
  window.PlannerEditor = { enhance, close, command };
}());
