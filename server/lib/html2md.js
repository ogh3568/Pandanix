// 답안 에디터 HTML → Markdown / 일반 텍스트 변환 (내보내기, AI 컨텍스트용).
// 외부 의존성 없이 단순 정규식 기반으로 처리한다. 완벽한 변환보다 "읽을 수 있는 결과" 가 목표.

export function htmlToMarkdown(html) {
  if (!html) return '';
  let s = html.replace(/\r/g, '');
  // 표 먼저 처리
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => tableToMd(t));
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n# ${inline(c)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n## ${inline(c)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n### ${inline(c)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n#### ${inline(c)}\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\`\`\`\n${decode(strip(c))}\n\`\`\`\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n> ${inline(c).replace(/\n/g, '\n> ')}\n`)
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => {
      let i = 0;
      return '\n' + c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li) => `${++i}. ${inline(li)}\n`) + '\n';
    })
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, c) => '\n' + c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li) => `- ${inline(li)}\n`) + '\n')
    .replace(/<(p|div)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `\n${inline(c)}\n`)
    .replace(/<hr[^>]*>/gi, '\n---\n');
  s = inline(s);
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function inline(s) {
  return decode(
    s
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1')
      .replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
      .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![image]($1)')
      .replace(/<[^>]+>/g, ''),
  );
}

function strip(s) {
  return s.replace(/<[^>]+>/g, '');
}

function tableToMd(table) {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inline(c[1]).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(' | ')} |`);
  return `\n${lines.join('\n')}\n`;
}

export function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function htmlToText(html) {
  return htmlToMarkdown(html)
    .replace(/[*_`#>]/g, '')
    .replace(/\|/g, ' ')
    .trim();
}

/** 글자 수 (공백 포함 / 제외) */
export function countChars(text) {
  const t = String(text || '');
  return { withSpaces: t.replace(/\n/g, '').length, withoutSpaces: t.replace(/\s/g, '').length };
}
