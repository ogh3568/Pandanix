#!/usr/bin/env node
// 내장 문제집 라이브러리(server/seed/library) 무결성 검사. 사용: npm run validate:library
// 검사: JSON 문법, id 규칙, problemOrder ↔ 폴더, references ↔ 파일, 필수 필드, 글자 수 범위
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR } from './seed.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const problems = [];
let errors = 0;
const fail = (msg) => { errors++; console.log(`  ✘ ${msg}`); };

for (const slug of fs.readdirSync(LIBRARY_DIR).sort()) {
  const dir = path.join(LIBRARY_DIR, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  console.log(`\n[${slug}]`);
  let wb;
  try { wb = JSON.parse(fs.readFileSync(path.join(dir, 'workbook.json'), 'utf8')); } catch (e) { fail(`workbook.json: ${e.message}`); continue; }
  if (wb.id !== slug) fail(`workbook.id(${wb.id}) 가 폴더명과 다름`);
  if (!ID_RE.test(slug)) fail('폴더명 규칙 위반');
  for (const k of ['title', 'description', 'category', 'difficulty']) if (!wb[k]) fail(`workbook.${k} 비어 있음`);
  if (!['초급', '중급', '고급'].includes(wb.difficulty)) fail(`difficulty 값 이상: ${wb.difficulty}`);
  if (!Array.isArray(wb.problemOrder) || !wb.problemOrder.length) fail('problemOrder 비어 있음');
  const folders = fs.existsSync(path.join(dir, 'problems')) ? fs.readdirSync(path.join(dir, 'problems')) : [];
  for (const f of folders) if (!wb.problemOrder.includes(f)) fail(`problemOrder 에 없는 폴더: ${f}`);
  for (const pid of wb.problemOrder || []) {
    const pdir = path.join(dir, 'problems', pid);
    let p;
    try { p = JSON.parse(fs.readFileSync(path.join(pdir, 'problem.json'), 'utf8')); } catch (e) { fail(`${pid}/problem.json: ${e.message}`); continue; }
    if (p.id !== pid) fail(`${pid}: id 불일치(${p.id})`);
    if (!p.title) fail(`${pid}: title 없음`);
    if (!p.prompt || p.prompt.length < 150) fail(`${pid}: prompt 너무 짧음(${(p.prompt || '').length}자)`);
    if (!p.submission?.format) fail(`${pid}: submission.format 없음`);
    if (p.submission?.charLimit && (p.submission.charLimit < 200 || p.submission.charLimit > 5000)) fail(`${pid}: charLimit 이상(${p.submission.charLimit})`);
    if (!Array.isArray(p.rubric) || p.rubric.length < 2) fail(`${pid}: rubric 2개 미만`);
    if (!Array.isArray(p.hints) || !p.hints.length) fail(`${pid}: hints 없음`);
    const refDir = path.join(pdir, 'references');
    const files = fs.existsSync(refDir) ? fs.readdirSync(refDir) : [];
    if (!Array.isArray(p.references) || !p.references.length) fail(`${pid}: references 없음`);
    for (const r of p.references || []) {
      if (!files.includes(r.file)) fail(`${pid}: 참고자료 파일 없음 ${r.file}`);
      else {
        const size = fs.statSync(path.join(refDir, r.file)).size;
        if (size < 200) fail(`${pid}: 참고자료 너무 작음 ${r.file} (${size}B)`);
        if (/\.csv$/i.test(r.file)) {
          const lines = fs.readFileSync(path.join(refDir, r.file), 'utf8').trim().split(/\r?\n/).filter((l) => l.trim() && !/^\s*[※#]/.test(l));
          const cols = lines[0].split(',').length;
          const bad = lines.findIndex((l) => l.split(',').length !== cols && !/"/.test(l));
          if (bad > 0) fail(`${pid}: CSV 열 수 불일치 ${r.file} ${bad + 1}행`);
        }
      }
      if (!r.name) fail(`${pid}: 참고자료 name 없음 ${r.file}`);
    }
    for (const f of files) if (!(p.references || []).some((r) => r.file === f)) fail(`${pid}: references 목록에 없는 파일 ${f}`);
    problems.push(`${wb.title} / ${p.title}`);
    console.log(`  ✔ ${pid} ${p.title} (참고자료 ${files.length})`);
  }
}
console.log(`\n문제 ${problems.length}개 검사, 오류 ${errors}개`);
process.exit(errors ? 1 : 0);
