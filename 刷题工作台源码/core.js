(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlannerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 3;
  var APP_NAME = 'leetcode-study-planner';
  var DEFAULT_INTERVALS = [1, 3, 7, 14, 30];
  var OUTCOMES = ['independent', 'hint', 'solution', 'thinking'];
  var DEFAULT_ANIMATION = 'https://www.algomooc.com/leetcode-animation/two-sum';
  var FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  var sequence = 0;

  function fail(message) { throw new Error(message); }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }

  // Inspect untrusted imports before copying keys into any application object.
  function assertSafeData(value, parents, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') fail(path + ' 含有不支持的数据');
    if (!Array.isArray(value) && !isObject(value)) fail(path + ' 必须是普通数据对象');
    if (parents.has(value)) fail(path + ' 含有循环引用');
    if (parents.size > 32) fail(path + ' 的嵌套层级异常');
    parents.add(value);
    if (Object.getOwnPropertySymbols(value).length) fail(path + ' 含有不支持的符号字段');
    Object.keys(value).forEach(function (key) {
      if (FORBIDDEN_KEYS.has(key)) fail('备份包含危险字段：' + key);
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !own(descriptor, 'value')) fail(path + ' 含有不支持的访问器');
      assertSafeData(descriptor.value, parents, path + '.' + key);
    });
    parents.delete(value);
  }

  function shape(value, required, optional, path) {
    if (!isObject(value)) fail(path + ' 必须是对象');
    var allowed = new Set(required.concat(optional || []));
    Object.keys(value).forEach(function (key) {
      if (!allowed.has(key)) fail(path + ' 含有未知字段：' + key);
    });
    required.forEach(function (key) {
      if (!own(value, key)) fail(path + ' 缺少字段：' + key);
    });
  }

  function text(value, path, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') fail(path + ' 必须是文本');
    return value;
  }

  function nonempty(value, path) {
    text(value, path);
    if (!value.trim()) fail(path + ' 不能为空');
    return value;
  }

  function boolean(value, path) {
    if (typeof value !== 'boolean') fail(path + ' 必须是布尔值');
    return value;
  }

  function enumeration(value, choices, path) {
    if (!choices.includes(value)) fail(path + ' 的值无效');
    return value;
  }

  function array(value, path) {
    if (!Array.isArray(value)) fail(path + ' 必须是数组');
    return value;
  }

  function dictionary(value, path) {
    if (!isObject(value)) fail(path + ' 必须是字典');
    return value;
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    if (parts[0] < 1 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) return false;
    var date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function calendarDate(value, path, nullable) {
    if (nullable && value === null) return null;
    if (!isDate(value)) fail(path + ' 必须是有效的 YYYY-MM-DD 日期');
    return value;
  }

  function timestamp(value, path, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !isDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) {
      fail(path + ' 必须是有效的 ISO 时间');
    }
    var clock = value.slice(11, 19).split(':').map(Number);
    if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59) fail(path + ' 的时分秒无效');
    return value;
  }

  function todayInZone(zone, now) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now === undefined ? new Date() : new Date(now));
    function part(type) { return parts.find(function (entry) { return entry.type === type; }).value; }
    return part('year').padStart(4, '0') + '-' + part('month') + '-' + part('day');
  }

  function addDays(value, amount) {
    calendarDate(value, '日期');
    if (!Number.isSafeInteger(amount)) fail('日期间隔必须是整数天');
    var parts = value.split('-').map(Number);
    var date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setUTCDate(date.getUTCDate() + amount);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
      fail('日期计算超出支持范围');
    }
    return date.getUTCFullYear().toString().padStart(4, '0') + '-' +
      (date.getUTCMonth() + 1).toString().padStart(2, '0') + '-' + date.getUTCDate().toString().padStart(2, '0');
  }

  function id(prefix) {
    var unique;
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      unique = globalThis.crypto.randomUUID();
    } else {
      sequence += 1;
      unique = Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    return prefix ? String(prefix) + '-' + unique : unique;
  }

  function catalogIndex(catalog) {
    if (!isObject(catalog)) fail('题库格式无效');
    // Retired items remain known identities for existing personal data. They are
    // not part of the active route and never generate any new learning tasks.
    var problems = array(catalog.problems, '题库 problems').concat(
      catalog.retiredProblems === undefined ? [] : array(catalog.retiredProblems, '题库 retiredProblems'));
    var categories = array(catalog.categories, '题库 categories').concat(
      catalog.retiredCategories === undefined ? [] : array(catalog.retiredCategories, '题库 retiredCategories'));
    var problemIds = new Set();
    var categoryIds = new Set();
    var problemCategories = new Map();
    problems.forEach(function (problem) {
      var problemId = String(problem.id);
      if (!problemId || problemIds.has(problemId)) fail('题库题号重复或无效');
      problemIds.add(problemId);
      if (problem.categoryId !== undefined) problemCategories.set(problemId, String(problem.categoryId));
    });
    categories.forEach(function (category) {
      var categoryId = String(category.id);
      if (!categoryId || categoryIds.has(categoryId)) fail('题库专题重复或无效');
      categoryIds.add(categoryId);
    });
    problemCategories.forEach(function (categoryId) {
      if (!categoryIds.has(categoryId)) fail('题库题目引用了未知专题：' + categoryId);
    });
    categories.forEach(function (category) {
      if (category.patterns === undefined) return;
      array(category.patterns, '专题小题型').forEach(function (pattern) {
        ['coreIds', 'extraIds'].forEach(function (key) {
          if (pattern[key] === undefined) return;
          array(pattern[key], '小题型 ' + key).forEach(function (problemId) {
            if (!problemIds.has(String(problemId))) fail('题库小题型引用了未知题号：' + String(problemId));
          });
        });
      });
    });
    return { problemIds: problemIds, categoryIds: categoryIds, problemCategories: problemCategories };
  }

  function reference(value, choices, path, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !choices.has(value)) fail(path + ' 引用了未知条目：' + String(value));
    return value;
  }

  function reviewIntervals(value) {
    array(value, '复习间隔');
    if (value.length !== 5 || value.some(function (entry) {
      return !Number.isSafeInteger(entry) || entry < 1 || entry > 36500;
    })) fail('复习间隔需要 5 个正整数（每个不超过 36500 天）');
    return value.slice();
  }

  function normalizeWebUrl(value, label) {
    label = label || '动画链接';
    text(value, label);
    var normalized = value.trim();
    if (!normalized) return '';
    if (!/^https?:\/\//i.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) fail(label + '需要使用完整的 http:// 或 https:// 地址');
    var parsed;
    try { parsed = new URL(normalized); } catch (_) { fail(label + '不是有效的网址'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      fail(label + '仅支持不含用户名和密码的 HTTP / HTTPS 网址');
    }
    return normalized;
  }

  function emptyCatalogEdits() {
    return { categories: [], problems: [], categoryStates: {}, problemStates: {}, categoryOrder: [] };
  }

  function catalogIdentity(value, path) {
    nonempty(value, path);
    if (!/^[a-zA-Z0-9_-]+$/.test(value) || FORBIDDEN_KEYS.has(value)) fail(path + ' 格式无效');
    return value;
  }

  function validateCatalogEdits(input) {
    assertSafeData(input, new Set(), '题库变更');
    shape(input, ['categories', 'problems', 'categoryStates', 'problemStates', 'categoryOrder'], [], '题库变更');
    var output = emptyCatalogEdits(), categoryIds = new Set(), problemIds = new Set();
    output.categories = array(input.categories, '自定义专题').map(function (category) {
      shape(category, ['id', 'title', 'signal', 'prerequisite', 'note', 'patterns'], [], '自定义专题');
      var categoryId = catalogIdentity(category.id, '专题 ID');
      if (categoryIds.has(categoryId)) fail('自定义专题 ID 重复');
      categoryIds.add(categoryId);
      if (!array(category.patterns, '小题型').length) fail('每个专题至少保留一个小题型');
      return { id: categoryId, title: nonempty(category.title, '专题名称').trim(), signal: text(category.signal, '识别信号'),
        prerequisite: text(category.prerequisite, '学习前置'), note: text(category.note, '专题说明'),
        patterns: array(category.patterns, '小题型').map(function (pattern) {
          shape(pattern, ['id', 'title', 'key'], [], '小题型');
          return { id: catalogIdentity(pattern.id, '小题型 ID'), title: nonempty(pattern.title, '小题型名称').trim(), key: text(pattern.key, '解题要点') };
        }) };
    });
    output.problems = array(input.problems, '自定义题目').map(function (problem) {
      shape(problem, ['id', 'title', 'url', 'categoryId', 'patternId', 'role', 'key'], [], '自定义题目');
      var problemId = text(problem.id, '题号');
      if (!/^[1-9]\d*$/.test(problemId)) fail('题号需要填写不以 0 开头的正整数');
      if (problemIds.has(problemId)) fail('自定义题号重复');
      problemIds.add(problemId);
      return { id: problemId, title: nonempty(problem.title, '题名').trim(), url: normalizeWebUrl(problem.url, '题目链接'),
        categoryId: catalogIdentity(problem.categoryId, '所属专题'), patternId: catalogIdentity(problem.patternId, '所属小题型'),
        role: enumeration(problem.role, ['core', 'extra'], '主线 / 变体'), key: text(problem.key, '解题要点') };
    });
    ['categoryStates', 'problemStates'].forEach(function (key) {
      Object.keys(dictionary(input[key], key)).forEach(function (id) {
        output[key][catalogIdentity(id, '题库条目 ID')] = boolean(input[key][id], '题库启用状态');
      });
    });
    var ordered = new Set();
    output.categoryOrder = array(input.categoryOrder, '专题顺序').map(function (id) {
      catalogIdentity(id, '专题顺序 ID');
      if (ordered.has(id)) fail('专题顺序包含重复 ID');
      ordered.add(id); return id;
    });
    return output;
  }

  // Apply local overrides to the bundled catalog, retaining every retired identity.
  // Route membership is derived here, so moving a problem never leaves stale ID lists.
  function resolveCatalog(base, input) {
    var edits = validateCatalogEdits(input || emptyCatalogEdits());
    var allCategories = new Map(), allProblems = new Map();
    var activeCategories = new Set(base.categories.map(function (c) { return c.id; }));
    var activeProblems = new Set(base.problems.map(function (p) { return String(p.id); }));
    base.categories.concat(base.retiredCategories || []).forEach(function (c) { allCategories.set(c.id, JSON.parse(JSON.stringify(c))); });
    base.problems.concat(base.retiredProblems || []).forEach(function (p) { allProblems.set(String(p.id), JSON.parse(JSON.stringify(p))); });
    edits.categories.forEach(function (c) { if (!allCategories.has(c.id)) activeCategories.add(c.id); allCategories.set(c.id, c); });
    edits.problems.forEach(function (p) { if (!allProblems.has(p.id)) activeProblems.add(p.id); allProblems.set(p.id, p); });
    [['categoryStates', allCategories, activeCategories], ['problemStates', allProblems, activeProblems]].forEach(function (entry) {
      Object.keys(edits[entry[0]]).forEach(function (id) {
        if (!entry[1].has(id)) fail('题库启用状态引用了未知条目：' + id);
        if (edits[entry[0]][id]) entry[2].add(id); else entry[2].delete(id);
      });
    });
    var patternOwners = new Map(), titles = new Set();
    allCategories.forEach(function (c) {
      if (c.title) {
        var titleKey = c.title.trim().toLowerCase();
        if (titles.has(titleKey)) fail('专题名称重复：' + c.title);
        titles.add(titleKey);
      }
      var patternTitles = new Set();
      (c.patterns || []).forEach(function (p) {
        if (patternOwners.has(p.id)) fail('小题型 ID 重复：' + p.id);
        patternOwners.set(p.id, c.id);
        if (p.title) {
          var titleKey = p.title.trim().toLowerCase();
          if (patternTitles.has(titleKey)) fail('同一专题的小题型名称重复：' + p.title);
          patternTitles.add(titleKey);
        }
        p.coreIds = []; p.extraIds = [];
      });
    });
    allProblems.forEach(function (p) {
      if (!allCategories.has(p.categoryId)) fail('题目引用了未知专题：' + p.id);
      if (p.patternId !== undefined && patternOwners.get(p.patternId) !== p.categoryId) fail('题目与小题型归属不一致：' + p.id);
      if (!activeCategories.has(p.categoryId)) activeProblems.delete(String(p.id));
      if (activeProblems.has(String(p.id)) && p.patternId !== undefined) {
        var pattern = allCategories.get(p.categoryId).patterns.find(function (item) { return item.id === p.patternId; });
        pattern[p.role === 'extra' ? 'extraIds' : 'coreIds'].push(String(p.id));
      }
    });
    edits.categoryOrder.forEach(function (id) { if (!allCategories.has(id)) fail('专题顺序引用了未知专题：' + id); });
    var orderedIds = edits.categoryOrder.concat(Array.from(allCategories.keys()).filter(function (id) { return !edits.categoryOrder.includes(id); }));
    var orderedCategories = orderedIds.map(function (id) { return allCategories.get(id); });
    return { version: base.version, categories: orderedCategories.filter(function (c) { return activeCategories.has(c.id); }),
      retiredCategories: orderedCategories.filter(function (c) { return !activeCategories.has(c.id); }),
      problems: Array.from(allProblems.values()).filter(function (p) { return activeProblems.has(String(p.id)); }),
      retiredProblems: Array.from(allProblems.values()).filter(function (p) { return !activeProblems.has(String(p.id)); }) };
  }

  function mutateCatalog(state, base, action, values) {
    assertSafeData(values, new Set(), '题库操作');
    var next = validateState(state, base), edits = next.catalogEdits;
    var catalog = resolveCatalog(base, edits);
    var categories = new Map(catalog.categories.concat(catalog.retiredCategories).map(function (c) { return [c.id, c]; }));
    var problems = new Map(catalog.problems.concat(catalog.retiredProblems).map(function (p) { return [String(p.id), p]; }));
    var activeCategoryIds = new Set(catalog.categories.map(function (c) { return c.id; }));
    var activeProblemIds = new Set(catalog.problems.map(function (p) { return String(p.id); }));
    function put(list, item) { var index = list.findIndex(function (entry) { return entry.id === item.id; }); if (index < 0) list.push(item); else list[index] = item; }
    function categoryCopy(categoryId) {
      var c = categories.get(categoryId); if (!c) fail('专题不存在');
      return { id: c.id, title: c.title, signal: c.signal || '', prerequisite: c.prerequisite || '', note: c.note || '',
        patterns: (c.patterns || []).map(function (p) { return { id: p.id, title: p.title, key: p.key || '' }; }) };
    }
    function destination() {
      if (!activeCategoryIds.has(values.categoryId)) fail('请选择可用的目标专题');
      var category = categories.get(values.categoryId);
      if (!category.patterns.some(function (p) { return p.id === values.patternId; })) fail('请选择目标专题中的小题型');
    }
    function chosenIds() {
      var ids = Array.from(new Set(array(values.ids, '所选题目')));
      if (!ids.length || ids.some(function (id) { return !problems.has(id); })) fail('请先选择有效的题目');
      return ids;
    }
    if (action === 'addProblem' || action === 'editProblem') {
      var problemId = String(values.id).trim();
      if (action === 'addProblem' && problems.has(problemId)) fail(activeProblemIds.has(problemId) ? '该题号已存在，请编辑原题' : '该题已在回收站，请恢复原题');
      if (action === 'editProblem' && !activeProblemIds.has(problemId)) fail('请先恢复这道题，再编辑');
      if (action === 'editProblem' && values.title !== problems.get(problemId).title) fail('题名创建后固定，不可修改');
      destination();
      put(edits.problems, { id: problemId, title: values.title, url: values.url, categoryId: values.categoryId,
        patternId: values.patternId, role: values.role, key: values.key || '' });
      next.animationLinks[problemId] = normalizeWebUrl(values.animation || '');
    } else if (action === 'moveProblems') {
      destination();
      chosenIds().forEach(function (id) {
        if (!activeProblemIds.has(id)) fail('请先恢复题目，再移动分类');
        put(edits.problems, Object.assign({}, problems.get(id), { categoryId: values.categoryId, patternId: values.patternId }));
      });
    } else if (action === 'deleteProblems' || action === 'restoreProblems') {
      chosenIds().forEach(function (id) {
        edits.problemStates[id] = action === 'restoreProblems';
        if (action === 'restoreProblems') edits.categoryStates[problems.get(id).categoryId] = true;
      });
    } else if (action === 'saveCategory') {
      var category = values.id ? categoryCopy(values.id) : { id: id('topic'), title: '', signal: '', prerequisite: '', note: '',
        patterns: [{ id: id('pattern'), title: '未分类', key: '' }] };
      category.title = values.title;
      ['signal', 'prerequisite', 'note'].forEach(function (key) { if (values[key] !== undefined) category[key] = values[key]; });
      put(edits.categories, category);
    } else if (action === 'deleteCategory' || action === 'restoreCategory') {
      if (!categories.has(values.id)) fail('专题不存在');
      if (action === 'deleteCategory' && catalog.problems.some(function (p) { return p.categoryId === values.id; })) fail('请先转移该专题中的题目，再删除专题');
      edits.categoryStates[values.id] = action === 'restoreCategory';
    } else if (action === 'savePattern' || action === 'deletePattern' || action === 'orderPattern') {
      if (!activeCategoryIds.has(values.categoryId)) fail('请先恢复该专题');
      var category = categoryCopy(values.categoryId), index = category.patterns.findIndex(function (p) { return p.id === values.id; });
      if (action === 'savePattern') {
        if (values.id && index < 0) fail('小题型不存在');
        put(category.patterns, { id: values.id || id('pattern'), title: values.title, key: values.key || '' });
      } else {
        if (index < 0) fail('小题型不存在');
        if (action === 'deletePattern') {
          if (Array.from(problems.values()).some(function (p) { return p.patternId === values.id; })) fail('请先转移该小题型的题目（包括回收站中的题目）');
          if (category.patterns.length === 1) fail('每个专题至少保留一个小题型，可以将它改名');
          category.patterns.splice(index, 1);
        } else {
          var target = index + enumeration(values.direction, [-1, 1], '调整方向');
          if (target >= 0 && target < category.patterns.length) { var item = category.patterns.splice(index, 1)[0]; category.patterns.splice(target, 0, item); }
        }
      }
      put(edits.categories, category);
    } else if (action === 'orderCategory') {
      var order = catalog.categories.map(function (c) { return c.id; }), index = order.indexOf(values.id);
      if (index < 0) fail('专题不存在');
      var target = index + enumeration(values.direction, [-1, 1], '调整方向');
      if (target >= 0 && target < order.length) { var item = order.splice(index, 1)[0]; order.splice(target, 0, item); }
      edits.categoryOrder = order.concat(catalog.retiredCategories.map(function (c) { return c.id; }));
    } else fail('未知题库操作');
    var resolved = resolveCatalog(base, edits);
    var active = new Map(resolved.problems.map(function (p) { return [p.id, p]; }));
    var activeCategories = new Set(resolved.categories.map(function (c) { return c.id; }));
    if (next.focus.problemId && active.has(next.focus.problemId)) next.focus.categoryId = active.get(next.focus.problemId).categoryId;
    else if (next.focus.problemId) next.focus.problemId = null;
    if (next.focus.categoryId && !activeCategories.has(next.focus.categoryId)) next.focus = { categoryId: null, problemId: null };
    Object.keys(next.topicBookmarks).forEach(function (categoryId) {
      var problem = active.get(next.topicBookmarks[categoryId]);
      if (!activeCategories.has(categoryId) || !problem || problem.categoryId !== categoryId) delete next.topicBookmarks[categoryId];
    });
    return validateState(next, base);
  }

  function mergeLegacyNote(fields) {
    shape(fields, ['thoughts', 'analysis', 'summary'], [], '旧版笔记内容');
    return [['thoughts', '心得想法'], ['analysis', '解题分析'], ['summary', '总结复盘']].map(function (entry) {
      var content = text(fields[entry[0]], entry[1]);
      return content.length ? '## ' + entry[1] + '\n\n' + content : '';
    }).filter(Boolean).join('\n\n');
  }

  function createState(catalog, today) {
    var index = catalogIndex(catalog);
    if (today !== undefined) calendarDate(today, '今天');
    return {
      schemaVersion: SCHEMA_VERSION,
      catalogVersion: String(catalog.version || '1'),
      catalogEdits: emptyCatalogEdits(),
      focus: { categoryId: null, problemId: null },
      topicBookmarks: {}, plans: [], records: [], notes: {}, topicStates: {}, dayStates: {}, reviewOverrides: {},
      animationLinks: index.problemIds.has('1') ? { '1': DEFAULT_ANIMATION } : {}, topicDocs: {},
      settings: { reviewEnabled: true, reviewIntervals: DEFAULT_INTERVALS.slice() },
      lastBackupAt: null
    };
  }

  function validateState(input, catalog, today) {
    assertSafeData(input, new Set(), '进度');
    var currentDate = today === undefined ? todayInZone('Asia/Shanghai') : calendarDate(today, '今天');
    if (!isObject(input)) fail('进度必须是对象');
    if (![1, 2, SCHEMA_VERSION].includes(input.schemaVersion)) {
      fail(input.schemaVersion > SCHEMA_VERSION ? '备份来自更高版本，请使用新版工作台恢复' : '不支持的备份数据版本');
    }
    var legacy = input.schemaVersion === 1;
    shape(input, ['schemaVersion', 'catalogVersion', 'focus', 'topicBookmarks', 'plans', 'records', 'notes',
      'topicStates', 'dayStates', 'reviewOverrides', 'settings', 'lastBackupAt'].concat(legacy ? [] : ['animationLinks', 'topicDocs']).concat(input.schemaVersion === SCHEMA_VERSION ? ['catalogEdits'] : []), [], '进度');
    var edits = input.schemaVersion === SCHEMA_VERSION ? validateCatalogEdits(input.catalogEdits) : emptyCatalogEdits();
    var index = catalogIndex(resolveCatalog(catalog, edits));
    nonempty(input.catalogVersion, 'catalogVersion');
    shape(input.focus, ['categoryId', 'problemId'], [], '当前专题');
    var output = createState(catalog);
    output.catalogEdits = edits;
    output.catalogVersion = input.catalogVersion;
    output.focus = {
      categoryId: reference(input.focus.categoryId, index.categoryIds, '当前专题', true),
      problemId: reference(input.focus.problemId, index.problemIds, '当前题目', true)
    };
    if (output.focus.categoryId && output.focus.problemId && index.problemCategories.has(output.focus.problemId) &&
      index.problemCategories.get(output.focus.problemId) !== output.focus.categoryId) fail('当前题目不属于当前专题');

    Object.keys(dictionary(input.topicBookmarks, '专题书签')).forEach(function (categoryId) {
      reference(categoryId, index.categoryIds, '书签专题');
      var problemId = reference(input.topicBookmarks[categoryId], index.problemIds, '书签题目');
      if (index.problemCategories.has(problemId) && index.problemCategories.get(problemId) !== categoryId) fail('书签题目不属于对应专题');
      output.topicBookmarks[categoryId] = problemId;
    });

    var planIds = new Set();
    output.plans = array(input.plans, '自选安排').map(function (plan) {
      shape(plan, ['id', 'problemId', 'date', 'purpose', 'createdAt'], [], '自选安排');
      nonempty(plan.id, '安排 ID');
      if (planIds.has(plan.id)) fail('安排 ID 重复：' + plan.id);
      planIds.add(plan.id);
      return {
        id: plan.id, problemId: reference(plan.problemId, index.problemIds, '安排题号'),
        date: calendarDate(plan.date, '安排日期', true), purpose: enumeration(plan.purpose, ['learn', 'review'], '安排用途'),
        createdAt: timestamp(plan.createdAt, '安排创建时间')
      };
    });

    var recordIds = new Set();
    output.records = array(input.records, '练习记录').map(function (record) {
      shape(record, ['id', 'problemId', 'date', 'createdAt', 'outcome', 'minutes', 'note', 'planId'], ['purpose'], '练习记录');
      nonempty(record.id, '记录 ID');
      if (recordIds.has(record.id)) fail('练习记录 ID 重复：' + record.id);
      recordIds.add(record.id);
      if (record.minutes !== null && (typeof record.minutes !== 'number' || !Number.isFinite(record.minutes) || record.minutes < 0)) {
        fail('实际用时必须留空或填写非负分钟数');
      }
      if (record.planId !== null) nonempty(record.planId, '关联安排 ID');
      calendarDate(record.date, '真实练习日期');
      if (record.date > currentDate) fail('真实练习日期不能在未来；未来日期只能安排计划');
      return {
        id: record.id, problemId: reference(record.problemId, index.problemIds, '练习题号'),
        date: calendarDate(record.date, '真实练习日期'), createdAt: timestamp(record.createdAt, '记录创建时间'),
        outcome: enumeration(record.outcome, OUTCOMES, '练习结果'), minutes: record.minutes,
        note: text(record.note, '本次随记'), planId: record.planId,
        purpose: enumeration(record.purpose === undefined ? 'learn' : record.purpose, ['learn', 'review'], '本次用途')
      };
    });

    var versionIds = new Set();
    Object.keys(dictionary(input.notes, '每题笔记')).forEach(function (problemId) {
      reference(problemId, index.problemIds, '笔记题号');
      var note = input.notes[problemId];
      shape(note, legacy ? ['thoughts', 'analysis', 'summary', 'updatedAt', 'versions'] : ['content', 'updatedAt', 'versions'], [], '题目笔记');
      output.notes[problemId] = {
        content: legacy ? mergeLegacyNote({ thoughts: note.thoughts, analysis: note.analysis, summary: note.summary }) : text(note.content, '题目笔记'),
        updatedAt: timestamp(note.updatedAt, '笔记更新时间', true),
        versions: array(note.versions, '已保存的笔记版本').map(function (version) {
          shape(version, legacy ? ['id', 'createdAt', 'fields'] : ['id', 'createdAt', 'content'], [], '笔记版本');
          nonempty(version.id, '笔记版本 ID');
          if (versionIds.has(version.id)) fail('笔记版本 ID 重复：' + version.id);
          versionIds.add(version.id);
          return {
            id: version.id, createdAt: timestamp(version.createdAt, '笔记版本创建时间'),
            content: legacy ? mergeLegacyNote(version.fields) : text(version.content, '历史笔记')
          };
        })
      };
    });

    if (!legacy) {
      output.animationLinks = {};
      Object.keys(dictionary(input.animationLinks, '题目动画链接')).forEach(function (problemId) {
        reference(problemId, index.problemIds, '动画链接题号');
        output.animationLinks[problemId] = normalizeWebUrl(input.animationLinks[problemId]);
      });
      Object.keys(dictionary(input.topicDocs, '专题文档')).forEach(function (categoryId) {
        reference(categoryId, index.categoryIds, '文档专题');
        var document = input.topicDocs[categoryId];
        shape(document, ['content', 'fileName', 'updatedAt'], [], '专题文档');
        output.topicDocs[categoryId] = {
          content: text(document.content, '专题文档内容'), fileName: text(document.fileName, '专题文档文件名'),
          updatedAt: timestamp(document.updatedAt, '专题文档更新时间', true)
        };
      });
    }

    Object.keys(dictionary(input.topicStates, '专题状态')).forEach(function (categoryId) {
      reference(categoryId, index.categoryIds, '状态专题');
      output.topicStates[categoryId] = enumeration(input.topicStates[categoryId], ['active', 'paused', 'done'], '专题状态');
    });
    Object.keys(dictionary(input.dayStates, '日期标记')).forEach(function (date) {
      calendarDate(date, '标记日期');
      output.dayStates[date] = enumeration(input.dayStates[date], ['stop'], '日期标记');
    });
    Object.keys(dictionary(input.reviewOverrides, '手动复习建议')).forEach(function (problemId) {
      reference(problemId, index.problemIds, '复习建议题号');
      var override = input.reviewOverrides[problemId];
      shape(override, ['date', 'paused'], [], '手动复习建议');
      output.reviewOverrides[problemId] = { date: calendarDate(override.date, '手动建议日期', true), paused: boolean(override.paused, '暂缓建议') };
    });
    shape(input.settings, ['reviewEnabled', 'reviewIntervals'], [], '设置');
    output.settings = { reviewEnabled: boolean(input.settings.reviewEnabled, '启用复习建议'), reviewIntervals: reviewIntervals(input.settings.reviewIntervals) };
    output.lastBackupAt = timestamp(input.lastBackupAt, '最近备份时间', true);
    return output;
  }

  // Resume within the selected topic, using practice results rather than a stale bookmark.
  // Finishing an assisted attempt advances learning without implying independent mastery.
  function nextLearningProblemId(state, catalog, categoryId, problemId) {
    if (categoryId === undefined) categoryId = state.focus.categoryId;
    var category = catalog.categories.find(function (item) { return item.id === categoryId; });
    if (!category) return null;
    var activeIds = new Set(catalog.problems.filter(function (item) { return item.categoryId === categoryId; }).map(function (item) { return String(item.id); }));
    var ordered = [];
    (category.patterns || []).forEach(function (pattern) {
      ordered = ordered.concat(pattern.coreIds || [], pattern.extraIds || []);
    });
    ordered = Array.from(new Set(ordered.map(String))).filter(function (id) { return activeIds.has(id); });
    if (!ordered.length) ordered = Array.from(activeIds);
    if (problemId === undefined) problemId = categoryId === state.focus.categoryId ? state.focus.problemId : state.topicBookmarks[categoryId];
    var start = Math.max(0, ordered.indexOf(problemId));
    for (var offset = 0; offset < ordered.length; offset += 1) {
      var id = ordered[(start + offset) % ordered.length];
      var latest = reviewFor(id, state.records, state.settings.reviewIntervals).latestResult;
      if (latest === null || latest === 'thinking') return id;
    }
    return null;
  }

  // Every result is recomputed from actual practice dates. Calendar gaps never produce work.
  function reviewFor(problemId, records, intervals) {
    var steps = reviewIntervals(intervals || DEFAULT_INTERVALS);
    var selected = records.filter(function (record) { return String(record.problemId) === String(problemId); }).slice();
    selected.forEach(function (record) {
      calendarDate(record.date, '真实练习日期');
      enumeration(record.outcome, OUTCOMES, '练习结果');
    });
    selected.sort(function (left, right) {
      return left.date.localeCompare(right.date) || (Date.parse(left.createdAt) - Date.parse(right.createdAt) || 0) ||
        String(left.id || '').localeCompare(String(right.id || ''));
    });
    var days = new Map();
    selected.forEach(function (record) {
      if (!days.has(record.date)) days.set(record.date, []);
      days.get(record.date).push(record);
    });
    var stage = 0;
    var nextDate = null;
    var independentDates = [];
    days.forEach(function (dayRecords, date) {
      var latest = dayRecords[dayRecords.length - 1];
      // History counts report actual entries independently of review eligibility.
      if (dayRecords.some(function (record) { return record.outcome === 'independent'; })) independentDates.push(date);
      var assisted = dayRecords.some(function (record) { return record.outcome === 'hint' || record.outcome === 'solution'; });
      var success = !assisted && latest.outcome === 'independent';
      if (!success) {
        stage = 0;
        nextDate = addDays(date, steps[0]);
        return;
      }
      if (stage === 0 || nextDate === null) {
        stage = 1;
        nextDate = addDays(date, steps[0]);
      } else if (date >= nextDate) {
        if (dayRecords.some(function (record) { return record.outcome === 'independent' && record.purpose === 'review'; })) {
          stage = Math.min(stage + 1, steps.length);
        }
        nextDate = addDays(date, steps[stage - 1]);
      }
      // An early repetition retains the already suggested date and interval.
    });
    var last = selected.length ? selected[selected.length - 1] : null;
    return {
      nextDate: nextDate, stage: stage, latestResult: last ? last.outcome : null, attempts: selected.length,
      independentDays: independentDates.length, independentDates: independentDates,
      lastDate: last ? last.date : null, status: !last ? 'unseen' : stage === 0 ? 'learning' : 'review'
    };
  }

  function backupEnvelope(state, catalogVersion) {
    assertSafeData(state, new Set(), '进度');
    if (!isObject(state) || state.schemaVersion !== SCHEMA_VERSION) fail('导出前请先通过 validateState 校验并迁移为当前数据版本');
    var copied = JSON.parse(JSON.stringify(state));
    var version = String(catalogVersion || state.catalogVersion);
    copied.catalogVersion = version;
    return {
      app: APP_NAME, schemaVersion: SCHEMA_VERSION,
      catalogVersion: version, exportedAt: new Date().toISOString(), state: copied
    };
  }

  function parseBackup(source, catalog, today) {
    if (typeof source !== 'string') fail('请选择 JSON 文本备份');
    var envelope;
    try { envelope = JSON.parse(source); } catch (_) { fail('文件不是有效的 JSON 备份'); }
    assertSafeData(envelope, new Set(), '备份');
    shape(envelope, ['app', 'schemaVersion', 'catalogVersion', 'exportedAt', 'state'], [], '备份');
    if (envelope.app !== APP_NAME) fail('这不是刷题工作台的备份');
    if (![1, 2, SCHEMA_VERSION].includes(envelope.schemaVersion)) {
      fail(envelope.schemaVersion > SCHEMA_VERSION ? '备份来自更高版本，请使用新版工作台恢复' : '不支持的备份数据版本');
    }
    nonempty(envelope.catalogVersion, '备份题库版本');
    timestamp(envelope.exportedAt, '导出时间');
    if (!isObject(envelope.state) || envelope.state.catalogVersion !== envelope.catalogVersion) fail('备份内的题库版本不一致');
    if (envelope.state.schemaVersion !== envelope.schemaVersion) fail('备份外层与进度的数据版本不一致');
    return validateState(envelope.state, catalog, today);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, APP_NAME: APP_NAME, DEFAULT_INTERVALS: DEFAULT_INTERVALS.slice(),
    createState: createState, validateState: validateState, id: id, isDate: isDate,
    todayInZone: todayInZone, addDays: addDays, reviewFor: reviewFor, nextLearningProblemId: nextLearningProblemId,
    backupEnvelope: backupEnvelope, parseBackup: parseBackup, normalizeWebUrl: normalizeWebUrl,
    emptyCatalogEdits: emptyCatalogEdits, resolveCatalog: resolveCatalog, mutateCatalog: mutateCatalog
  };
});
