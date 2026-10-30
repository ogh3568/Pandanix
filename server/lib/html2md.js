// 답안 에디터 HTML → Markdown / 일반 텍스트 변환 (내보내기, AI 컨텍스트용).
// 외부 의존성 없이 처리한다. 원칙: (1) <pre>/<code> 내용은 먼저 떼어 두고 (2) 엔티티 디코드는 맨 마지막에 한 번만.

const BLOCK_TAGS = 'p|div|h[1-6]|li|tr|table|blockquote|pre|ul|ol|hr|br|section|article|header|footer';

export function htmlToMarkdown(html) {
  if (!html) return '';
  const slots = [];
  const keep = (text) => {
    slots.push(text);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let s = String(html).replace(/\r/g, '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // 코드 블록·인라인 코드는 원문 보존 (안의 태그 모양 텍스트가 지워지지 않게)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => keep(`\n\`\`\`\n${decode(stripTags(c.replace(/<br\s*\/?>/gi, '\n')))}\n\`\`\`\n`));
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => keep(`\`${decode(stripTags(c))}\``));
  // 표
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => keep(tableToMd(t)));
  // 목록: 안쪽(중첩 없는) 목록부터 반복 변환
  const listRe = /<(ul|ol)[^>]*>((?:(?!<ul|<ol)[\s\S])*?)<\/\1>/i;
  let guard = 0;
  while (listRe.test(s) && guard++ < 200) {
    s = s.replace(listRe, (_, tag, inner) => {
      let i = 0;
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => {
        // 항목 안의 중첩 목록 조각은 여기서 먼저 복원해 들여쓰기를 적용한다
        const text = inlineMd(m[1]).replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]).replace(/\n{2,}/g, '\n').trim();
        const [first, ...rest] = text.split('\n');
        const bullet = tag.toLowerCase() === 'ol' ? `${++i}. ` : '- ';
        return bullet + first + (rest.length ? '\n' + rest.map((l) => '  ' + l).join('\n') : '');
      });
      return keep('\n' + items.join('\n') + '\n');
    });
  }
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n# ${inlineMd(c)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n## ${inlineMd(c)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n### ${inlineMd(c)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n#### ${inlineMd(c)}\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n> ${inlineMd(c).trim().replace(/\n/g, '\n> ')}\n`)
    .replace(/<(p|div)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `\n${inlineMd(c)}\n`)
    .replace(/<hr[^>]*>/gi, '\n---\n');
  s = inlineMd(s);
  // 보관해 둔 조각 복원 (조각 안에 또 다른 조각이 있을 수 있으므로 반복)
  let n = 0;
  while (/\u0000\d+\u0000/.test(s) && n++ < 50) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  return decode(s).replace(/\n{3,}/g, '\n\n').trim();
}

/** 인라인 서식만 변환 (디코드는 하지 않는다 - 호출자가 마지막에 한 번) */
function inlineMd(s) {
  return s
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1')
    .replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![image]($1)')
    .replace(/<[^>]+>/g, '');
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function tableToMd(table) {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      inlineMd(c[1].replace(/<br\s*\/?>/gi, ' ')).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim(),
    ),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(' | ')} |`);
  return `\n${lines.join('\n')}\n`;
}

const NAMED = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', hellip: '…', mdash: '—', ndash: '–', copy: '©', middot: '·' };

/** HTML 엔티티 디코드 (이름·10진·16진). 반드시 마지막에 한 번만 호출한다. */
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return body.toLowerCase() in NAMED ? NAMED[body.toLowerCase()] : m;
  });
}

/**
 * 일반 텍스트 (txt 내보내기, 글자 수). Markdown 을 거치지 않고 태그만 제거하므로
 * 사용자가 쓴 `_ # * >` 같은 문자가 보존된다. 블록 요소 경계는 줄바꿈으로.
 */
export function htmlToText(html) {
  if (!html) return '';
  let s = String(html).replace(/\r/g, '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/t[hd]>\s*<t[hd][^>]*>/gi, '\t'); // 셀 사이는 탭
  s = s.replace(new RegExp(`</?(${BLOCK_TAGS})[^>]*>`, 'gi'), '\n');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 글자 수 (공백 포함 = 줄바꿈 제외 / 공백 제외) */
export function countChars(text) {
  const t = String(text || '');
  return { withSpaces: t.replace(/\n/g, '').length, withoutSpaces: t.replace(/\s/g, '').length };
}
