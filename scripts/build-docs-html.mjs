#!/usr/bin/env node
// docs/**/*.md → docs/html/**/*.html 정적 가이드 생성 (오프라인, 외부 의존성 없음).
// 실행: npm run docs:build   |  결과: docs/html/index.html 을 브라우저로 열면 된다.
// 렌더러는 앱과 같은 public/js/markdown.js 를 쓰므로, 앱 안 📖 가이드와 동일하게 보인다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, escapeHtml } from '../public/js/markdown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'html');
const GROUP = { '.': '시작하기', guide: '사용 가이드', dev: '개발/유지보수' };
const ORDER = ['시작하기', '사용 가이드', '개발/유지보수'];

const files = [];
(function walk(rel) {
  const abs = path.join(DOCS, rel);
  for (const name of fs.readdirSync(abs).sort()) {
    const r = rel === '.' ? name : `${rel}/${name}`;
    const full = path.join(DOCS, r);
    if (fs.statSync(full).isDirectory()) {
      if (!['html', 'images'].includes(name)) walk(r);
    } else if (name.endsWith('.md')) {
      const md = fs.readFileSync(full, 'utf8');
      const title = (md.split('\n').find((l) => l.startsWith('# ')) || name).replace(/^#\s*/, '');
      files.push({ path: r, title, group: GROUP[rel.split('/')[0]] || rel.split('/')[0], md });
    }
  }
})('.');
files.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.path.localeCompare(b.path));

const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
const EXTRA_CSS = `
body { overflow: auto; background: var(--bg); }
.docs { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
.docs-nav { background: var(--panel); border-right: 1px solid var(--border); padding: 16px; position: sticky; top: 0; height: 100vh; overflow: auto; }
.docs-nav h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; margin: 14px 0 4px; }
.docs-nav a { display: block; padding: 5px 8px; border-radius: 6px; text-decoration: none; color: var(--text); font-size: 13.5px; }
.docs-nav a.active, .docs-nav a:hover { background: var(--accent-soft); color: var(--accent); }
.docs-nav details summary { cursor: pointer; font-size: 12px; color: var(--muted); text-transform: uppercase; margin: 14px 0 4px; }
.docs-main { padding: 28px 40px 80px; max-width: 920px; }
.prose h1 { font-size: 1.8em; margin-top: 0; }
.prose h2 { font-size: 1.35em; margin-top: 1.6em; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.prose pre { font-size: 12.5px; }
.prose table { font-size: 13.5px; }
.prose img { max-width: 100%; border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); margin: 8px 0 4px; display: block; }
.prose p > em:only-child { display: block; color: var(--muted); font-size: 12.5px; margin-top: -2px; }
.docs-foot { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.print-hint { display: none; }
@media print { .docs-nav { display: none; } .docs { display: block; } .docs-main { max-width: none; padding: 0; } .prose img { box-shadow: none; page-break-inside: avoid; } }
@media (max-width: 800px) { .docs { grid-template-columns: 1fr; } .docs-nav { position: static; height: auto; } }
`;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'guide.css'), CSS + EXTRA_CSS);

const htmlPath = (p) => p.replace(/\.md$/, '.html');
const relTo = (fromHtml, target) => path.posix.relative(path.posix.dirname(fromHtml), target) || '.';

for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const out = htmlPath(f.path);
  const dir = path.posix.dirname(out);
  const toRoot = relTo(out, '.') === '.' ? '' : relTo(out, '.') + '/';
  let body = renderMarkdown(f.md)
    // 상대 .md 링크 → .html, 앵커 유지
    .replace(/href="(?!https?:|#|mailto:)([^"#]+)\.md(#[^"]*)?"/g, (m, p, a) => `href="${p}.html${a || ''}"`)
    // 이미지: docs/images 기준 상대 경로는 그대로 두되, html 폴더 깊이에 맞춰 ../ 보정
    .replace(/src="(?!https?:|data:|\/)([^"]+)"/g, (m, p) => {
      const abs = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), p)); // docs 기준
      return `src="${toRoot}../${abs}"`;
    });
  const prev = files[i - 1];
  const next = files[i + 1];
  const nav = ORDER.map((g) => {
    const items = files.filter((x) => x.group === g).map((x) => `<a href="${toRoot}${htmlPath(x.path)}" class="${x.path === f.path ? 'active' : ''}">${escapeHtml(x.title)}</a>`).join('');
    return g === '개발/유지보수' ? `<details ${f.group === g ? 'open' : ''}><summary>${g}</summary>${items}</details>` : `<h3>${g}</h3>${items}`;
  }).join('');
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(f.title)} · Pandanix 가이드</title>
<link rel="stylesheet" href="${toRoot}assets/guide.css" />
<script>(function(){try{var t=localStorage.getItem('pandanix:theme');if(t==='"light"'||t==='"dark"')document.documentElement.setAttribute('data-theme',JSON.parse(t));var mq=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){document.documentElement.classList.toggle('system-dark',mq.matches)};a();mq.addEventListener&&mq.addEventListener('change',a)}catch(e){}})();</script>
</head>
<body>
<div class="docs">
  <nav class="docs-nav">
    <div class="brand"><span class="brand-logo">🐼</span><span class="brand-name">Pandanix</span><span class="brand-sub">가이드</span><button class="btn-icon" id="btn-theme" title="테마 전환" style="margin-left:auto" onclick="(function(b){var o=['system','light','dark'],k='pandanix:theme',t='system';try{var v=JSON.parse(localStorage.getItem(k));if(v==='light'||v==='dark')t=v}catch(e){}var n=o[(o.indexOf(t)+1)%3];var r=document.documentElement;if(n==='system'){r.removeAttribute('data-theme');localStorage.removeItem(k)}else{r.setAttribute('data-theme',n);localStorage.setItem(k,JSON.stringify(n))}b.textContent={system:'🌓',light:'☀️',dark:'🌙'}[n]})(this)">🌓</button></div>
    ${nav}
  </nav>
  <main class="docs-main">
    <article class="prose">${body}</article>
    <div class="docs-foot">
      <span>${prev ? `← <a href="${toRoot}${htmlPath(prev.path)}">${escapeHtml(prev.title)}</a>` : ''}</span>
      <span>${next ? `<a href="${toRoot}${htmlPath(next.path)}">${escapeHtml(next.title)}</a> →` : ''}</span>
    </div>
  </main>
</div>
</body>
</html>
`;
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  fs.writeFileSync(path.join(OUT, out), html);
}
// index.html = 퀵 스타트
fs.copyFileSync(path.join(OUT, 'quick-start.html'), path.join(OUT, 'index.html'));
console.log(`docs/html 생성: ${files.length}개 페이지 (+ index.html)`);
