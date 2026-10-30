#!/usr/bin/env node
// 문서 점검기: npm run docs:check
// - 상대 링크(.md, #앵커)와 이미지 파일이 실제로 있는지
// - 뷰어 렌더러가 지원하지 않는 문법(HTML 태그, 체크박스, 2단계 중첩 목록) 사용 여부
// - 표 셀 안의 백틱 밖 '|' (셀이 깨짐)
// - 오래된 용어(샘플 문제집 등)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../public/js/markdown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const STALE = [/샘플 문제집/, /Node\.js 18/, /18 이상/, /HTTPS_PROXY 환경변수를 설정하고 실행하세요\. Node/, /QUICK_LABELS/, /sample-workbook/, /파일 접근 폴더(?!\s*\()/];
let problems = 0;
const report = (file, line, msg) => { problems++; console.log(`  ✘ ${path.relative(ROOT, file)}:${line}  ${msg}`); };

const mdFiles = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { if (!['html', 'images'].includes(name)) walk(full); }
    else if (name.endsWith('.md')) mdFiles.push(full);
  }
})(DOCS);
for (const extra of ['README.md', 'CLAUDE.md']) mdFiles.push(path.join(ROOT, extra));

const headings = new Map(); // file → Set(slug)
for (const f of mdFiles) {
  const set = new Set();
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) set.add(slugify(m[2]));
  }
  headings.set(f, set);
}

for (const f of mdFiles) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let inCode = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^```/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    // 링크·이미지 (인라인 코드 안의 예시는 제외)
    const plain = line.replace(/`[^`]*`/g, '');
    for (const m of plain.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [p, anchor] = href.split('#');
      const target = p ? path.resolve(path.dirname(f), p) : f;
      if (p && !fs.existsSync(target)) report(f, n, `깨진 링크/이미지: ${href}`);
      else if (anchor && headings.has(target) && !headings.get(target).has(anchor)) report(f, n, `없는 앵커: #${anchor} (${p || '같은 문서'})`);
    }
    // 렌더러 미지원 문법
    if (/<(?!slug|id|wb|p|pid|문제|문제집|파일|포트|영역|옛 문구|프로젝트|프로젝트>|경로|path|timestamp|file|name|title|key|ts>|…)[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(line) && !/`[^`]*<[^`]*`/.test(line)) report(f, n, `HTML 태그로 보이는 텍스트 (뷰어는 그대로 표시): ${line.trim().slice(0, 60)}`);
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) report(f, n, '체크박스 목록은 지원하지 않음');
    if (/^\s{4,}[-*]\s/.test(line)) report(f, n, '2단계 이상 중첩 목록은 1단계로 표시됨');
    // 표 셀 안의 백틱 밖 파이프
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const inner = line.trim().slice(1, -1);
      let code = false; let cells = 0;
      for (let k = 0; k < inner.length; k++) {
        const c = inner[k];
        if (c === '`') code = !code;
        else if (c === '\\' && inner[k + 1] === '|') k++;
        else if (c === '|' && !code) cells++;
      }
      if (code) report(f, n, '표 줄에서 백틱이 닫히지 않음');
    }
    if (!/changelog\.md$/.test(f)) for (const re of STALE) if (re.test(line)) report(f, n, `오래된 표현: ${re}`);
  });
}
// 이미지 폴더에 쓰이지 않는 파일
const imgDir = path.join(DOCS, 'images');
if (fs.existsSync(imgDir)) {
  const all = fs.readdirSync(imgDir).filter((x) => /\.(png|jpg|gif|svg)$/i.test(x));
  const text = mdFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const img of all) if (!text.includes(img)) { console.log(`  ! 사용되지 않는 이미지: docs/images/${img}`); }
}
console.log(problems ? `\n문제 ${problems}건` : '\n문서 점검 통과');
process.exit(problems ? 1 : 0);
