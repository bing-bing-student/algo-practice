'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./markdown.js');

test('headings, emphasis, code, quoted blocks, lists, tasks and tables render offline', () => {
  const html = render('# 专题\n\n**重点**与*思路*和`Next`\n\n> 引用\n\n- [x] 已学\n- [ ] 待练\n\n3. 第一项\n4. 第二项\n\n| 题目 | 分析 |\n| :--- | ---: |\n| 206 | 反转 |\n\n---\n\n```go\nfmt.Println("hello")\n```');
  for (const tag of ['<h1>', '<strong>', '<em>', '<code>', '<blockquote>', '<ul>', '<ol start="3">', '<table>', '<hr>', 'class="language-go"']) assert.ok(html.includes(tag), tag);
  assert.match(html, /type="checkbox" disabled checked/);
  assert.match(html, /type="checkbox" disabled aria-label/);
  assert.match(html, /text-align:right/);
});

test('raw HTML and code contents cannot create executable elements', () => {
  const html = render('<svg onload=alert(1)>\n\n<img src=x onerror=alert(1)>\n\n```html\n</script><script>alert(1)</script>\n```');
  assert.doesNotMatch(html, /<(?:script|svg|img)\b/i);
  assert.match(html, /&lt;svg/);
  assert.match(html, /&lt;\/script&gt;/);
});

test('only HTTP links render, attribute-breaking text is escaped, and image URLs never load', () => {
  const html = render('[好链接](https://example.com/a?x=1&y=2 "标题")\n[javascript](javascript:alert(1))\n[data](data:text/html,test)\n[relative](/private)\n[attack](https://example.com/"onmouseover="alert(1))\n![远程图](https://private.example/pixel)');
  assert.match(html, /href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="(?:javascript:|data:|\/private)/i);
  assert.doesNotMatch(html, /<img|\ssrc=|\sonmouseover=/i);
  assert.match(html, /\[图片：远程图\]/);
});

test('nested block markup and escaped table pipes preserve user text', () => {
  const html = render('- 主线\n  - 子项\n    1. 步骤\n\n| 条件 | 代码 |\n| --- | --- |\n| a\\|b | `x|y` |');
  assert.equal((html.match(/<ul>/g) || []).length, 2);
  assert.match(html, /<ol>/);
  assert.match(html, /<td[^>]*>a\|b<\/td>/);
  assert.match(html, /<code>x\|y<\/code>/);
});

test('unclosed code fences remain escaped code, and hostile language info cannot escape attributes', () => {
  const html = render('```go" onclick="alert(1)\n<script>test</script>');
  assert.match(html, /^<pre><code>/);
  assert.doesNotMatch(html, /\sonclick=|<script/);
});
