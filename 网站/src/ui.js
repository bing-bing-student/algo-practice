(function () {
  'use strict';
  const C = window.PlannerCore;
  const baseCatalog = JSON.parse(document.getElementById('catalog-data').textContent);
  let catalog = baseCatalog, activeProblemIds, activeCategoryIds, problems, categories, patterns;
  const requestedDocument = new URLSearchParams(location.hash.slice(1)).get('document');
  const documentCategory = requestedDocument || null;
  const STORE = 'leetcode-study-planner:v1';
  const ROLLBACK = STORE + ':before-import';
  const DAMAGED_ARCHIVE = STORE + ':damaged-original';
  const ZONE = 'Asia/Shanghai';
  const labels = { independent: '独立完成', hint: '提示后完成', solution: '看解后复现', thinking: '继续推敲' };
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  let storageAvailable = true, storageMessage = '已自动保存', storageIssue = '', rawDamaged = null;
  let dirty = false, saveTimer = null, toastTimer = null, pendingConfirm = null, pendingImport = null, lastDeleted = null;
  let state, modalFocus = null;
  const ui = {
    page: 'home', date: today(), month: today().slice(0, 7), selectedId: null,
    routeCategory: 'all', routeRole: 'all', routeStatus: 'all', routeQuery: '',
    noteMode: 'preview', noteQuery: '', reviewFilter: 'all', topicCategory: null, topicMode: 'preview'
  };
  const manager = window.PlannerManager.create({
    esc, btn, opt, moreActions, state: () => state, catalog: () => catalog, openModal, closeModal,
    confirm: confirmAction, toast, render, topicActions: topicDocumentActions,
    commit(action, values) {
      flush();
      const next = C.mutateCatalog(state, baseCatalog, action, values);
      state = next; rebuildCatalog(); persist(true);
    }
  });

  function rebuildCatalog() {
    catalog = C.resolveCatalog(baseCatalog, state.catalogEdits);
    activeProblemIds = new Set(catalog.problems.map(p => p.id));
    activeCategoryIds = new Set(catalog.categories.map(c => c.id));
    problems = new Map([...catalog.problems, ...catalog.retiredProblems].map(p => [p.id, p]));
    categories = new Map([...catalog.categories, ...catalog.retiredCategories].map(c => [c.id, c]));
    patterns = new Map([...categories.values()].flatMap(c => c.patterns.map(p => [p.id, p])));
    if (ui.routeCategory !== 'all' && !activeCategoryIds.has(ui.routeCategory)) ui.routeCategory = 'all';
  }

  function today() { return C.todayInZone(ZONE); }
  function now() { return new Date().toISOString(); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function formatDate(date) {
    if (!C.isDate(date)) return '未安排日期';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(date + 'T12:00:00+08:00'));
  }
  function stamp(iso) { return new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
  function shortDate(date) { return C.isDate(date) ? date.replace(/-/g, '/') : '未设置'; }
  function attrId(id) { return 'data-id="' + esc(id) + '"'; }
  function btn(label, action, attrs, cls) { return '<button type="button" class="btn ' + (cls || '') + '" data-action="' + esc(action) + '" ' + (attrs || '') + '>' + esc(label) + '</button>'; }
  function moreActions(content, label, description) {
    return '<details class="action-menu"><summary class="btn ghost small" aria-label="' + esc(description || '更多操作') + '">' + esc(label || '更多') + '<span aria-hidden="true">⌄</span></summary><div class="action-menu-items">' + content + '</div></details>';
  }
  function planLabel(date) { return date === today() ? '加入今日清单' : '加入 ' + date.slice(5).replace('-', '/') + ' 清单'; }
  function opt(value, label, selected) { return '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function external(p, text) { return p.url ? '<a class="problem-link" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + esc(text || '打开力扣 ↗') + '</a>' : text ? esc(text.replace(/\s*↗$/, '')) : ''; }
  function problemLinks(p) {
    const url = state.animationLinks[p.id] || '';
    return external(p) + (url ? '<a class="problem-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">动画演示 ↗</a>' : '');
  }
  function recordsFor(id) { return state.records.filter(r => r.problemId === String(id)).sort((a, b) => a.date.localeCompare(b.date) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)); }
  function dayRecords(date) { return state.records.filter(r => r.date === date); }
  function currentProblem() { return problems.get(ui.selectedId) || (activeProblemIds.has(state.focus.problemId) ? problems.get(state.focus.problemId) : null); }
  function continueProblem() { return problems.get(C.nextLearningProblemId(state, catalog)) || null; }
  function activePlans() { return state.plans.filter(p => activeProblemIds.has(p.problemId)); }
  function selectActiveFocus() {
    const next = continueProblem();
    ui.selectedId = next ? next.id : activeProblemIds.has(state.focus.problemId) ? state.focus.problemId : null;
    ui.routeCategory = activeCategoryIds.has(state.focus.categoryId) ? state.focus.categoryId : catalog.categories[0] ? catalog.categories[0].id : 'all';
  }
  function draft(id, create) {
    id = String(id);
    if (!state.notes[id] && create) state.notes[id] = { content: '', updatedAt: null, versions: [] };
    return state.notes[id] || { content: '', updatedAt: null, versions: [] };
  }
  function review(id) { return C.reviewFor(String(id), state.records, state.settings.reviewIntervals); }
  function nextReview(id) {
    const override = state.reviewOverrides[String(id)];
    if (override && override.paused) return null;
    return override && override.date ? override.date : review(id).nextDate;
  }
  function allText(p) {
    const n = draft(p.id, false);
    return [p.id, p.title, p.key, categories.get(p.categoryId).title, patterns.get(p.patternId).title,
      n.content,
      ...recordsFor(p.id).map(r => r.note)].join(' ').toLowerCase();
  }
  function progress(p) {
    const history = recordsFor(p.id);
    return { attempts: history.length, independent: history.some(r => r.outcome === 'independent'), latest: history.length ? history[history.length - 1] : null };
  }
  function init() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        try { state = C.parseBackup(raw, baseCatalog); }
        catch (error) { rawDamaged = raw; storageAvailable = false; storageIssue = '已有保存数据无法读取。原始数据已保留，请先导出原始数据或恢复备份。'; }
      }
      if (!rawDamaged && !documentCategory) {
        const probe = STORE + ':probe';
        try {
          localStorage.setItem(probe, 'ok');
          if (localStorage.getItem(probe) !== 'ok') throw new Error('无法读取保存结果');
          localStorage.removeItem(probe);
        } catch (error) {
          storageAvailable = false;
          storageIssue = '浏览器暂时不能写入进度。已保存的数据仍可查看，当前操作请用 JSON 备份保留。';
        }
      }
    } catch (error) { storageAvailable = false; storageIssue = '浏览器暂时不能保存进度。当前操作保留在本页，请使用 JSON 备份。'; }
    if (!state) state = C.createState(baseCatalog, today());
    rebuildCatalog();
    selectActiveFocus();
    storageMessage = storageAvailable ? '本浏览器自动保存' : '当前仅临时保留';
    render();
    if (documentCategory) {
      const section = new URLSearchParams(location.hash.slice(1)).get('section');
      const target = section && document.getElementById(section);
      if (target) target.scrollIntoView({ block: 'start' });
    }
  }
  function setSaveStatus(message, failed) {
    storageMessage = message;
    document.querySelectorAll('[data-save-status]').forEach(el => { el.textContent = message; el.classList.toggle('error', !!failed); });
    const el = document.getElementById('note-save-status');
    if (el) el.textContent = message;
    const warning = document.getElementById('storage-warning');
    if (warning) { warning.hidden = !storageIssue; warning.querySelector('[data-storage-message]').textContent = storageIssue; }
  }
  function persist(immediate) {
    dirty = true;
    clearTimeout(saveTimer);
    if (immediate) return flush();
    setSaveStatus('正在保存…', false);
    saveTimer = setTimeout(flush, 300);
    return true;
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return true;
    if (!storageAvailable) { setSaveStatus('未写入浏览器 · 请导出备份', true); return false; }
    try {
      localStorage.setItem(STORE, JSON.stringify(C.backupEnvelope(state, catalog.version)));
      dirty = false;
      storageIssue = '';
      setSaveStatus('已自动保存', false);
      return true;
    } catch (error) {
      storageIssue = '保存失败，内容仍保留在当前页面。请先导出 JSON 备份，再关闭页面。';
      setSaveStatus('保存失败 · 请导出备份', true);
      return false;
    }
  }
  function toast(message, undo) {
    const el = document.getElementById('toast');
    el.innerHTML = '<span>' + esc(message) + '</span>' + (undo ? btn('撤销', 'undo-delete', '', 'ghost small') : '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 15000 : 4500);
  }
  function dateToolbar(label) {
    return '<div class="toolbar">' + btn('‹', 'previous-day', 'aria-label="前一天"', 'icon') +
      '<label class="sr-only" for="day-picker">' + esc(label || '查看日期') + '</label><input id="day-picker" type="date" required value="' + esc(ui.date) + '">' +
      btn('›', 'next-day', 'aria-label="后一天"', 'icon') + btn('今天', 'go-today', '', 'ghost') + '</div>';
  }
  function render() {
    if (documentCategory) return renderDocumentPage();
    const active = document.activeElement;
    const focus = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop } : null;
    window.PlannerSelect.close();
    window.PlannerDate.close();
    window.PlannerEditor.close();
    const nav = [['home', '继续学习', '↳'], ['route', '题型路线', '▤'], ['notes', '题目笔记', '✎'], ['calendar', '练习日历', '□'], ['review', '复习参考', '↻'], ['manage', '题目管理', '▦']];
    app.innerHTML = '<div class="app-shell"><header class="app-header"><div><div class="app-brand"><span class="brand-mark" aria-hidden="true">习</span>算法练习簿</div></div><div class="header-actions"><span class="save-status' + (storageIssue ? ' error' : '') + '" data-save-status role="status">' + esc(storageMessage) + '</span>' + btn('备份与设置', 'settings') + '</div></header>' +
      '<div class="app-body"><nav class="app-nav" aria-label="工作台页面">' + nav.map(([key, text, icon]) => '<button type="button" class="nav-btn" data-action="page" data-page="' + key + '"' + (ui.page === key ? ' aria-current="page"' : '') + '><span class="nav-icon" aria-hidden="true">' + icon + '</span>' + text + '</button>').join('') +
      '</nav><main class="app-main"><div id="storage-warning" class="warning"' + (!storageIssue ? ' hidden' : '') + '><span data-storage-message>' + esc(storageIssue) + '</span> ' + btn('备份', 'settings', '', 'small') + (rawDamaged ? btn('导出原始数据', 'export-damaged', '', 'small') : '') + '</div>' +
      ({ home: renderHome, route: renderRoute, notes: renderNotes, calendar: renderCalendar, review: renderReview, manage: manager.render }[ui.page] || renderHome)() + '</main></div></div>';
    window.PlannerSelect.enhance(app);
    window.PlannerDate.enhance(app);
    window.PlannerEditor.enhance(app);
    if (focus) {
      const next = document.getElementById(focus.id);
      if (next) { next.focus({ preventScroll: true }); try { next.setSelectionRange(focus.start, focus.end); next.scrollTop = focus.scroll; } catch (_) {} }
    }
  }
  function page(name) {
    flush();
    ui.page = name;
    if (name === 'notes') {
      ui.noteMode = 'preview';
      if (!ui.selectedId) ui.selectedId = activeProblemIds.has(state.focus.problemId) ? state.focus.problemId : (catalog.problems[0] || catalog.retiredProblems[0] || {}).id || null;
    }
    render(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function renderHome() {
    const category = activeCategoryIds.has(state.focus.categoryId) ? categories.get(state.focus.categoryId) : null;
    const focusProblem = continueProblem();
    const hasTopicProblems = category && catalog.problems.some(p => p.categoryId === category.id);
    const records = dayRecords(ui.date), plans = activePlans().filter(p => p.date === ui.date), waiting = activePlans().filter(p => p.date === null);
    const totals = '<div class="stat-inline"><span>实际练过 <strong>' + new Set(records.map(r => r.problemId)).size + '</strong> 道题</span><span>留下 <strong>' + records.length + '</strong> 次练习记录</span></div>';
    return '<div class="page-heading"><div><h1>' + esc(formatDate(ui.date)) + '</h1><p class="page-intro">选想练的题，按自己的节奏继续。</p></div>' + dateToolbar() + '</div>' +
      '<div class="focus-banner"><div><label class="focus-label" for="focus-category">当前专题</label><div><select id="focus-category" aria-label="当前专题">' + opt('', '选择一个专题开始', state.focus.categoryId) + catalog.categories.map(c => opt(c.id, c.title, state.focus.categoryId)).join('') + '</select></div>' +
      (focusProblem ? '<h2>' + external(focusProblem, focusProblem.id + '. ' + focusProblem.title + ' ↗') + '</h2><p class="small muted">' + esc(patterns.get(focusProblem.patternId).title) + (focusProblem.id === state.focus.problemId ? ' · 上次停留的位置' : ' · 下一道未完成的题') + '</p>' : category ? hasTopicProblems ? '<h2>本专题的题目已练过一轮</h2><p class="small muted">可以自由选题复习，或自行切换专题。</p>' : '<h2>这个专题还没有题目</h2><p class="small muted">在题目管理中添加题目，或从其他专题移动题目过来。</p>' : '<h2>从一个熟悉或想学的题型开始</h2><p class="small muted">主线和变体都能自由选择，日期不会替你换专题。</p>') + '</div><div class="toolbar">' +
      (focusProblem ? btn('继续这道题', 'continue', '', 'primary') : '') + (category ? topicDocumentLink(category.id) : '') + '</div></div>' + totals +
      '<div class="split"><div class="stack"><section class="panel"><div class="panel-header"><h2>本日自选清单</h2>' + (plans.length ? btn('添加题目', 'page', 'data-page="route"', 'ghost small') : '') + '</div><div class="problem-list">' +
      (plans.length ? plans.map(planRow).join('') : '<div class="empty"><h3>还没有安排题目</h3><p>可以留空，也可以从题型路线中自由挑选。</p>' + btn('挑选题目', 'page', 'data-page="route"', 'primary') + '</div>') + '</div></section>' +
      (records.length ? '<section class="panel"><div class="panel-header"><h2>这天实际练过</h2>' + btn('查看练习日历', 'open-calendar', '', 'ghost small') + '</div><div class="panel-body">' + renderRecords(records) + '</div></section>' : '') +
      (waiting.length ? '<section class="panel"><div class="panel-header"><h2>待安排</h2><span class="muted small">没有截止日期</span></div>' + waiting.map(planRow).join('') + '</section>' : '') + '</div><aside class="panel"><div class="panel-header"><h2>题目详情与记录</h2></div><div class="panel-body">' + renderDetail(currentProblem()) + '</div></aside></div>';
  }
  function planRow(plan) {
    const p = problems.get(plan.problemId);
    const done = !!plan.date && dayRecords(plan.date).some(r => r.problemId === p.id);
    const selected = ui.selectedId === p.id;
    return '<div class="problem-row' + (selected ? ' selected' : '') + '" data-inspect-problem="' + esc(p.id) + '">' + (plan.date ? '<input type="checkbox" data-plan-check="' + esc(plan.id) + '" aria-label="记录 ' + esc(p.id + ' ' + p.title) + ' 的本次练习"' + (done ? ' checked' : '') + '>' : '') +
      '<div class="problem-main"><button type="button" class="problem-title" data-action="inspect" aria-pressed="' + selected + '" ' + attrId(p.id) + '><span class="problem-number">' + esc(p.id) + '.</span>' + esc(p.title) + '</button><div class="problem-meta"><span>' + (done ? '本日已练' : plan.date ? '自选安排' : '想练时再安排') + '</span>' + problemLinks(p) + '</div><div class="inline-actions">' +
      (plan.date === null ? btn(planLabel(ui.date), 'plan-today', 'data-plan="' + esc(plan.id) + '"', 'ghost small') : '') + moreActions(btn('改日期', 'move-plan', 'data-plan="' + esc(plan.id) + '"', 'ghost small') + btn('移出清单', 'remove-plan', 'data-plan="' + esc(plan.id) + '"', 'ghost small'), '更多', p.title + '的清单操作') + '</div></div></div>';
  }
  function renderDetail(p, options) {
    options = options || {};
    if (!p) return '<div class="empty compact"><h3>看看一题的思路与历史</h3><p>从清单或题型路线中选择题目。</p></div>';
    const history = recordsFor(p.id), r = review(p.id), note = draft(p.id, false);
    const nextId = C.nextLearningProblemId(state, catalog, p.categoryId, p.id);
    const bookmarkAction = activeProblemIds.has(p.id) && nextId ? moreActions(btn(nextId === p.id ? '设为下次继续' : '从下一题继续', 'bookmark', attrId(p.id), 'ghost small'), '更多', p.title + '的学习选项') : '';
    return (options.inDialog ? '' : '<h2>' + esc(p.id + '. ' + p.title) + '</h2>') + '<div class="chips"><span class="badge ' + (p.role === 'core' ? 'main' : 'variant') + '">' + (p.role === 'core' ? '主线' : '变体 / 进阶') + '</span><span class="small muted">' + esc(categories.get(p.categoryId).title + ' / ' + patterns.get(p.patternId).title) + '</span></div><p class="small muted" style="margin-top:12px">' + esc(p.key) + '</p><div class="problem-links">' + problemLinks(p) + '</div>' +
      '<div class="detail-actions">' + (activeProblemIds.has(p.id) ? btn('记录本次练习', 'record', attrId(p.id), 'primary') : '<span class="small muted">已移出学习路线 · 保留历史</span>') + btn('打开本题笔记', 'notes', attrId(p.id)) + bookmarkAction + '</div><div class="detail-topic-link">' + topicDocumentLink(p.categoryId, true) + '</div><div class="small muted">练过 ' + history.length + ' 次 · 跨 ' + new Set(history.map(x => x.date)).size + ' 天 · 独立完成过 ' + r.independentDays + ' 天</div>' +
      (activeProblemIds.has(p.id) && state.settings.reviewEnabled && nextReview(p.id) ? '<p class="small muted">建议再练：' + esc(shortDate(nextReview(p.id))) + '</p>' : '') +
      (note.content ? '<div class="note-summary"><strong class="small">我的笔记</strong><div class="note-preview detail-note-preview">' + markdown(note.content.slice(0, 180)) + '</div></div>' : '') +
      '<div class="section-heading"><h3>每次练习</h3><span class="small muted">' + history.length + ' 条</span></div>' + (history.length ? renderRecords(history, { showTitle: false }) : '<p class="small muted">可以先尝试，也可以跨几天慢慢推敲。</p>');
  }
  function renderRecords(records, options) {
    options = options || {};
    return '<div class="history-list">' + records.slice().sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)).map(r => {
      const p = problems.get(r.problemId);
      const actions = btn('修改记录', 'edit-record', 'data-record="' + esc(r.id) + '"', 'ghost small') + btn('删除记录', 'delete-record', 'data-record="' + esc(r.id) + '"', 'ghost small danger') + (r.note ? btn('追加随记到题目笔记', 'append-record', 'data-record="' + esc(r.id) + '"', 'ghost small') : '');
      return '<article class="history-item"><div class="history-heading"><div><div class="record-meta"><span>' + esc(shortDate(r.date)) + '</span><span class="record-result">' + esc(labels[r.outcome]) + '</span>' + (r.minutes === null ? '' : '<span>' + r.minutes + ' 分钟</span>') + '</div>' + (options.showTitle === false ? '' : '<button type="button" class="problem-title" data-action="inspect" ' + attrId(p.id) + '>' + esc(p.id + '. ' + p.title) + '</button>') + '</div><div class="inline-actions">' + (options.showNotes ? btn('笔记', 'notes', attrId(p.id), 'ghost small') : '') + moreActions(actions, '更多', p.title + ' ' + shortDate(r.date) + '的记录操作') + '</div></div>' +
        (r.note ? '<details class="record-note"><summary>本次练习随记</summary><div class="note-preview">' + markdown(r.note) + '</div></details>' : '') + '</article>';
    }).join('') + '</div>';
  }
  function renderRoute() {
    const query = ui.routeQuery.trim().toLowerCase();
    const matching = catalog.problems.filter(p => (ui.routeCategory === 'all' || p.categoryId === ui.routeCategory) && (ui.routeRole === 'all' || p.role === ui.routeRole) && (!query || allText(p).includes(query))).filter(p => {
      const a = progress(p);
      return ui.routeStatus === 'all' || (ui.routeStatus === 'unseen' && !a.attempts) || (ui.routeStatus === 'learning' && a.attempts && !a.independent) || (ui.routeStatus === 'independent' && a.independent);
    });
    const ids = new Set(matching.map(p => p.id));
    const selectedCategory = categories.get(ui.routeCategory);
    const documentEntry = selectedCategory ? '<div class="inline-actions">' + topicDocumentLink(selectedCategory.id) + '</div>' : '';
    return '<div class="page-heading"><div><h1>题型路线</h1><p class="page-intro">按解法选题，加入指定日期的清单。</p></div>' + dateToolbar('清单日期') + '</div><div class="search-row"><label class="sr-only" for="route-search">搜索题目和笔记</label><input id="route-search" type="search" value="' + esc(ui.routeQuery) + '" placeholder="搜索题号、题名或自己的笔记"><select id="route-category" aria-label="筛选专题">' + opt('all', '全部专题', ui.routeCategory) + catalog.categories.map(c => opt(c.id, c.title, ui.routeCategory)).join('') + '</select><select id="route-role" aria-label="筛选主线与变体">' + opt('all', '主线与变体', ui.routeRole) + opt('core', '只看主线', ui.routeRole) + opt('extra', '只看变体', ui.routeRole) + '</select><select id="route-status" aria-label="筛选学习状态">' + [['all', '全部状态'], ['unseen', '尚未练习'], ['learning', '还在学习'], ['independent', '独立完成过']].map(([v, l]) => opt(v, l, ui.routeStatus)).join('') + '</select></div><div class="route-results"><p class="small muted">当前找到 ' + matching.length + ' 道题 · 可搜索笔记与练习随记</p>' + documentEntry + '</div>' +
      (matching.length ? catalog.categories.map(category => {
        const categoryIds = matching.filter(p => p.categoryId === category.id);
        if (!categoryIds.length) return '';
        const main = catalog.problems.filter(p => p.categoryId === category.id && p.role === 'core');
        const practiced = main.filter(p => progress(p).attempts).length;
        const independent = main.filter(p => progress(p).independent).length;
        return '<section class="route-topic"><div class="topic-heading"><div><h2>' + esc(category.title) + '</h2><div class="topic-meta">主线练过 ' + practiced + ' / ' + main.length + ' · 独立完成过 ' + independent + ' / ' + main.length + '</div></div>' + '<div class="inline-actions">' + (ui.routeCategory === 'all' ? topicDocumentLink(category.id) : '') + '</div></div><div class="route-topic-description small"><p><strong>识别信号：</strong>' + esc(category.signal) + '</p><p class="muted">学习前置：' + esc(category.prerequisite) + '</p>' + (category.note ? '<p class="muted">' + esc(category.note) + '</p>' : '') + '</div><div class="route-card-grid">' + category.patterns.map(pattern => {
          const core = pattern.coreIds.filter(id => ids.has(id)), extra = pattern.extraIds.filter(id => ids.has(id));
          if (!core.length && !extra.length) return '';
          return '<article class="route-pattern-card" aria-labelledby="' + esc(pattern.id) + '-title"><div class="route-pattern-heading"><h3 id="' + esc(pattern.id) + '-title">' + esc(pattern.title) + '</h3><span class="route-pattern-count">' + (core.length + extra.length) + ' 题</span></div><p class="route-pattern-key">' + esc(pattern.key) + '</p>' + (core.length ? '<div class="route-pattern-problems">' + core.map(problemRow).join('') + '</div>' : '') + (extra.length ? '<details class="route-variants"' + (query || ui.routeRole === 'extra' ? ' open' : '') + '><summary class="variant-summary">变体 / 进阶 · ' + extra.length + ' 题</summary><div class="route-pattern-problems">' + extra.map(problemRow).join('') + '</div></details>' : '') + '</article>';
        }).join('') + '</div></section>';
      }).join('') : '<div class="panel empty"><h3>没有找到匹配题目</h3><p>可以换一个关键词或放宽筛选。</p>' + btn('清除筛选', 'clear-route') + '</div>');
  }
  function problemRow(id) {
    const p = problems.get(id), a = progress(p);
    const planned = state.plans.some(plan => plan.problemId === id && plan.date === ui.date);
    return '<article class="route-problem"><div class="problem-main"><button type="button" class="problem-title" data-action="inspect" ' + attrId(id) + '><span class="problem-number">' + esc(id) + '.</span>' + esc(p.title) + '</button><div class="problem-meta"><span class="badge ' + (p.role === 'core' ? 'main' : 'variant') + '">' + (p.role === 'core' ? '主线' : '变体') + '</span><span>' + (a.attempts ? '练过 ' + a.attempts + ' 次 · ' + esc(labels[a.latest.outcome]) : '尚未练习') + '</span></div></div><div class="route-problem-footer"><div class="problem-links">' + problemLinks(p) + '</div><div class="problem-actions">' + btn(planned ? '已在清单中' : planLabel(ui.date), 'add-plan', attrId(id) + (planned ? ' disabled' : ''), 'small') + '</div></div></article>';
  }
  function markdownToolbar(target) {
    return '<div class="md-toolbar" role="toolbar" aria-label="Markdown 格式">' + [['标题', 'heading'], ['粗体', 'bold'], ['列表', 'list'], ['任务', 'task'], ['代码块', 'code'], ['引用', 'quote'], ['链接', 'link'], ['表格', 'table']].map(([label, command]) => btn(label, 'md-command', 'data-command="' + command + '" data-target="' + target + '"', 'ghost small')).join('') + '</div>';
  }
  function renderNotes() {
    const p = currentProblem() || catalog.problems[0] || catalog.retiredProblems[0];
    if (!p) return '<div class="page-heading"><h1>题目笔记</h1></div><div class="empty"><p>先在题目管理中新增一道题。</p>' + btn('题目管理', 'page', 'data-page="manage"', 'primary') + '</div>';
    const n = draft(p.id, false);
    const found = catalog.problems.filter(item => !ui.noteQuery || allText(item).includes(ui.noteQuery.toLowerCase()));
    const editing = ui.noteMode === 'edit';
    const sidebar = '<aside class="note-sidebar note-index" aria-label="题目导航"><div class="note-index-controls"><label class="field" for="note-search">查找题目与笔记<input id="note-search" type="search" value="' + esc(ui.noteQuery) + '" placeholder="题号、题名、笔记内容"></label><label class="field" for="note-problem">选择题目<select id="note-problem">' + (found.some(item => item.id === p.id) ? '' : opt(p.id, p.id + '. ' + p.title, p.id)) + found.map(item => opt(item.id, item.id + '. ' + item.title, p.id)).join('') + '</select></label><p class="small muted">找到 ' + found.length + ' 道题</p></div><div class="note-index-resources"><h3>相关资料</h3><div class="problem-links">' + problemLinks(p) + '</div><div class="inline-actions note-topic-links">' + topicDocumentLink(p.categoryId, true) + '</div>' + btn('查看练习历史', 'history', attrId(p.id), 'small ghost') + '</div></aside>';
    const content = editing ? '<label class="sr-only" for="note-editor">题目总结 Markdown</label><textarea id="note-editor" data-problem="' + p.id + '" data-markdown-editor spellcheck="false" placeholder="写下思路推导、代码、易错点和自己的理解。">' + esc(n.content) + '</textarea>' : '<div class="note-preview note-reading">' + (n.content ? markdown(n.content) : '<div class="note-empty-state"><h3>还没有笔记</h3><p>点击右上方“编辑笔记”，记录思路、代码或易错点。</p></div>') + '</div>';
    return '<div class="page-heading"><div><h1>题目笔记</h1><p class="page-intro">每题一份笔记，阅读与编辑随时切换。</p></div>' + (activeProblemIds.has(p.id) ? '' : '<span class="small muted">已移出路线 · 历史笔记</span>') + '</div><div class="note-layout">' + sidebar + '<div class="note-workspace"><article class="note-sheet' + (editing ? ' is-editing' : '') + '" aria-labelledby="note-title"><header class="note-sheet-header"><div class="note-sheet-title"><h2 id="note-title">' + esc(p.id + '. ' + p.title) + '</h2><p class="small muted">' + esc(categories.get(p.categoryId).title + ' / ' + patterns.get(p.patternId).title) + '</p></div><div class="note-sheet-actions"><span id="note-save-status" class="small muted" role="status">' + esc(storageMessage) + '</span>' + btn(editing ? '完成编辑' : '编辑笔记', 'note-mode', 'id="note-mode-toggle"', 'small' + (editing ? ' primary' : '')) + '</div></header>' + (editing ? '<div class="note-compose-tools">' + markdownToolbar('note-editor') + moreActions(btn('追加今日分隔线', 'note-append-date', attrId(p.id), 'small ghost'), '插入', '笔记插入选项') + '</div>' : '') + '<div class="note-sheet-body">' + content + '</div></article><footer class="note-sheet-footer"><span>' + (n.updatedAt ? '最近编辑 ' + esc(stamp(n.updatedAt)) : '修改后自动保存') + '</span><span>写笔记不会增加练习次数</span></footer></div></div>';
  }
  function topicDraft(categoryId, create) {
    if (!state.topicDocs[categoryId] && create) state.topicDocs[categoryId] = { content: '', fileName: '', updatedAt: null };
    return state.topicDocs[categoryId] || { content: '', fileName: '', updatedAt: null };
  }
  function topicDocumentLink(categoryId, compact) {
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ document: categoryId }).toString();
    return '<a class="btn' + (compact ? ' small ghost' : '') + '" href="' + esc(url.href) + '" target="_blank" rel="noopener" data-topic-document>专题文档 ↗</a>';
  }
  function topicDocumentActions(categoryId, compact) {
    return topicDocumentLink(categoryId, compact) + btn('维护文档', 'topic-doc-manage', 'data-category="' + esc(categoryId) + '"', 'small ghost');
  }
  function topicManager(categoryId, mode) {
    if (!categories.has(categoryId)) return;
    flush();
    ui.topicCategory = categoryId;
    ui.topicMode = mode || 'edit';
    const category = categories.get(categoryId), doc = topicDraft(categoryId, false);
    const body = '<p class="doc-meta">' + (doc.fileName ? esc(doc.fileName) : '尚未导入 Markdown 文件') + (doc.updatedAt ? ' · 最近更新 ' + esc(stamp(doc.updatedAt)) : '') + '</p><label class="field topic-file-field" for="topic-md-file">导入 / 更新 Markdown 文件<input id="topic-md-file" type="file" accept=".md,.markdown,text/markdown,text/plain" data-category="' + categoryId + '"></label><p class="form-help">导入后可继续编辑；源文件更新时重新导入即可。</p><div class="toolbar topic-doc-toolbar">' + btn(ui.topicMode === 'edit' ? '预览文档' : '编辑文档', 'topic-doc-mode') + btn('导出 Markdown', 'topic-doc-export', 'data-category="' + categoryId + '"', 'ghost') + '<span class="small muted" data-save-status>' + esc(storageMessage) + '</span></div>' + (ui.topicMode === 'edit' ? markdownToolbar('topic-doc-editor') + '<label class="sr-only" for="topic-doc-editor">专题梳理 Markdown</label><textarea id="topic-doc-editor" data-category="' + categoryId + '" data-markdown-editor spellcheck="false" placeholder="粘贴或编写预备知识、解题模板、易错点和复习提纲。输入 / 查看 Markdown 提示。">' + esc(doc.content) + '</textarea><p class="md-editor-help">输入 / 或按 Ctrl / ⌘ + Space 查看语法提示。内容自动保存。</p>' : '<div class="reading-document note-preview">' + (doc.content ? markdown(doc.content) : '<p class="muted">还没有文档内容，可以导入文件或直接编写。</p>') + '</div>');
    const dialog = openModal(category.title + ' · 专题文档', body, topicDocumentLink(categoryId) + btn('完成', 'topic-doc-done', '', 'primary'), true);
    dialog.classList.add('topic-document-manager');
  }
  function renderDocumentPage() {
    const category = categories.get(documentCategory), doc = topicDraft(documentCategory, false);
    document.body.classList.add('document-view');
    if (!category) { app.innerHTML = '<main class="document-paper"><h1>找不到这个专题</h1><p>请回到工作台检查专题是否存在，或恢复包含该专题的完整备份。</p></main>'; return; }
    const content = document.createElement('div');
    content.innerHTML = markdown(doc.content);
    const first = content.firstElementChild;
    const title = first && first.tagName === 'H1' ? first.textContent : category.title;
    if (first && first.tagName === 'H1') first.remove();
    const headings = Array.from(content.querySelectorAll('h1, h2, h3'));
    headings.forEach((heading, index) => { heading.id = 'document-section-' + (index + 1); });
    document.title = title + ' · 专题文档';
    const sectionLink = section => '#' + new URLSearchParams({ document: documentCategory, section }).toString();
    const toc = headings.map(heading => '<a class="document-toc-link level-' + heading.tagName.slice(1) + '" href="' + esc(sectionLink(heading.id)) + '" data-action="document-section" data-target="' + heading.id + '">' + esc(heading.textContent) + '</a>').join('');
    app.innerHTML = '<header class="document-topbar"><div class="document-brand"><span class="brand-mark" aria-hidden="true">习</span><span>算法练习簿<span class="document-topbar-divider">/</span><span class="muted">' + esc(category.title) + '</span></span></div><div class="inline-actions">' + btn('导出 Markdown', 'topic-doc-export', 'data-category="' + category.id + '"', 'small') + btn('打印 / PDF', 'document-print', '', 'small ghost') + '</div></header><main class="document-layout' + (!headings.length ? ' without-toc' : '') + '">' + (headings.length ? '<aside class="document-toc"><details open><summary>文档目录</summary><nav aria-label="文档目录">' + toc + '</nav></details></aside>' : '') + '<article class="document-paper"><header class="document-cover"><div class="document-kicker">专题梳理 · 预备知识与复习</div><h1 id="document-title">' + esc(title) + '</h1><div class="doc-meta"><span>' + esc(category.title) + '</span>' + (doc.fileName ? '<span>' + esc(doc.fileName) + '</span>' : '') + (doc.updatedAt ? '<span>更新于 ' + esc(stamp(doc.updatedAt)) + '</span>' : '') + '</div></header>' + (storageIssue ? '<p class="warning">' + esc(storageIssue) + '</p>' : '') + '<div class="reading-document note-preview document-content">' + (doc.content ? content.innerHTML : '<div class="document-empty"><h2>为这个专题准备一份文档</h2><p>回到工作台，在“题目管理 → 分类管理”中点击“维护文档”，导入 AI 整理的 Markdown 文件，或直接编写预备知识、易错点和复习提纲。</p><div class="document-preparation"><p><strong>学习前置</strong><br>' + esc(category.prerequisite) + '</p><p><strong>识别信号</strong><br>' + esc(category.signal) + '</p></div></div>') + '</div><footer class="document-footer">算法练习簿 · ' + esc(category.title) + '<a href="' + esc(sectionLink('document-title')) + '" data-action="document-section" data-target="document-title">回到顶部 ↑</a></footer></article></main>';
  }
  function renderCalendar() {
    const first = new Date(ui.month + '-01T12:00:00Z');
    const offset = (first.getUTCDay() + 6) % 7;
    const start = C.addDays(ui.month + '-01', -offset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const date = C.addDays(start, i), records = dayRecords(date), plans = activePlans().filter(p => p.date === date);
      return '<button type="button" class="calendar-day' + (date === ui.date ? ' selected' : '') + (records.length ? ' has-records' : '') + (!date.startsWith(ui.month) ? ' outside' : '') + '" data-action="select-date" data-date="' + date + '" aria-label="' + esc(formatDate(date) + '，' + records.length + ' 次练习，' + plans.length + ' 项安排') + '"' + (date === ui.date ? ' aria-pressed="true"' : ' aria-pressed="false"') + '><span>' + Number(date.slice(-2)) + (date === today() ? ' · 今' : '') + '</span>' + (records.length ? '<span class="day-count">' + new Set(records.map(r => r.problemId)).size + ' 题 · ' + records.length + ' 次</span>' : '') + (plans.length ? '<span class="day-plan">安排 ' + plans.length + '</span>' : '') + (state.dayStates[date] ? '<span class="day-rest">休息标记</span>' : '') + '</button>';
    }).join('');
    const records = dayRecords(ui.date), plans = activePlans().filter(p => p.date === ui.date);
    return '<div class="page-heading"><div><h1>练习日历</h1><p class="page-intro">查看安排与实刷，随时补录或修改。</p></div>' + btn('补录练习', 'pick-record', '', 'primary') + '</div><div class="calendar-layout"><section class="panel"><div class="calendar-header"><h2>' + esc(ui.month.replace('-', ' 年 ') + ' 月') + '</h2><div class="toolbar">' + btn('‹', 'previous-month', 'aria-label="上个月"', 'icon') + btn('本月', 'current-month', '', 'ghost') + btn('›', 'next-month', 'aria-label="下个月"', 'icon') + '</div></div><div class="calendar-grid">' + ['一', '二', '三', '四', '五', '六', '日'].map(d => '<div class="calendar-weekday">' + d + '</div>').join('') + cells + '</div><div class="panel-footer small muted">绿色标记是实刷记录；安排单独显示。空白日期无需补做。</div></section><section class="panel"><div class="panel-header"><div><h2>' + esc(formatDate(ui.date)) + '</h2><p class="small muted">' + records.length + ' 次记录 · ' + plans.length + ' 项安排' + (state.dayStates[ui.date] ? ' · 休息标记' : '') + '</p></div>' + btn('查看这天清单', 'open-day', '', 'small') + '</div><div class="panel-body">' + (records.length ? renderRecords(records, { showNotes: true }) : '<div class="empty compact"><p>这天没有练习记录。</p></div>') + '</div>' + (plans.length ? '<div class="panel-header"><h3>这天的安排</h3></div>' + plans.map(planRow).join('') : '') + '</section></div>';
  }
  function renderReview() {
    if (!state.settings.reviewEnabled) return '<div class="page-heading"><div><h1>复习参考</h1><p class="page-intro">按实际表现回看，按自己的节奏复习。</p></div></div><div class="panel empty"><h2>复习建议已关闭</h2><p>可以在设置中重新开启。</p>' + btn('前往设置', 'settings') + '</div>';
    const queryDate = today();
    const list = catalog.problems.filter(p => recordsFor(p.id).length).filter(p => {
      const r = review(p.id), override = state.reviewOverrides[p.id];
      if (ui.reviewFilter === 'paused') return override && override.paused;
      if (override && override.paused) return false;
      return ui.reviewFilter === 'all' || (ui.reviewFilter === 'suggested' && nextReview(p.id) && nextReview(p.id) <= queryDate) || (ui.reviewFilter === 'learning' && r.stage === 0);
    }).sort((a, b) => (nextReview(a.id) || '9999').localeCompare(nextReview(b.id) || '9999'));
    return '<div class="page-heading"><div><h1>复习参考</h1><p class="page-intro">按实际表现回看，参考日期可自由调整。</p></div></div><div class="toolbar review-toolbar"><label for="review-filter">查看</label><select id="review-filter">' + [['all', '练过的题'], ['suggested', '现在可参考的题'], ['learning', '仍在理解'], ['paused', '已暂停的题']].map(([v, l]) => opt(v, l, ui.reviewFilter)).join('') + '</select><span class="small muted">参考间隔 ' + state.settings.reviewIntervals.join(' / ') + ' 天 · 加入清单时默认今天</span></div>' + (list.length ? '<div class="stack">' + list.map(p => {
      const r = review(p.id), date = nextReview(p.id), paused = !!(state.reviewOverrides[p.id] && state.reviewOverrides[p.id].paused);
      const planned = state.plans.some(plan => plan.problemId === p.id && plan.date === queryDate);
      const extra = btn(planned ? '已在今日清单' : '加入今日清单', 'add-review', attrId(p.id) + (planned ? ' disabled' : ''), 'small ghost') + btn('安排到其他日期', 'schedule-review', attrId(p.id), 'small ghost') + (!paused ? btn('调整参考日期', 'review-date', attrId(p.id), 'small ghost') : '') + btn(paused ? '恢复建议' : '暂停建议', 'pause-review', attrId(p.id), 'small ghost') + btn('查看练习历史', 'history', attrId(p.id), 'small ghost');
      return '<section class="panel"><div class="panel-header"><div><h3><button type="button" class="problem-title" data-action="inspect" ' + attrId(p.id) + '>' + esc(p.id + '. ' + p.title) + '</button></h3><div class="small muted">练过 ' + r.attempts + ' 次 · 独立完成过 ' + r.independentDays + ' 天 · ' + (paused ? '已暂停建议' : r.stage ? '当前复习阶段 ' + r.stage : '仍在理解') + '</div></div>' + external(p) + '</div><div class="panel-body compact"><p>' + (paused ? '等你想继续时再恢复。' : date ? '参考日期：' + shortDate(date) : '按自己的节奏继续。') + '</p><div class="inline-actions">' + btn('记录复习', 'review-record', attrId(p.id), 'small primary') + btn('笔记', 'notes', attrId(p.id), 'small ghost') + moreActions(extra, '更多', p.title + '的复习选项') + '</div></div></section>';
    }).join('') + '</div>' : '<div class="panel empty"><p>这里还没有符合条件的题。实际练过后，会逐渐形成参考。</p></div>');
  }
  function markdown(source) { return window.PlannerMarkdown.render(source); }
  function openModal(title, body, footer, wide, kind) {
    const opener = modalFocus || document.activeElement;
    if (!modalRoot.querySelector('dialog')) document.documentElement.style.setProperty('--modal-scroll-gap', Math.max(0, window.innerWidth - document.documentElement.clientWidth) + 'px');
    closeModal();
    modalFocus = opener;
    modalRoot.innerHTML = '<dialog class="dialog' + (wide ? ' modal-wide' : '') + (kind === 'inspector' ? ' problem-inspector' : '') + '" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">' + esc(title) + '</h2>' + btn('×', 'close-modal', 'aria-label="关闭窗口"', 'icon ghost') + '</div><div class="modal-body">' + body + '</div>' + (footer === null ? '' : '<div class="modal-footer">' + (footer || btn('关闭', 'close-modal')) + '</div>') + '</dialog>';
    const dialog = modalRoot.querySelector('dialog');
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal();
    });
    dialog.showModal();
    window.PlannerSelect.enhance(dialog);
    window.PlannerDate.enhance(dialog);
    window.PlannerEditor.enhance(dialog);
    return dialog;
  }
  function closeModal() {
    flush(); window.PlannerDate.close(); window.PlannerSelect.close(); window.PlannerEditor.close();
    const d = modalRoot.querySelector('dialog'); if (d) d.close();
    modalRoot.innerHTML = ''; pendingConfirm = null;
    const opener = modalFocus; modalFocus = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }
  function confirmAction(title, text, action, label) {
    openModal(title, '<p>' + esc(text) + '</p>', btn('取消', 'close-modal') + btn(label || '确认', 'confirm', '', 'primary'));
    pendingConfirm = action;
  }
  function setTopic(categoryId) {
    const category = categories.get(categoryId); if (!activeCategoryIds.has(categoryId)) return;
    const id = state.topicBookmarks[categoryId] || category.patterns.flatMap(p => p.coreIds.concat(p.extraIds))[0] || null;
    state.focus = { categoryId, problemId: id };
    if (id) state.topicBookmarks[categoryId] = id; else delete state.topicBookmarks[categoryId];
    const next = continueProblem();
    ui.selectedId = next ? next.id : id; persist(true); render();
  }
  function bookmark(id) {
    const p = problems.get(String(id)); if (!activeProblemIds.has(String(id))) return;
    state.focus = { categoryId: p.categoryId, problemId: p.id };
    state.topicBookmarks[p.categoryId] = p.id;
    const next = continueProblem();
    ui.selectedId = p.id; persist(true); render(); toast(next ? '下次继续：' + next.id + '. ' + next.title : '本专题的题目已练过一轮，可自由选题复习');
  }
  function addPlan(id, date, purpose) {
    id = String(id); if (!activeProblemIds.has(id)) return;
    if (state.plans.some(p => p.problemId === id && p.date === date)) { render(); toast('这道题已在这天的清单中，可继续记多次练习'); return; }
    state.plans.push({ id: C.id(), problemId: id, date, purpose: purpose || (progress(problems.get(id)).independent ? 'review' : 'learn'), createdAt: now() });
    persist(true); render(); toast(date ? '已加入 ' + shortDate(date) + ' 的清单' : '已放入待安排');
  }
  function practiceChoices(existing) {
    const descriptions = { independent: '不看提示完成', hint: '获得提示后完成', solution: '看过题解后复现', thinking: '还需要继续研究' };
    return '<div class="practice-outcomes" role="group" aria-label="本次掌握程度">' + Object.entries(labels).map(([value, label]) => '<button type="button" class="practice-choice' + (existing && existing.outcome === value ? ' selected' : '') + '" data-action="save-outcome" data-outcome="' + value + '"' + (existing ? ' aria-pressed="' + (existing.outcome === value) + '"' : '') + '><strong>' + label + '</strong><span>' + descriptions[value] + '</span></button>').join('') + '</div>';
  }
  function recordModal(id, recordId, planId, purpose, options) {
    options = options || {};
    const existing = state.records.find(r => r.id === recordId);
    const plan = state.plans.find(p => p.id === planId);
    if (!existing && !catalog.problems.length) return toast('题库暂时没有可练习的题，请先在题目管理中新增或恢复题目。');
    if (!existing && id && !activeProblemIds.has(String(id))) return toast('该题已移出学习路线，已有记录和笔记仍可查看、修改。');
    const preferred = id || (plan && plan.problemId) || ui.selectedId || state.focus.problemId;
    const problemId = existing ? existing.problemId : activeProblemIds.has(preferred) ? preferred : catalog.problems[0].id;
    const p = problems.get(problemId);
    const date = existing ? existing.date : options.date && options.date <= today() && C.isDate(options.date) ? options.date : today();
    const formAttrs = 'data-form="record" data-record="' + esc(existing ? existing.id : '') + '" data-plan="' + esc(existing ? existing.planId || '' : planId || '') + '" data-purpose="' + esc(purpose || (plan && plan.purpose === 'review' ? 'review' : '')) + '"';
    flush();
    const subject = options.chooseProblem ? '<label class="field">题目<select name="problemId" required>' + catalog.problems.map(item => opt(item.id, item.id + '. ' + item.title, problemId)).join('') + '</select></label>' : '<input type="hidden" name="problemId" value="' + esc(problemId) + '"><div class="practice-subject"><h3 class="practice-problem">' + esc(p.id + '. ' + p.title) + '</h3><p class="small muted">' + esc(categories.get(p.categoryId).title) + '</p></div>';
    const dateField = '<label class="field practice-date-field">练习日期<input type="date" name="date" required max="' + today() + '" value="' + date + '" data-practice-date></label>';
    const error = '<p class="warning practice-error" hidden role="alert" data-practice-error></p>';
    const body = '<form id="record-form" class="practice-form" ' + formAttrs + '>' + subject + dateField + '<p class="practice-outcome-label">本次掌握程度</p>' + practiceChoices(existing) + error + '</form>';
    const title = existing ? '修改这次记录' : options.chooseProblem ? '补录一次练习' : '记一次练习';
    const dialog = openModal(title, body, '<span class="small muted practice-save-hint">点选掌握程度即可保存</span>' + btn('取消', 'close-modal'));
    dialog.classList.add('practice-dialog');
    return dialog;
  }

  function saveRecord(form, outcome) {
    if (form.dataset.saving === 'true') return;
    const existing = state.records.find(r => r.id === form.dataset.record);
    const values = new FormData(form), date = values.get('date'), problemId = existing ? existing.problemId : values.get('problemId');
    const fail = message => { const el = form.querySelector('[data-practice-error]'); el.textContent = message; el.hidden = false; };
    if (!problems.has(problemId) || !C.isDate(date) || date > today()) return fail('请选择今天或以前的实际练习日期。');
    if (!Object.hasOwn(labels, outcome)) return fail('请点选这一次的掌握程度。');
    const practicedBefore = state.records.some(r => r.problemId === problemId && r.date <= date && r.outcome === 'independent');
    const purpose = existing ? existing.purpose : (form.dataset.purpose === 'review' || practicedBefore ? 'review' : 'learn');
    const record = { id: existing ? existing.id : C.id(), problemId, date, createdAt: existing ? existing.createdAt : now(), outcome, purpose, minutes: existing ? existing.minutes : null, note: existing ? existing.note : '', planId: existing ? existing.planId : form.dataset.plan || null };
    form.dataset.saving = 'true';
    if (existing) state.records[state.records.indexOf(existing)] = record; else state.records.push(record);
    if (!existing && state.reviewOverrides[problemId]) state.reviewOverrides[problemId].date = null;
    if (record.outcome === 'thinking' && problems.get(problemId).categoryId === state.focus.categoryId) {
      state.focus.problemId = problemId; state.topicBookmarks[state.focus.categoryId] = problemId;
    }
    ui.selectedId = problemId;
    persist(true); closeModal(); render(); toast(existing ? '这次记录已更新' : '已记录 ' + shortDate(date) + ' · ' + labels[outcome]);
  }
  function saveNote(id, value) { const n = draft(id, true); n.content = value; n.updatedAt = now(); persist(false); }
  function movePlanModal(planId) {
    const plan = state.plans.find(p => p.id === planId); if (!plan) return;
    openModal('调整这项安排', '<p>' + esc(problems.get(plan.problemId).title) + '</p><form id="move-form" data-form="move" data-plan="' + esc(planId) + '"><label class="field">安排日期（留空放回待安排）<input type="date" name="date" value="' + (plan.date || '') + '"></label><p class="form-help">实际练习记录的日期不会随安排改变。</p><p class="warning" id="move-error" hidden></p></form>', btn('取消', 'close-modal') + '<button class="btn primary" type="submit" form="move-form">保存安排</button>');
  }
  function scheduleReview(id) {
    const p = problems.get(id); if (!p || !activeProblemIds.has(id)) return;
    openModal('安排复习日期', '<p>' + esc(p.id + '. ' + p.title) + '</p><form id="schedule-review-form" data-form="schedule-review" data-id="' + esc(id) + '"><label class="field">清单日期<input type="date" name="date" value="' + today() + '"></label><p class="form-help">留空放入待安排。安排不会增加练习次数。</p><p class="warning" data-schedule-error hidden role="alert"></p></form>', btn('取消', 'close-modal') + '<button class="btn primary" type="submit" form="schedule-review-form">加入清单</button>');
  }
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function exportBackup() {
    state.lastBackupAt = now(); persist(true);
    download(JSON.stringify(C.backupEnvelope(state, catalog.version), null, 2), '刷题练习簿备份-' + today() + '-' + new Date().toISOString().slice(11, 19).replace(/:/g, '') + '.json');
    const label = document.getElementById('last-backup');
    if (label) label.textContent = '最近生成备份：' + stamp(state.lastBackupAt);
    toast('完整备份已生成，请保留下载的 JSON 文件');
  }
  function settingsModal() {
    const existingRollback = (() => { try { return !!localStorage.getItem(ROLLBACK); } catch (_) { return false; } })();
    const archivedOriginal = (() => { try { return !!localStorage.getItem(DAMAGED_ARCHIVE); } catch (_) { return false; } })();
    openModal('备份与设置', '<div class="settings-grid"><section class="settings-section"><h3>完整数据备份</h3><p>包含题库与分类调整、回收站、安排、每次练习、Markdown 笔记、动画链接、专题文档和学习位置。</p><p id="last-backup" class="small muted">最近生成备份：' + (state.lastBackupAt ? esc(stamp(state.lastBackupAt)) : '尚未生成') + '</p><div class="button-row">' + btn('导出完整 JSON 备份', 'export', '', 'primary') + (rawDamaged ? btn('导出原始数据', 'export-damaged') : '') + '</div><label class="field import-field" for="import-file">从备份恢复<input id="import-file" type="file" accept=".json,application/json"></label><p class="form-help">先检查文件，再预览恢复范围。确认后整份替换当前数据；重复导入不会叠加记录。</p>' + (existingRollback ? btn('查看上次恢复前的安全副本', 'load-rollback', '', 'small') : '') + (archivedOriginal ? btn('导出以前保留的原始数据', 'export-archived', '', 'small ghost') : '') + '</section><section class="settings-section"><h3>复习参考</h3><form id="settings-form" data-form="settings"><label class="checkbox-label"><input type="checkbox" name="reviewEnabled"' + (state.settings.reviewEnabled ? ' checked' : '') + '>显示复习建议</label><label class="field">五个阶段的参考间隔（天）<input name="intervals" value="' + state.settings.reviewIntervals.join(', ') + '" placeholder="1, 3, 7, 14, 30"></label><p class="form-help">用逗号分隔五个正整数。只是参考，不会自动排入日程。</p><p id="settings-error" class="warning" hidden role="alert"></p><button class="btn" type="submit">保存复习设置</button></form></section><section class="settings-section"><h3>本地保存</h3><p>' + esc(storageIssue || '本浏览器会自动保存每次操作。') + '</p><p class="small muted">固定使用同一个浏览器和文件路径。换浏览器、清理网站数据或移动文件前，先导出备份；在另一处通过 JSON 恢复。实际日期按北京时间记录。</p>' + (rawDamaged ? btn('保留原始副本并重新开始', 'fresh-start', '', 'danger small') : '') + (storageIssue && !rawDamaged ? btn('重试保存当前内容', 'retry-storage', '', 'small') : '') + '</section></div>', btn('关闭', 'close-modal'), true);
  }
  function previewImport(text, origin) {
    let imported;
    try { imported = C.parseBackup(text, baseCatalog); }
    catch (error) { openModal('这个备份无法恢复', '<p class="warning">' + esc(error.message) + '</p><p>当前内容保持不变。请检查是否选择了本工具导出的完整 JSON 备份。</p>'); return; }
    const dates = imported.records.map(r => r.date).sort();
    const notes = Object.values(imported.notes);
    const importedCatalog = C.resolveCatalog(baseCatalog, imported.catalogEdits);
    openModal('预览要恢复的数据', '<p>来源：' + esc(origin || 'JSON 文件') + '</p><div class="panel-body"><p>题库：' + importedCatalog.problems.length + ' 道题 · ' + importedCatalog.categories.length + ' 个专题（含本地调整与回收站）</p><p><strong>' + imported.records.length + '</strong> 次练习记录 · <strong>' + imported.plans.length + '</strong> 项安排</p><p><strong>' + notes.filter(n => n.content).length + '</strong> 道题的笔记</p><p>' + Object.values(imported.topicDocs).filter(d => d.content).length + ' 份专题文档 · ' + Object.values(imported.animationLinks).filter(Boolean).length + ' 个动画链接</p><p>练习日期：' + (dates.length ? esc(dates[0] + ' 至 ' + dates[dates.length - 1]) : '尚无记录') + '</p></div><p class="warning">恢复会整份替换当前数据。建议先下载当前备份；确认恢复前，还会保留一份当前数据的安全副本。</p><p id="import-error" class="warning" hidden role="alert"></p>', btn('取消', 'close-modal') + btn('先导出当前备份', 'export') + btn('确认整份恢复', 'apply-import', '', 'primary'), true);
    pendingImport = imported;
  }
  function applyImport() {
    if (!pendingImport) return;
    const before = JSON.stringify(C.backupEnvelope(state, catalog.version));
    try { localStorage.setItem(ROLLBACK, before); if (localStorage.getItem(ROLLBACK) !== before) throw new Error('未能核对副本'); }
    catch (error) {
      const el = document.getElementById('import-error'); el.textContent = '浏览器未能保存恢复前的安全副本。请先导出当前备份，然后点击“已下载备份，继续恢复”。'; el.hidden = false;
      const footer = modalRoot.querySelector('.modal-footer');
      if (!footer.querySelector('[data-action="apply-import-downloaded"]')) footer.insertAdjacentHTML('beforeend', btn('已下载备份，继续恢复', 'apply-import-downloaded', '', 'primary'));
      return;
    }
    finishImport();
  }
  function finishImport() {
    if (!pendingImport) return;
    if (rawDamaged) {
      try { localStorage.setItem(DAMAGED_ARCHIVE, rawDamaged); }
      catch (_) { download(rawDamaged, '刷题恢复前的原始数据-' + today() + '.json'); }
    }
    state = pendingImport; pendingImport = null; rawDamaged = null; storageAvailable = true;
    rebuildCatalog();
    selectActiveFocus(); ui.page = 'home';
    persist(true); closeModal(); render(); toast('已恢复完整备份');
  }
  function inspectProblem(id, historyOnly) {
    const p = problems.get(id); if (!p) return;
    if (ui.page === 'home' && !historyOnly) { ui.selectedId = id; render(); return; }
    flush();
    const history = recordsFor(id);
    const body = historyOnly ? '<p class="small muted">' + esc(categories.get(p.categoryId).title) + ' · ' + history.length + ' 次练习</p>' + (history.length ? renderRecords(history, { showTitle: false }) : '<div class="empty compact"><p>这道题还没有练习记录。</p></div>') : renderDetail(p, { inDialog: true });
    openModal(p.id + '. ' + p.title + (historyOnly ? ' · 练习历史' : ''), body, null, false, 'inspector');
  }
  function onAction(target) {
    const action = target.dataset.action, id = target.dataset.id;
    if (manager.onAction(target)) return;
    if (action === 'page') { closeModal(); return page(target.dataset.page); }
    if (action === 'settings') return settingsModal();
    if (action === 'close-modal') return closeModal();
    if (action === 'confirm') { const fn = pendingConfirm; closeModal(); if (fn) fn(); return; }
    if (action === 'previous-day' || action === 'next-day' || action === 'go-today') { ui.date = action === 'go-today' ? today() : C.addDays(ui.date, action === 'previous-day' ? -1 : 1); render(); return; }
    if (action === 'inspect') return inspectProblem(id);
    if (action === 'history') return inspectProblem(id, true);
    if (action === 'notes') { closeModal(); ui.selectedId = id; return page('notes'); }
    if (action === 'md-command') { const el = document.getElementById(target.dataset.target); if (el) window.PlannerEditor.command(el, target.dataset.command); return; }
    if (action === 'topic-doc-manage') return topicManager(target.dataset.category);
    if (action === 'topic-doc-done') { flush(); closeModal(); render(); return; }
    if (action === 'document-print') { window.print(); return; }
    if (action === 'document-section') { history.replaceState(null, '', target.href); const section = document.getElementById(target.dataset.target); if (section) section.scrollIntoView({ block: 'start' }); return; }
    if (action === 'topic-doc-mode') return topicManager(ui.topicCategory, ui.topicMode === 'edit' ? 'preview' : 'edit');
    if (action === 'topic-doc-export') { const category = categories.get(target.dataset.category), doc = topicDraft(category.id, false); download(doc.content, doc.fileName || category.title + '-专题梳理.md', 'text/markdown;charset=utf-8'); return; }
    if (action === 'bookmark') { closeModal(); return bookmark(id); }
    if (action === 'continue') { const next = continueProblem(); if (!next) return page('route'); ui.selectedId = next.id; addPlan(next.id, ui.date); return; }
    if (action === 'add-plan') return addPlan(id, ui.date);
    if (action === 'add-review') return addPlan(id, today(), 'review');
    if (action === 'schedule-review') return scheduleReview(id);
    if (action === 'plan-today') { const plan = state.plans.find(p => p.id === target.dataset.plan); if (!plan) return; if (state.plans.some(p => p.id !== plan.id && p.problemId === plan.problemId && p.date === ui.date)) return toast('本日已经有这道题的安排'); plan.date = ui.date; persist(true); render(); return; }
    if (action === 'move-plan') return movePlanModal(target.dataset.plan);
    if (action === 'remove-plan') { state.plans = state.plans.filter(p => p.id !== target.dataset.plan); persist(true); render(); toast('安排已移出，练习历史和笔记仍保留'); return; }
    if (action === 'record' || action === 'pick-record' || action === 'review-record') return recordModal(id, null, null, action === 'review-record' ? 'review' : undefined, { chooseProblem: action === 'pick-record', date: action === 'pick-record' ? ui.date : today() });
    if (action === 'save-outcome') return saveRecord(target.closest('form'), target.dataset.outcome);
    if (action === 'edit-record') return recordModal(null, target.dataset.record);
    if (action === 'delete-record') {
      const record = state.records.find(r => r.id === target.dataset.record); if (!record) return;
      confirmAction('删除这一次练习？', shortDate(record.date) + ' · ' + problems.get(record.problemId).title + ' · ' + labels[record.outcome] + '。仅删除这次记录，本题笔记仍保留。', () => { lastDeleted = record; state.records = state.records.filter(r => r.id !== record.id); persist(true); render(); toast('已删除一次记录', true); }, '删除这次记录'); return;
    }
    if (action === 'undo-delete') { if (!lastDeleted || state.records.some(r => r.id === lastDeleted.id)) return; state.records.push(lastDeleted); lastDeleted = null; persist(true); render(); toast('记录已恢复'); return; }
    if (action === 'append-record') {
      const record = state.records.find(r => r.id === target.dataset.record); if (!record) return;
      const n = draft(record.problemId, true); saveNote(record.problemId, n.content + (n.content ? '\n\n' : '') + '### ' + record.date + ' · ' + labels[record.outcome] + '\n\n' + record.note); closeModal(); render(); toast('随记已追加到题目笔记'); return;
    }
    if (action === 'note-mode') {
      flush(); ui.noteMode = ui.noteMode === 'edit' ? 'preview' : 'edit'; render();
      const next = document.getElementById(ui.noteMode === 'edit' ? 'note-editor' : 'note-mode-toggle');
      if (next) next.focus({ preventScroll: true });
      return;
    }
    if (action === 'note-append-date') { const n = draft(id, true); saveNote(id, n.content + (n.content ? '\n\n' : '') + '### ' + today() + '\n\n'); ui.noteMode = 'edit'; render(); const el = document.getElementById('note-editor'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); return; }
    if (action === 'clear-route') { ui.routeQuery = ''; ui.routeRole = 'all'; ui.routeCategory = 'all'; ui.routeStatus = 'all'; render(); return; }
    if (action === 'previous-month' || action === 'next-month') { const d = new Date(ui.month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + (action === 'previous-month' ? -1 : 1)); ui.month = d.toISOString().slice(0, 7); render(); return; }
    if (action === 'current-month') { ui.month = today().slice(0, 7); ui.date = today(); render(); return; }
    if (action === 'select-date') { ui.date = target.dataset.date; render(); return; }
    if (action === 'open-day') return page('home');
    if (action === 'open-calendar') { ui.month = ui.date.slice(0, 7); return page('calendar'); }
    if (action === 'pause-review') { const override = state.reviewOverrides[id] || { date: null, paused: false }; override.paused = !override.paused; state.reviewOverrides[id] = override; persist(true); render(); return; }
    if (action === 'review-date') {
      openModal('调整复习参考日期', '<p>' + esc(problems.get(id).title) + '</p><form id="review-date-form" data-form="review-date" data-id="' + id + '"><label class="field">参考日期<input name="date" type="date" value="' + (nextReview(id) || '') + '"></label><p class="form-help">留空则恢复根据练习历史推导。不会自动加入安排。</p></form>', btn('取消', 'close-modal') + '<button type="submit" class="btn primary" form="review-date-form">保存参考日期</button>'); return;
    }
    if (action === 'export') return exportBackup();
    if (action === 'export-damaged') { if (rawDamaged) download(rawDamaged, '刷题原始数据-' + today() + '.json'); return; }
    if (action === 'export-archived') { let raw; try { raw = localStorage.getItem(DAMAGED_ARCHIVE); } catch (_) {} if (raw) download(raw, '刷题保留的原始数据-' + today() + '.json'); return; }
    if (action === 'apply-import') return applyImport();
    if (action === 'apply-import-downloaded') return finishImport();
    if (action === 'load-rollback') { let raw; try { raw = localStorage.getItem(ROLLBACK); } catch (_) {} if (raw) previewImport(raw, '上次恢复之前的安全副本'); return; }
    if (action === 'fresh-start') { confirmAction('保留原始副本后重新开始？', '将先下载无法读取的原始数据，再用当前页面中的内容重新保存。可恢复的旧进度请优先通过备份导入。', () => { download(rawDamaged, '刷题原始数据-' + today() + '.json'); rawDamaged = null; storageAvailable = true; persist(true); closeModal(); render(); }, '下载原始数据并重新保存'); return; }
    if (action === 'retry-storage') { storageAvailable = true; persist(true); closeModal(); render(); toast(storageIssue ? '仍未写入，请先导出备份' : '已保存当前内容'); return; }
  }
  document.addEventListener('click', event => {
    document.querySelectorAll('.action-menu[open]').forEach(menu => { if (!menu.contains(event.target) || event.target.closest('[data-action]')) menu.open = false; });
    if (event.target.closest('[data-topic-document]')) flush();
    const target = event.target.closest('[data-action]');
    if (target && !target.disabled) { event.preventDefault(); onAction(target); return; }
    if (event.defaultPrevented || event.target.closest('a, button, input, select, textarea, label, summary, form, .action-menu, [contenteditable], [role="button"]')) return;
    const row = event.target.closest('[data-inspect-problem]');
    if (row) inspectProblem(row.dataset.inspectProblem);
  });
  document.addEventListener('toggle', event => {
    const menu = event.target;
    if (!menu.matches || !menu.matches('.action-menu[open]')) return;
    document.querySelectorAll('.action-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = Array.from(document.querySelectorAll('.action-menu[open]')).pop();
    if (!menu) return;
    event.preventDefault(); event.stopPropagation(); menu.open = false;
    menu.querySelector('summary').focus({ preventScroll: true });
  }, true);
  document.addEventListener('input', event => {
    const el = event.target;
    if (manager.input(el, event.isComposing)) return;
    if (el.id === 'note-editor') saveNote(el.dataset.problem, el.value);
    if (el.id === 'topic-doc-editor') { const doc = topicDraft(el.dataset.category, true); doc.content = el.value; doc.updatedAt = now(); persist(false); }
    if (el.id === 'route-search') { ui.routeQuery = el.value; if (!event.isComposing) render(); }
    if (el.id === 'note-search') { ui.noteQuery = el.value; if (!event.isComposing) render(); }
  });
  document.addEventListener('compositionend', event => {
    if (manager.input(event.target, false)) return;
    if (event.target.id === 'route-search') { ui.routeQuery = event.target.value; render(); }
    if (event.target.id === 'note-search') { ui.noteQuery = event.target.value; render(); }
  });
  document.addEventListener('change', async event => {
    const el = event.target;
    if (manager.change(el)) return;
    if (el.id === 'day-picker') { if (C.isDate(el.value)) ui.date = el.value; render(); }
    if (el.id === 'focus-category') { if (el.value) setTopic(el.value); }
    if (el.id === 'route-category') { ui.routeCategory = el.value; render(); }
    if (el.id === 'route-role') { ui.routeRole = el.value; render(); }
    if (el.id === 'route-status') { ui.routeStatus = el.value; render(); }
    if (el.id === 'note-problem') { flush(); ui.selectedId = el.value; ui.noteMode = 'preview'; render(); }
    if (el.id === 'review-filter') { ui.reviewFilter = el.value; render(); }
    if (el.id === 'topic-md-file' && el.files && el.files[0]) {
      const categoryId = el.dataset.category, file = el.files[0];
      try {
        const content = await file.text();
        const apply = () => { state.topicDocs[categoryId] = { content, fileName: file.name, updatedAt: now() }; persist(true); render(); topicManager(categoryId, 'preview'); toast('已导入专题 Markdown 文档'); };
        const previous = topicDraft(categoryId, false);
        if (previous.content && previous.content !== content) confirmAction('更新这个专题的文档？', '将用所选文件替换当前专题正文。重要内容可以先导出 Markdown 留存。', apply, '替换专题文档');
        else apply();
      } catch (_) { toast('文件读取失败，请重新选择 Markdown 文件'); }
    }
    if (el.dataset.planCheck) {
      const plan = state.plans.find(p => p.id === el.dataset.planCheck); if (!plan) return;
      const done = state.records.some(r => r.problemId === plan.problemId && r.date === plan.date);
      el.checked = done;
      if (!done) recordModal(plan.problemId, null, plan.id, plan.purpose === 'review' ? 'review' : undefined, { date: plan.date && plan.date <= today() ? plan.date : today() });
      else { inspectProblem(plan.problemId, ui.page !== 'home'); toast('这天已练过；可修改已有记录，或在题目详情中继续记录练习'); }
    }
    if (el.id === 'import-file' && el.files && el.files[0]) {
      const file = el.files[0];
      try { previewImport(await file.text(), file.name); } catch (error) { toast('文件读取失败，请重新选择'); }
    }
  });
  document.addEventListener('submit', event => {
    const form = event.target; if (!form.dataset.form) return; event.preventDefault();
    const data = new FormData(form);
    if (manager.submit(form, data)) return;
    if (form.dataset.form === 'record') return saveRecord(form);
    if (form.dataset.form === 'schedule-review') {
      const date = data.get('date') || null;
      if (date && !C.isDate(date)) { const el = form.querySelector('[data-schedule-error]'); el.hidden = false; el.textContent = '请选择有效的清单日期。'; return; }
      closeModal(); addPlan(form.dataset.id, date, 'review'); return;
    }
    if (form.dataset.form === 'move') {
      const plan = state.plans.find(p => p.id === form.dataset.plan); if (!plan) return;
      const date = data.get('date') || null;
      if (date && !C.isDate(date)) return;
      if (state.plans.some(p => p.id !== plan.id && p.problemId === plan.problemId && p.date === date)) { document.getElementById('move-error').hidden = false; document.getElementById('move-error').textContent = '这个日期已经有该题安排，请选择其他日期或直接移出重复安排。'; return; }
      plan.date = date; persist(true); closeModal(); render(); toast('安排已调整');
    }
    if (form.dataset.form === 'review-date') { const date = data.get('date') || null; if (date && !C.isDate(date)) return; state.reviewOverrides[form.dataset.id] = { date, paused: false }; persist(true); closeModal(); render(); }
    if (form.dataset.form === 'settings') {
      const numbers = data.get('intervals').split(/[,，\s/]+/).filter(Boolean).map(Number);
      if (numbers.length !== 5 || numbers.some(n => !Number.isSafeInteger(n) || n < 1 || n > 3650)) { const el = document.getElementById('settings-error'); el.textContent = '请填写五个 1 至 3650 的整数，用逗号分隔。'; el.hidden = false; return; }
      state.settings.reviewEnabled = data.has('reviewEnabled'); state.settings.reviewIntervals = numbers; persist(true); closeModal(); render(); toast('复习设置已保存');
    }
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', event => { flush(); if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', event => {
    if (event.key === STORE && event.newValue) {
      if (documentCategory) {
        try {
          const next = C.parseBackup(event.newValue, baseCatalog);
          const changed = JSON.stringify(next.topicDocs[documentCategory]) !== JSON.stringify(state.topicDocs[documentCategory]) || JSON.stringify(next.catalogEdits) !== JSON.stringify(state.catalogEdits);
          state = next; rebuildCatalog(); storageIssue = '';
          if (changed) renderDocumentPage();
        } catch (_) { storageIssue = '工作台数据暂时无法读取，请回到工作台检查保存状态。'; renderDocumentPage(); }
        return;
      }
      storageAvailable = false;
      storageIssue = '另一个窗口更新了数据。当前页面已暂停自动写入，请先导出本页备份，再刷新读取最新内容，避免相互覆盖。';
      setSaveStatus('其他窗口有更新 · 已暂停写入', true);
    }
  });
  init();
}());
