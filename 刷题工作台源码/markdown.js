(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlannerMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function escape(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function safeURL(value) {
    const candidate = value.trim();
    if (!/^https?:\/\//i.test(candidate) || /[\s\u0000-\u001f\u007f<>]/.test(candidate)) return null;
    try { const url = new URL(candidate); return /^(https?:)$/.test(url.protocol) ? candidate : null; } catch (_) { return null; }
  }
  function closing(text, start, open, close) {
    let depth = 1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return i;
    }
    return -1;
  }
  function linkAt(text, start) {
    const endLabel = closing(text, start + 1, '[', ']');
    if (endLabel < 0 || text[endLabel + 1] !== '(') return null;
    const end = closing(text, endLabel + 2, '(', ')');
    if (end < 0) return null;
    let destination = text.slice(endLabel + 2, end).trim();
    const titled = destination.match(/^(\S+)\s+["']([^"']*)["']$/);
    const title = titled ? titled[2] : null;
    if (titled) destination = titled[1];
    if (destination.startsWith('<') && destination.endsWith('>')) destination = destination.slice(1, -1);
    return { label: text.slice(start + 1, endLabel), href: safeURL(destination), title, end: end + 1 };
  }
  function delimiterEnd(text, marker, start) {
    let at = text.indexOf(marker, start);
    while (at >= 0 && text[at - 1] === '\\') at = text.indexOf(marker, at + marker.length);
    return at;
  }
  function inline(source, depth) {
    if (depth > 12) return escape(source);
    let html = '';
    for (let i = 0; i < source.length;) {
      const char = source[i];
      if (char === '\\' && i + 1 < source.length && /[\\`*_{}\[\]()#+\-.!>|~]/.test(source[i + 1])) { html += escape(source[i + 1]); i += 2; continue; }
      if (char === '`') {
        const marker = source.slice(i).match(/^`+/)[0], end = source.indexOf(marker, i + marker.length);
        if (end >= 0) { html += '<code>' + escape(source.slice(i + marker.length, end).replace(/\n/g, ' ')) + '</code>'; i = end + marker.length; continue; }
      }
      if (char === '!' && source[i + 1] === '[') {
        const image = linkAt(source, i + 1);
        if (image) { html += '<span class="md-image-alt">[图片：' + escape(image.label) + ']</span>'; i = image.end; continue; }
      }
      if (char === '[') {
        const link = linkAt(source, i);
        if (link && link.href) { html += '<a href="' + escape(link.href) + '" target="_blank" rel="noopener noreferrer"' + (link.title === null ? '' : ' title="' + escape(link.title) + '"') + '>' + inline(link.label, depth + 1) + '</a>'; i = link.end; continue; }
      }
      if (char === '*' || char === '_' || (char === '~' && source[i + 1] === '~')) {
        const marker = source.slice(i, i + 2) === char + char ? char + char : char;
        const insideWord = char === '_' && /[\p{L}\p{N}]/u.test(source[i - 1] || '') && /[\p{L}\p{N}]/u.test(source[i + marker.length] || '');
        const end = insideWord ? -1 : delimiterEnd(source, marker, i + marker.length);
        if (end > i + marker.length && !/^\s|\s$/.test(source.slice(i + marker.length, end))) {
          const tag = marker === '~~' ? 'del' : marker.length === 2 ? 'strong' : 'em';
          html += '<' + tag + '>' + inline(source.slice(i + marker.length, end), depth + 1) + '</' + tag + '>'; i = end + marker.length; continue;
        }
      }
      html += char === '\n' ? '<br>\n' : escape(char); i++;
    }
    return html;
  }
  function cells(line) {
    let text = line.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|') && text[text.length - 2] !== '\\') text = text.slice(0, -1);
    const result = []; let current = '', ticks = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length) { current += text[i] + text[++i]; continue; }
      if (text[i] === '`') { const run = text.slice(i).match(/^`+/)[0]; ticks = ticks === run ? '' : ticks || run; current += run; i += run.length - 1; continue; }
      if (text[i] === '|' && !ticks) { result.push(current.trim()); current = ''; } else current += text[i];
    }
    result.push(current.trim()); return result;
  }
  function tableSeparator(line) { const values = cells(line); return values.length > 0 && values.every(value => /^:?-{3,}:?$/.test(value)); }
  function indent(line) { return (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length; }
  function listItem(line) {
    const match = line.match(/^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/);
    return match ? { indent: indent(match[1]), ordered: /^\d/.test(match[2]), number: parseInt(match[2], 10), content: match[3], width: match[1].length + match[2].length + 1 } : null;
  }
  function fence(line) { return line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/); }
  function horizontal(line) { return /^(?:\*{3,}|-{3,}|_{3,})$/.test(line.trim().replace(/[ \t]/g, '')); }
  function startsBlock(lines, i) { const line = lines[i]; return !line.trim() || /^ {0,3}#{1,6}\s/.test(line) || /^ {0,3}>/.test(line) || fence(line) || horizontal(line) || listItem(line) || (i + 1 < lines.length && line.includes('|') && tableSeparator(lines[i + 1])); }
  function blocks(lines, depth) {
    if (depth > 20) return '<p>' + escape(lines.join('\n')) + '</p>';
    let html = '', i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const code = fence(line);
      if (code) {
        const marker = code[1], character = marker[0], body = [], info = code[2].trim().split(/\s/)[0]; i++;
        while (i < lines.length && !(lines[i].trim().length >= marker.length && Array.from(lines[i].trim()).every(c => c === character))) body.push(lines[i++]);
        if (i < lines.length) i++;
        const language = /^[A-Za-z0-9_+-]{1,32}$/.test(info) ? info : '';
        html += '<pre' + (language ? ' data-language="' + escape(language) + '"' : '') + '><code' + (language ? ' class="language-' + escape(language) + '"' : '') + '>' + escape(body.join('\n')) + '</code></pre>\n'; continue;
      }
      const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
      if (heading) { const level = heading[1].length; html += '<h' + level + '>' + inline(heading[2].replace(/[ \t]+#+[ \t]*$/, ''), 0) + '</h' + level + '>\n'; i++; continue; }
      if (horizontal(line)) { html += '<hr>\n'; i++; continue; }
      if (/^ {0,3}>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        html += '<blockquote>' + blocks(quote, depth + 1) + '</blockquote>\n'; continue;
      }
      if (i + 1 < lines.length && line.includes('|') && tableSeparator(lines[i + 1])) {
        const header = cells(line), alignment = cells(lines[i + 1]);
        if (header.length === alignment.length) {
          const style = index => alignment[index].startsWith(':') && alignment[index].endsWith(':') ? ' style="text-align:center"' : alignment[index].endsWith(':') ? ' style="text-align:right"' : ' style="text-align:left"';
          html += '<div class="md-table-wrap" tabindex="0" role="region" aria-label="表格"><table><thead><tr>' + header.map((value, index) => '<th' + style(index) + '>' + inline(value, 0) + '</th>').join('') + '</tr></thead><tbody>'; i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { const row = cells(lines[i++]); html += '<tr>' + header.map((_, index) => '<td' + style(index) + '>' + inline(row[index] || '', 0) + '</td>').join('') + '</tr>'; }
          html += '</tbody></table></div>\n'; continue;
        }
      }
      const first = listItem(line);
      if (first) {
        const tag = first.ordered ? 'ol' : 'ul';
        html += '<' + tag + (first.ordered && first.number !== 1 ? ' start="' + first.number + '"' : '') + '>\n';
        while (i < lines.length) {
          const item = listItem(lines[i]);
          if (!item || item.indent !== first.indent || item.ordered !== first.ordered) break;
          const content = [item.content]; i++;
          while (i < lines.length) {
            const next = listItem(lines[i]);
            if (next && next.indent <= first.indent) break;
            if (!lines[i].trim()) { if (i + 1 >= lines.length || (lines[i + 1].trim() && indent(lines[i + 1]) <= first.indent)) break; content.push(''); i++; continue; }
            if (indent(lines[i]) <= first.indent) break;
            const expanded = lines[i].replace(/^\t+/, tabs => '    '.repeat(tabs.length));
            content.push(expanded.slice(Math.min(indent(expanded), item.width))); i++;
          }
          const task = content[0].match(/^\[([ xX])\][ \t]+(.*)$/);
          if (task) content[0] = task[2];
          let body = blocks(content, depth + 1);
          if (body.startsWith('<p>')) { const end = body.indexOf('</p>'); body = body.slice(3, end) + body.slice(end + 4); }
          html += '<li' + (task ? ' class="md-task-item"' : '') + '>' + (task ? '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + ' aria-label="任务状态"> ' : '') + body + '</li>\n';
        }
        html += '</' + tag + '>\n'; continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && !startsBlock(lines, i)) paragraph.push(lines[i++]);
      html += '<p>' + inline(paragraph.join('\n'), 0) + '</p>\n';
    }
    return html;
  }
  function render(text) { return blocks(String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '\ufffd').split('\n'), 0); }
  return { render };
});
