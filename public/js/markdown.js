// 아주 작은 Markdown → HTML 변환기 (외부 라이브러리 없이 오프라인 동작).
// 지원: 제목, 굵게/기울임/취소선, 인라인 코드, 코드블록, 링크, 목록(중첩 1단계), 표, 인용, 수평선.
// 출력 HTML 은 escape 된 텍스트만 포함하므로 innerHTML 에 넣어도 안전하다.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(text) {
  // 1) 코드 스팬을 먼저 떼어 두어 안의 *, _, | 가 서식으로 해석되지 않게 한다
  const codes = [];
  let s = String(text).replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 이미지도 escape 전에 떼어 둔다: ![대체텍스트](경로 "제목")
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    if (/^javascript:/i.test(src)) return '';
    codes.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 링크: 절대 URL 은 새 탭, 상대 경로(.md 등)와 #앵커는 같은 창
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    if (/^javascript:/i.test(href)) return label;
    const abs = /^https?:/i.test(href);
    return `<a href="${href}"${abs ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  // 2) 코드 스팬 복원
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** 제목 텍스트 → 앵커 id (GitHub 방식과 비슷하게: 소문자, 공백→-, 문장부호 제거) */
export function slugify(text) {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
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
      out.push(`<h${h[1].length} id="${slugify(h[2])}">${inline(h[2])}</h${h[1].length}>`);
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
      const start = ordered ? Number(line.match(/^\s*(\d+)/)[1]) : 1;
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
      out.push(renderList(items, ordered, start));
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
  // 백틱 안의 | 와 \| 는 셀 구분자로 보지 않는다
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '`') inCode = !inCode;
    if (c === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function renderList(items, ordered, start = 1) {
  const tag = ordered ? 'ol' : 'ul';
  const base = Math.min(...items.map((it) => it.indent));
  let html = ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
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
/** CSV 텍스트 → HTML 표. "※" 또는 "#" 로 시작하는 줄은 각주로 표 아래에 표시한다. */
export function renderCsv(text, maxRows = 200) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const notes = lines.filter((l) => /^\s*[※#]/.test(l)).map((l) => l.replace(/^\s*[※#]\s*/, ''));
  const rows = lines.filter((l) => !/^\s*[※#]/.test(l)).slice(0, maxRows).map(parseCsvLine);
  if (!rows.length) return '';
  const [h, ...body] = rows;
  const table = `<table><thead><tr>${h.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${h.map((_, k) => `<td>${escapeHtml(r[k] ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
  const noteHtml = notes.length ? `<ul class="csv-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '';
  return table + noteHtml;
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
