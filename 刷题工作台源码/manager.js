(function () {
  'use strict';
  function create(api) {
    const { esc, btn, opt } = api;
    const view = { tab: 'problems', category: 'all', pattern: 'all', query: '', role: 'all', selected: new Set(), page: 1 };
    const pageSize = 20;
    const attr = id => 'data-id="' + esc(id) + '"';
    const allCategories = () => api.catalog().categories.concat(api.catalog().retiredCategories);
    const allProblems = () => api.catalog().problems.concat(api.catalog().retiredProblems);
    const categoryById = id => allCategories().find(c => c.id === id);
    const problemById = id => allProblems().find(p => p.id === id);
    const activeCategory = id => api.catalog().categories.some(c => c.id === id);
    const patternOf = p => categoryById(p.categoryId).patterns.find(t => t.id === p.patternId);
    const reset = () => { view.selected.clear(); view.page = 1; };
    function matching() {
      const items = view.category === 'trash' ? api.catalog().retiredProblems : api.catalog().problems;
      const query = view.query.trim().toLowerCase();
      return items.filter(p => (['all', 'trash'].includes(view.category) || p.categoryId === view.category) && (view.pattern === 'all' || p.patternId === view.pattern) && (view.role === 'all' || p.role === view.role) && (!query || [p.id, p.title, categoryById(p.categoryId).title, patternOf(p).title].join(' ').toLowerCase().includes(query)));
    }
    function categoryButton(id, title, count) {
      return '<button type="button" class="manager-category" data-action="manage-category" ' + attr(id) + ' aria-pressed="' + (view.category === id) + '"><span>' + esc(title) + '</span><span class="manager-count">' + count + '</span></button>';
    }
    function sidebar() {
      const catalog = api.catalog();
      return '<aside class="manager-sidebar" aria-label="题库分类">' + categoryButton('all', '全部题目', catalog.problems.length) + catalog.categories.map(c => categoryButton(c.id, c.title, catalog.problems.filter(p => p.categoryId === c.id).length) + (view.category === c.id && view.tab === 'problems' ? '<div class="manager-pattern-nav">' + '<button type="button" data-action="manage-pattern-filter" data-id="all" aria-pressed="' + (view.pattern === 'all') + '">全部小题型</button>' + c.patterns.map(p => '<button type="button" data-action="manage-pattern-filter" ' + attr(p.id) + ' aria-pressed="' + (view.pattern === p.id) + '">' + esc(p.title) + '<span>' + (p.coreIds.length + p.extraIds.length) + '</span></button>').join('') + '</div>' : '')).join('') + '<div class="manager-sidebar-divider"></div>' + categoryButton('trash', '回收站', catalog.retiredProblems.length + catalog.retiredCategories.length) + btn('＋ 新建专题', 'manage-new-category', '', 'ghost small') + '</aside>';
    }
    function problemRows() {
      const list = matching(), trash = view.category === 'trash';
      view.selected = new Set([...view.selected].filter(id => list.some(p => p.id === id)));
      view.page = Math.max(1, Math.min(view.page, Math.ceil(list.length / pageSize) || 1));
      const start = (view.page - 1) * pageSize, shown = list.slice(start, start + pageSize);
      const checked = list.length > 0 && list.every(p => view.selected.has(p.id));
      const selectedCount = view.selected.size;
      const controls = '<div class="manager-search"><label class="sr-only" for="manage-search">搜索题库</label><input type="search" id="manage-search" value="' + esc(view.query) + '" placeholder="搜索题号、题名或小题型"><label class="sr-only" for="manage-role">筛选主线与变体</label><select id="manage-role" aria-label="管理页主线与变体">' + opt('all', '主线与变体', view.role) + opt('core', '主线', view.role) + opt('extra', '变体', view.role) + '</select></div>';
      const bulk = '<div class="manager-bulk"><label><input type="checkbox" id="manage-select-all"' + (checked ? ' checked' : '') + (!list.length ? ' disabled' : '') + '>全选筛选结果（' + list.length + '）</label><span class="small muted" role="status">已选 ' + selectedCount + ' 题</span><div class="inline-actions">' + (trash ? btn('恢复所选', 'manage-restore-selected', selectedCount ? '' : 'disabled', 'small') : btn('移动分类', 'manage-move', selectedCount ? '' : 'disabled', 'small') + btn('删除所选', 'manage-delete-selected', selectedCount ? '' : 'disabled', 'small danger')) + '</div></div>';
      const rows = '<div class="manager-problems" role="list" aria-label="题目列表">' + (shown.length ? shown.map(p => {
        const n = api.state().notes[p.id], history = api.state().records.filter(r => r.problemId === p.id);
        const animation = api.state().animationLinks[p.id];
        return '<article class="manager-problem" role="listitem" data-managed-problem="' + esc(p.id) + '"><input type="checkbox" id="manage-check-' + esc(p.id) + '" data-manage-check="' + esc(p.id) + '" aria-label="选择 ' + esc(p.id + '. ' + p.title) + '"' + (view.selected.has(p.id) ? ' checked' : '') + '><div class="manager-problem-main">' + (trash ? '<h3>' + esc(p.id + '. ' + p.title) + '</h3>' : '<button type="button" class="problem-title" data-action="manage-edit-problem" ' + attr(p.id) + '><span class="problem-number">' + esc(p.id) + '.</span>' + esc(p.title) + '</button>') + '<div class="manager-problem-meta"><span class="badge ' + (p.role === 'core' ? 'main' : 'variant') + '">' + (p.role === 'core' ? '主线' : '变体') + '</span><span>' + esc(categoryById(p.categoryId).title + ' / ' + patternOf(p).title) + '</span>' + (history.length ? '<span>练过 ' + history.length + ' 次</span>' : '') + (n && n.content ? '<span>有笔记</span>' : '') + '</div></div><div class="manager-problem-links">' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">题目 ↗</a>' : '') + (animation ? '<a href="' + esc(animation) + '" target="_blank" rel="noopener noreferrer">动画 ↗</a>' : '') + '</div><div class="manager-row-actions">' + (trash ? btn('恢复', 'manage-restore-problem', attr(p.id), 'small') + btn('笔记', 'notes', attr(p.id), 'small ghost') : btn('编辑', 'manage-edit-problem', attr(p.id), 'small ghost') + btn('删除', 'manage-delete-problem', attr(p.id), 'small danger')) + '</div></article>';
      }).join('') : '<div class="empty"><h3>' + (trash ? '没有符合条件的已删除题目' : '没有找到题目') + '</h3><p>' + (trash ? '删除的题目会保留在这里，随时可以恢复。' : '调整筛选，或在当前专题中新增一道题。') + '</p>' + (!trash ? btn('新增题目', 'manage-new-problem', '', 'primary') : '') + '</div>') + '</div>';
      const pager = list.length > pageSize ? '<div class="manager-pagination"><span class="small muted">' + (start + 1) + '–' + Math.min(start + pageSize, list.length) + ' / ' + list.length + ' 道题</span><div class="inline-actions">' + btn('上一页', 'manage-page', 'data-direction="-1"' + (view.page === 1 ? ' disabled' : ''), 'small') + '<span class="small">' + view.page + ' / ' + Math.ceil(list.length / pageSize) + '</span>' + btn('下一页', 'manage-page', 'data-direction="1"' + (start + pageSize >= list.length ? ' disabled' : ''), 'small') + '</div></div>' : '';
      const retiredCategories = trash && api.catalog().retiredCategories.length ? '<section class="manager-retired-categories"><h2>已删除的专题</h2>' + api.catalog().retiredCategories.map(c => '<div class="manager-retired-category"><div><h3>' + esc(c.title) + '</h3><p class="small muted">' + (api.state().topicDocs[c.id] && api.state().topicDocs[c.id].content ? '专题文档已保留' : '分类信息已保留') + '</p></div><div class="inline-actions">' + api.topicActions(c.id, true) + btn('恢复专题', 'manage-restore-category', attr(c.id), 'small') + '</div></div>').join('') + '</section>' : '';
      return controls + bulk + rows + pager + retiredCategories;
    }
    function orderButtons(action, id, index, length, categoryId) {
      const extra = categoryId ? ' data-category="' + esc(categoryId) + '"' : '';
      const title = categoryId ? categoryById(categoryId).patterns.find(p => p.id === id).title : categoryById(id).title;
      return btn('↑', action, attr(id) + extra + ' data-direction="-1" aria-label="上移 ' + esc(title) + '"' + (index === 0 ? ' disabled' : ''), 'small ghost') + btn('↓', action, attr(id) + extra + ' data-direction="1" aria-label="下移 ' + esc(title) + '"' + (index === length - 1 ? ' disabled' : ''), 'small ghost');
    }
    function categoryRows() {
      const catalog = api.catalog();
      const list = catalog.categories.filter(c => view.category === 'all' || c.id === view.category);
      return list.length ? '<div class="manager-category-list">' + list.map(c => {
        const position = catalog.categories.findIndex(x => x.id === c.id), count = catalog.problems.filter(p => p.categoryId === c.id).length;
        return '<section class="manager-topic"><div class="manager-topic-heading"><div><h2>' + esc(c.title) + '</h2><p class="small muted">' + count + ' 道题 · ' + c.patterns.length + ' 个小题型</p></div><div class="inline-actions">' + orderButtons('manage-order-category', c.id, position, catalog.categories.length) + btn('编辑专题', 'manage-edit-category', attr(c.id), 'small') + btn('删除', 'manage-delete-category', attr(c.id), 'small danger') + '</div></div><div class="manager-topic-resources">' + api.topicActions(c.id, true) + btn('＋ 新增小题型', 'manage-new-pattern', 'data-category="' + esc(c.id) + '"', 'small ghost') + '</div><details class="manager-patterns"' + (view.category === c.id ? ' open' : '') + '><summary>小题型 · ' + c.patterns.length + '</summary>' + c.patterns.map((p, i) => '<div class="manager-pattern-row"><div><h3>' + esc(p.title) + '<span class="small muted"> · ' + (p.coreIds.length + p.extraIds.length) + ' 题</span></h3>' + (p.key ? '<p class="small muted">' + esc(p.key) + '</p>' : '') + '</div><div class="inline-actions">' + orderButtons('manage-order-pattern', p.id, i, c.patterns.length, c.id) + btn('编辑', 'manage-edit-pattern', attr(p.id) + ' data-category="' + esc(c.id) + '"', 'small ghost') + btn('删除', 'manage-delete-pattern', attr(p.id) + ' data-category="' + esc(c.id) + '"', 'small danger') + '</div></div>').join('') + '</details></section>';
      }).join('') + '</div>' : '<div class="panel empty"><p>还没有专题，可以先新建一个。</p>' + btn('新建专题', 'manage-new-category', '', 'primary') + '</div>';
    }
    function render() {
      const catalog = api.catalog();
      if (!['all', 'trash'].includes(view.category) && !activeCategory(view.category)) { view.category = 'all'; view.pattern = 'all'; reset(); }
      if (view.pattern !== 'all' && !catalog.categories.some(c => c.patterns.some(p => p.id === view.pattern))) view.pattern = 'all';
      if (view.category === 'trash') view.tab = 'problems';
      const category = categoryById(view.category);
      const mobileFilters = '<div class="manager-mobile-filters"><label class="field" for="manage-category-filter">专题<select id="manage-category-filter">' + opt('all', '全部题目', view.category) + catalog.categories.map(c => opt(c.id, c.title, view.category)).join('') + opt('trash', '回收站', view.category) + '</select></label>' + (category && view.tab === 'problems' ? '<label class="field" for="manage-pattern-filter">小题型<select id="manage-pattern-filter">' + opt('all', '全部小题型', view.pattern) + category.patterns.map(p => opt(p.id, p.title, view.pattern)).join('') + '</select></label>' : '') + btn('新建专题', 'manage-new-category', '', 'small') + '</div>';
      return '<div class="page-heading"><div><h1>题目管理</h1><p class="page-intro">' + catalog.problems.length + ' 道题 · ' + catalog.categories.length + ' 个专题</p></div>' + btn('＋ 新增题目', 'manage-new-problem', '', 'primary') + '</div><div class="manager-tabs" role="group" aria-label="题库管理内容">' + btn('题目列表', 'manage-tab', 'data-tab="problems" aria-pressed="' + (view.tab === 'problems') + '"') + btn('分类管理', 'manage-tab', 'data-tab="categories" aria-pressed="' + (view.tab === 'categories') + '"') + '</div>' + mobileFilters + '<div class="manager-layout">' + sidebar() + '<div class="manager-content">' + (view.tab === 'problems' ? problemRows() : categoryRows()) + '</div></div>';
    }
    function error(form, message) { const el = form.querySelector('[data-management-error]'); el.textContent = message; el.hidden = false; }
    const errorMarkup = '<p class="warning manager-form-error" data-management-error role="alert" hidden></p>';
    const submitFooter = (form, label) => btn('取消', 'close-modal') + '<button type="submit" form="' + form + '" class="btn primary">' + label + '</button>';
    function problemModal(id) {
      const catalog = api.catalog(), p = id && problemById(id);
      if (!catalog.categories.length) { categoryModal(); api.toast('先新建一个专题，再添加题目'); return; }
      const categoryId = p ? p.categoryId : activeCategory(view.category) ? view.category : catalog.categories[0].id;
      const c = categoryById(categoryId), patternId = p ? p.patternId : c.patterns.some(x => x.id === view.pattern) ? view.pattern : c.patterns[0].id;
      const body = '<form id="manage-problem-form" data-form="manage-problem" data-editing="' + esc(id || '') + '"><div class="form-grid"><label class="field">题号<input name="problemId" required inputmode="numeric" pattern="[1-9][0-9]*" value="' + esc(p ? p.id : '') + '"' + (p ? ' readonly' : '') + ' placeholder="例如：242">' + (p ? '<span class="form-help">题号固定，用于关联笔记与练习记录。</span>' : '') + '</label><label class="field">题名<input name="title" required maxlength="200" value="' + esc(p ? p.title : '') + '"' + (p ? ' readonly aria-readonly="true" title="题名已固定，不能修改"' : '') + ' placeholder="例如：有效的字母异位词"></label><label class="field" for="manage-edit-category">所属专题<select id="manage-edit-category" name="categoryId" required>' + catalog.categories.map(c => opt(c.id, c.title, categoryId)).join('') + '</select></label><label class="field" for="manage-edit-pattern">所属小题型<select id="manage-edit-pattern" name="patternId" required>' + c.patterns.map(t => opt(t.id, t.title, patternId)).join('') + '</select></label><label class="field full">题目链接（选填）<input name="url" type="url" value="' + esc(p ? p.url : '') + '" placeholder="https://leetcode.cn/problems/..."></label><label class="field full">动画链接（选填）<input name="animation" type="url" value="' + esc(p ? api.state().animationLinks[p.id] || '' : '') + '" placeholder="https://www.algomooc.com/..."></label><label class="field" for="manage-edit-role">主线 / 变体<select name="role" id="manage-edit-role">' + opt('core', '主线', p ? p.role : 'core') + opt('extra', '变体', p ? p.role : 'core') + '</select></label><label class="field full">解题要点（选填）<input name="key" value="' + esc(p ? p.key : '') + '" placeholder="写一句解题提示"></label></div>' + errorMarkup + '</form>';
      api.openModal(p ? '编辑题目' : '新增题目', body, submitFooter('manage-problem-form', '保存题目'));
    }
    function categoryModal(id) {
      const c = id && categoryById(id);
      api.openModal(c ? '编辑专题' : '新建专题', '<form id="manage-category-form" data-form="manage-category" data-id="' + esc(id || '') + '"><label class="field">专题名称<input name="title" required maxlength="100" value="' + esc(c ? c.title : '') + '" placeholder="例如：哈希表与计数"></label><details class="manager-optional"><summary>学习提示（选填）</summary><label class="field">识别信号<input name="signal" value="' + esc(c ? c.signal : '') + '"></label><label class="field">学习前置<input name="prerequisite" value="' + esc(c ? c.prerequisite : '') + '"></label><label class="field">专题说明<textarea name="note" rows="2">' + esc(c ? c.note : '') + '</textarea></label></details>' + errorMarkup + '</form>', submitFooter('manage-category-form', '保存专题'));
    }
    function patternModal(categoryId, id) {
      const c = categoryById(categoryId), p = id && c.patterns.find(x => x.id === id);
      api.openModal(p ? '编辑小题型' : '新增小题型', '<form id="manage-pattern-form" data-form="manage-pattern" data-category="' + esc(categoryId) + '" data-id="' + esc(id || '') + '"><p class="small muted">' + esc(c.title) + '</p><label class="field">小题型名称<input name="title" required maxlength="100" value="' + esc(p ? p.title : '') + '" placeholder="例如：查找配对"></label><label class="field">解题要点（选填）<textarea name="key" rows="3">' + esc(p ? p.key : '') + '</textarea></label>' + errorMarkup + '</form>', submitFooter('manage-pattern-form', '保存小题型'));
    }
    function moveModal() {
      const selected = [...view.selected]; if (!selected.length) return;
      const c = api.catalog().categories.find(c => c.id === view.category) || api.catalog().categories[0];
      api.openModal('移动 ' + selected.length + ' 道题', '<form id="manage-move-form" data-form="manage-move"><label class="field" for="manage-edit-category">目标专题<select name="categoryId" id="manage-edit-category">' + api.catalog().categories.map(x => opt(x.id, x.title, c.id)).join('') + '</select></label><label class="field" for="manage-edit-pattern">目标小题型<select name="patternId" id="manage-edit-pattern">' + c.patterns.map(p => opt(p.id, p.title)).join('') + '</select></label><p class="form-help">笔记、练习记录和已有安排继续跟随原题。</p>' + errorMarkup + '</form>', submitFooter('manage-move-form', '移动题目'));
    }
    function apply(action, values, message) {
      api.commit(action, values); api.closeModal(); api.render(); if (message) api.toast(message);
    }
    function confirmDelete(ids) {
      if (!ids.length) return;
      const title = ids.length === 1 ? '删除“' + problemById(ids[0]).title + '”？' : '删除所选 ' + ids.length + ' 道题？';
      api.confirm(title, '题目将移入回收站，暂时从学习路线、待练清单和复习建议中隐藏。笔记、练习历史及原有安排保留，恢复后重新显示。', () => {
        try { view.selected.clear(); apply('deleteProblems', { ids }, '题目已移入回收站'); } catch (e) { api.toast(e.message); }
      }, '移入回收站');
    }
    function onAction(target) {
      const action = target.dataset.action, id = target.dataset.id;
      if (!action || !action.startsWith('manage-')) return false;
      try {
        if (action === 'manage-category') { view.category = id; view.pattern = 'all'; reset(); api.render(); }
        if (action === 'manage-pattern-filter') { view.pattern = id; reset(); api.render(); }
        if (action === 'manage-tab') { view.tab = target.dataset.tab; if (view.category === 'trash') view.category = 'all'; reset(); api.render(); }
        if (action === 'manage-page') { view.page += Number(target.dataset.direction); api.render(); }
        if (action === 'manage-new-problem') problemModal();
        if (action === 'manage-edit-problem') problemModal(id);
        if (action === 'manage-new-category') categoryModal();
        if (action === 'manage-edit-category') categoryModal(id);
        if (action === 'manage-new-pattern') patternModal(target.dataset.category);
        if (action === 'manage-edit-pattern') patternModal(target.dataset.category, id);
        if (action === 'manage-move') moveModal();
        if (action === 'manage-delete-problem') confirmDelete([id]);
        if (action === 'manage-delete-selected') confirmDelete([...view.selected]);
        if (action === 'manage-restore-problem') apply('restoreProblems', { ids: [id] }, '题目与原有资料已恢复');
        if (action === 'manage-restore-selected') { const ids = [...view.selected]; view.selected.clear(); apply('restoreProblems', { ids }, '所选题目已恢复'); }
        if (action === 'manage-order-category') apply('orderCategory', { id, direction: Number(target.dataset.direction) });
        if (action === 'manage-order-pattern') apply('orderPattern', { id, categoryId: target.dataset.category, direction: Number(target.dataset.direction) });
        if (action === 'manage-delete-category') {
          if (api.catalog().problems.some(p => p.categoryId === id)) api.toast('请先将专题中的题目转移到其他专题，再删除');
          else api.confirm('删除“' + categoryById(id).title + '”？', '专题及其文档会保留在回收站，可以恢复。', () => { try { apply('deleteCategory', { id }, '专题已移入回收站'); } catch (e) { api.toast(e.message); } }, '移入回收站');
        }
        if (action === 'manage-restore-category') apply('restoreCategory', { id }, '专题已恢复');
        if (action === 'manage-delete-pattern') api.confirm('删除这个小题型？', '只可删除没有关联题目的小题型；每个专题至少保留一个小题型。', () => { try { apply('deletePattern', { id, categoryId: target.dataset.category }, '小题型已删除'); } catch (e) { api.toast(e.message); } }, '删除小题型');
      } catch (e) { api.toast(e.message); }
      return true;
    }
    function input(el, composing) { if (el.id !== 'manage-search') return false; view.query = el.value; reset(); if (!composing) api.render(); return true; }
    function change(el) {
      if (el.id === 'manage-category-filter') { view.category = el.value; view.pattern = 'all'; reset(); api.render(); return true; }
      if (el.id === 'manage-pattern-filter') { view.pattern = el.value; reset(); api.render(); return true; }
      if (el.id === 'manage-role') { view.role = el.value; reset(); api.render(); return true; }
      if (el.id === 'manage-select-all') { view.selected = new Set(el.checked ? matching().map(p => p.id) : []); api.render(); return true; }
      if (el.dataset.manageCheck) { el.checked ? view.selected.add(el.dataset.manageCheck) : view.selected.delete(el.dataset.manageCheck); api.render(); return true; }
      if (el.id === 'manage-edit-category') {
        const select = document.getElementById('manage-edit-pattern');
        select.innerHTML = categoryById(el.value).patterns.map(p => opt(p.id, p.title)).join('');
        window.PlannerSelect.enhance(el.closest('dialog')); return true;
      }
      return false;
    }
    function submit(form, data) {
      if (!form.dataset.form.startsWith('manage-')) return false;
      try {
        const values = Object.fromEntries(data);
        if (form.dataset.form === 'manage-problem') {
          api.commit(form.dataset.editing ? 'editProblem' : 'addProblem', {
            id: form.dataset.editing || values.problemId.trim(), title: values.title.trim(), categoryId: values.categoryId, patternId: values.patternId,
            role: values.role, url: values.url.trim(), animation: values.animation.trim(), key: values.key.trim()
          });
          view.tab = 'problems'; view.category = values.categoryId; view.pattern = values.patternId; view.query = ''; view.role = 'all'; reset();
          const index = matching().findIndex(p => p.id === (form.dataset.editing || values.problemId.trim()));
          view.page = Math.floor(Math.max(0, index) / pageSize) + 1;
          api.closeModal(); api.render(); api.toast('题目已保存');
        }
        if (form.dataset.form === 'manage-category') {
          const oldIds = new Set(allCategories().map(c => c.id));
          api.commit('saveCategory', { id: form.dataset.id || null, title: values.title.trim(), signal: values.signal.trim(), prerequisite: values.prerequisite.trim(), note: values.note });
          const added = api.catalog().categories.find(c => !oldIds.has(c.id));
          view.category = form.dataset.id || added.id; view.tab = 'categories'; view.pattern = 'all'; reset();
          api.closeModal(); api.render(); api.toast('专题已保存');
        }
        if (form.dataset.form === 'manage-pattern') apply('savePattern', { id: form.dataset.id || null, categoryId: form.dataset.category, title: values.title.trim(), key: values.key.trim() }, '小题型已保存');
        if (form.dataset.form === 'manage-move') { const ids = [...view.selected]; api.commit('moveProblems', { ids, categoryId: values.categoryId, patternId: values.patternId }); view.selected.clear(); api.closeModal(); api.render(); api.toast('题目已移动，笔记与练习记录继续保留'); }
      } catch (e) { error(form, e.message); }
      return true;
    }
    return { render, onAction, input, change, submit };
  }
  window.PlannerManager = { create };
}());
