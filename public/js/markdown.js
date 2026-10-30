// 아주 작은 Markdown → HTML 변환기 (외부 라이브러리 없이 오프라인 동작).
// 지원: 제목, 굵게/기울임/취소선, 인라인 코드, 코드블록, 링크, 목록(중첩 1단계), 표, 인용, 수평선.
// 출력 HTML 은 escape 된 텍스트만 포함하므로 innerHTML 에 넣어도 안전하다.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // 코드블록
    if (/^```/.test(line)) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // 제목
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }
    // 표
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        `<table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${header.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    // 목록
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)[0].length;
        const text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        items.push({ indent, text });
        i++;
        // 들여쓴 연속 줄은 같은 항목에 붙임
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          items[items.length - 1].text += '\n' + lines[i].trim();
          i++;
        }
      }
      out.push(renderList(items, ordered));
      continue;
    }
    // 인용
    if (/^>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join('\n');
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const base = Math.min(...items.map((it) => it.indent));
  let html = `<${tag}>`;
  let k = 0;
  while (k < items.length) {
    const it = items[k];
    const sub = [];
    k++;
    while (k < items.length && items[k].indent > base) sub.push(items[k++]);
    html += `<li>${inline(it.text).replace(/\n/g, '<br>')}${sub.length ? renderList(sub, /^\d/.test(sub[0].text)) : ''}</li>`;
  }
  return html + `</${tag}>`;
}

/** CSV 텍스트 → HTML 표 (참고자료 미리보기용) */
export function renderCsv(text, maxRows = 200) {
  const rows = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(0, maxRows).map(parseCsvLine);
  if (!rows.length) return '';
  const [h, ...body] = rows;
  return `<table><thead><tr>${h.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${h.map((_, k) => `<td>${escapeHtml(r[k] ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
