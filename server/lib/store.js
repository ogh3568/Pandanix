// 문제집/문제/답안/채팅 저장소. 모두 data/ 아래 JSON + 파일로 저장한다.
// 폴더 구조는 docs/dev/data-model.md 참고.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson, writeJson, httpError, safeName, exists } from './paths.js';
import { newId, nowIso } from './ids.js';

/** 텍스트로 읽어 AI 프롬프트에 넣을 수 있는 확장자 */
export const TEXT_EXTS = new Set(['.md', '.txt', '.csv', '.json', '.tsv', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.ini']);

// ---------- 경로 ----------
export const wbDir = (wbId) => path.join(DIRS.workbooks, assertId(wbId));
export const wbFile = (wbId) => path.join(wbDir(wbId), 'workbook.json');
export const problemDir = (wbId, pId) => path.join(wbDir(wbId), 'problems', assertId(pId));
export const problemFile = (wbId, pId) => path.join(problemDir(wbId, pId), 'problem.json');
export const referencesDir = (wbId, pId) => path.join(problemDir(wbId, pId), 'references');
export const answerDir = (wbId, pId) => path.join(DIRS.answers, assertId(wbId), assertId(pId));
export const answerFile = (wbId, pId) => path.join(answerDir(wbId, pId), 'answer.json');
export const attachmentsDir = (wbId, pId) => path.join(answerDir(wbId, pId), 'attachments');
export const chatFile = (wbId, pId) => path.join(answerDir(wbId, pId), 'chat.json');

function assertId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, `잘못된 ID: ${id}`);
  return id;
}

// ---------- 문제집 ----------
export function listWorkbooks() {
  if (!exists(DIRS.workbooks)) return [];
  const out = [];
  for (const name of fs.readdirSync(DIRS.workbooks)) {
    const file = path.join(DIRS.workbooks, name, 'workbook.json');
    const wb = readJson(file, null);
    if (!wb) continue;
    out.push(summarizeWorkbook(wb));
  }
  out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  return out;
}

function summarizeWorkbook(wb) {
  const problems = (wb.problemOrder || []).map((pId) => {
    const p = readJson(problemFile(wb.id, pId), null);
    return p ? { id: p.id, title: p.title, tags: p.tags || [] } : null;
  }).filter(Boolean);
  return { ...wb, problems };
}

export function getWorkbook(wbId) {
  const wb = readJson(wbFile(wbId), null);
  if (!wb) throw httpError(404, `문제집을 찾을 수 없습니다: ${wbId}`);
  return summarizeWorkbook(wb);
}

export function createWorkbook({ title, description = '', category = '', difficulty = '', source = 'manual' }) {
  if (!title || !String(title).trim()) throw httpError(400, '문제집 제목은 필수입니다.');
  const id = newId('wb');
  const wb = {
    id,
    title: String(title).trim(),
    description,
    category,
    difficulty,
    source,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    problemOrder: [],
  };
  fs.mkdirSync(path.join(wbDir(id), 'problems'), { recursive: true });
  writeJson(wbFile(id), wb);
  return summarizeWorkbook(wb);
}

export function updateWorkbook(wbId, patch) {
  const wb = readJson(wbFile(wbId), null);
  if (!wb) throw httpError(404, '문제집을 찾을 수 없습니다.');
  for (const k of ['title', 'description', 'category', 'difficulty']) if (k in patch) wb[k] = patch[k];
  if (Array.isArray(patch.problemOrder)) {
    const existing = new Set(wb.problemOrder);
    wb.problemOrder = patch.problemOrder.filter((id) => existing.has(id));
    for (const id of existing) if (!wb.problemOrder.includes(id)) wb.problemOrder.push(id);
  }
  wb.updatedAt = nowIso();
  writeJson(wbFile(wbId), wb);
  return summarizeWorkbook(wb);
}

export function deleteWorkbook(wbId) {
  const dir = wbDir(wbId);
  if (!exists(dir)) throw httpError(404, '문제집을 찾을 수 없습니다.');
  fs.rmSync(dir, { recursive: true, force: true });
  const ans = path.join(DIRS.answers, wbId);
  if (exists(ans)) fs.rmSync(ans, { recursive: true, force: true });
}

// ---------- 문제 ----------
export function getProblem(wbId, pId) {
  const p = readJson(problemFile(wbId, pId), null);
  if (!p) throw httpError(404, `문제를 찾을 수 없습니다: ${pId}`);
  p.references = listReferences(wbId, pId, p.references || []);
  return p;
}

const PROBLEM_FIELDS = ['title', 'prompt', 'submission', 'hints', 'rubric', 'tags', 'difficulty', 'estimatedMinutes'];

export function createProblem(wbId, data) {
  const wb = readJson(wbFile(wbId), null);
  if (!wb) throw httpError(404, '문제집을 찾을 수 없습니다.');
  if (!data.title || !String(data.title).trim()) throw httpError(400, '문제 제목은 필수입니다.');
  const id = newId('p');
  const p = {
    id,
    title: String(data.title).trim(),
    prompt: data.prompt || '',
    submission: normalizeSubmission(data.submission),
    hints: Array.isArray(data.hints) ? data.hints : [],
    rubric: Array.isArray(data.rubric) ? data.rubric : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    difficulty: data.difficulty || '',
    estimatedMinutes: data.estimatedMinutes || null,
    references: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  fs.mkdirSync(referencesDir(wbId, id), { recursive: true });
  writeJson(problemFile(wbId, id), p);
  wb.problemOrder.push(id);
  wb.updatedAt = nowIso();
  writeJson(wbFile(wbId), wb);
  return p;
}

export function updateProblem(wbId, pId, patch) {
  const p = readJson(problemFile(wbId, pId), null);
  if (!p) throw httpError(404, '문제를 찾을 수 없습니다.');
  for (const k of PROBLEM_FIELDS) {
    if (!(k in patch)) continue;
    p[k] = k === 'submission' ? normalizeSubmission(patch[k]) : patch[k];
  }
  if (Array.isArray(patch.references)) {
    // 설명(description) 수정만 허용. 파일 자체는 별도 API 로 관리
    const byFile = new Map(patch.references.map((r) => [r.file, r]));
    p.references = (p.references || []).map((r) => ({ ...r, description: byFile.get(r.file)?.description ?? r.description }));
  }
  p.updatedAt = nowIso();
  writeJson(problemFile(wbId, pId), p);
  return getProblem(wbId, pId);
}

export function deleteProblem(wbId, pId) {
  const wb = readJson(wbFile(wbId), null);
  if (!wb) throw httpError(404, '문제집을 찾을 수 없습니다.');
  const dir = problemDir(wbId, pId);
  if (exists(dir)) fs.rmSync(dir, { recursive: true, force: true });
  wb.problemOrder = wb.problemOrder.filter((id) => id !== pId);
  wb.updatedAt = nowIso();
  writeJson(wbFile(wbId), wb);
  const ans = answerDir(wbId, pId);
  if (exists(ans)) fs.rmSync(ans, { recursive: true, force: true });
}

function normalizeSubmission(s) {
  const sub = s && typeof s === 'object' ? s : { format: String(s || '') };
  return {
    format: sub.format || '',
    charLimit: sub.charLimit ? Number(sub.charLimit) : null,
    deliverables: Array.isArray(sub.deliverables) ? sub.deliverables : [],
  };
}

// ---------- 참고자료 ----------
function listReferences(wbId, pId, meta) {
  const dir = referencesDir(wbId, pId);
  if (!exists(dir)) return [];
  const metaByFile = new Map(meta.map((m) => [m.file, m]));
  const order = new Map(meta.map((m, i) => [m.file, i]));
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b))
    .map((file) => {
      const st = fs.statSync(path.join(dir, file));
      const ext = path.extname(file).toLowerCase();
      return {
        file,
        name: metaByFile.get(file)?.name || file,
        description: metaByFile.get(file)?.description || '',
        size: st.size,
        ext,
        isText: TEXT_EXTS.has(ext),
      };
    });
}

export function addReferenceFile(wbId, pId, { fileName, buffer, description = '', name }) {
  const p = readJson(problemFile(wbId, pId), null);
  if (!p) throw httpError(404, '문제를 찾을 수 없습니다.');
  const dir = referencesDir(wbId, pId);
  fs.mkdirSync(dir, { recursive: true });
  let file = safeName(fileName, 'reference.txt');
  const base = path.parse(file);
  let n = 1;
  while (exists(path.join(dir, file))) file = `${base.name}(${n++})${base.ext}`;
  fs.writeFileSync(path.join(dir, file), buffer);
  p.references = (p.references || []).filter((r) => r.file !== file);
  p.references.push({ file, name: name || file, description });
  p.updatedAt = nowIso();
  writeJson(problemFile(wbId, pId), p);
  return getProblem(wbId, pId);
}

export function removeReferenceFile(wbId, pId, file) {
  const p = readJson(problemFile(wbId, pId), null);
  if (!p) throw httpError(404, '문제를 찾을 수 없습니다.');
  const target = path.join(referencesDir(wbId, pId), safeName(file));
  if (exists(target)) fs.rmSync(target);
  p.references = (p.references || []).filter((r) => r.file !== file);
  p.updatedAt = nowIso();
  writeJson(problemFile(wbId, pId), p);
  return getProblem(wbId, pId);
}

export function referencePath(wbId, pId, file) {
  const target = path.join(referencesDir(wbId, pId), safeName(file));
  if (!exists(target)) throw httpError(404, `참고자료 파일이 없습니다: ${file}`);
  return target;
}

/** AI 프롬프트용: 텍스트 참고자료 내용을 모아 돌려준다. */
export function readReferencesAsText(wbId, pId, maxChars = 120000) {
  const p = getProblem(wbId, pId);
  const parts = [];
  let used = 0;
  for (const r of p.references) {
    if (!r.isText) {
      parts.push(`### ${r.name} (${r.file})\n[텍스트가 아닌 파일 - 내용 생략. 설명: ${r.description || '없음'}]`);
      continue;
    }
    let content = fs.readFileSync(referencePath(wbId, pId, r.file), 'utf8');
    const remain = maxChars - used;
    if (remain <= 0) {
      parts.push(`### ${r.name}\n[길이 제한으로 생략]`);
      continue;
    }
    if (content.length > remain) content = content.slice(0, remain) + '\n…[잘림]';
    used += content.length;
    parts.push(`### ${r.name} (${r.file})${r.description ? `\n설명: ${r.description}` : ''}\n\n${content}`);
  }
  return parts.join('\n\n');
}

// ---------- 답안 ----------
export function getAnswer(wbId, pId) {
  const a = readJson(answerFile(wbId, pId), null) || { html: '', status: 'draft', updatedAt: null };
  a.attachments = listAttachments(wbId, pId);
  return a;
}

export function saveAnswer(wbId, pId, { html, status }) {
  const prev = readJson(answerFile(wbId, pId), null) || {};
  const next = {
    ...prev,
    html: typeof html === 'string' ? html : prev.html || '',
    status: status || prev.status || 'draft',
    updatedAt: nowIso(),
  };
  writeJson(answerFile(wbId, pId), next);
  // 버전 백업 (최근 20개)
  const histDir = path.join(answerDir(wbId, pId), 'history');
  fs.mkdirSync(histDir, { recursive: true });
  const stamp = next.updatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(histDir, `${stamp}.html`), next.html, 'utf8');
  const files = fs.readdirSync(histDir).sort();
  while (files.length > 20) fs.rmSync(path.join(histDir, files.shift()));
  return getAnswer(wbId, pId);
}

export function answerStatusMap() {
  const out = {};
  if (!exists(DIRS.answers)) return out;
  for (const wb of fs.readdirSync(DIRS.answers)) {
    const wbPath = path.join(DIRS.answers, wb);
    if (!fs.statSync(wbPath).isDirectory()) continue;
    for (const p of fs.readdirSync(wbPath)) {
      const a = readJson(path.join(wbPath, p, 'answer.json'), null);
      if (!a) continue;
      (out[wb] ||= {})[p] = a.status || 'draft';
    }
  }
  return out;
}

export function listAnswerHistory(wbId, pId) {
  const histDir = path.join(answerDir(wbId, pId), 'history');
  if (!exists(histDir)) return [];
  return fs.readdirSync(histDir).sort().reverse().map((f) => ({ file: f, savedAt: f.replace('.html', '') }));
}

export function readAnswerHistory(wbId, pId, file) {
  const target = path.join(answerDir(wbId, pId), 'history', safeName(file));
  if (!exists(target)) throw httpError(404, '버전 파일이 없습니다.');
  return fs.readFileSync(target, 'utf8');
}

function listAttachments(wbId, pId) {
  const dir = attachmentsDir(wbId, pId);
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).map((file) => {
    const st = fs.statSync(path.join(dir, file));
    return { file, size: st.size, ext: path.extname(file).toLowerCase() };
  });
}

export function addAttachment(wbId, pId, fileName, buffer) {
  const dir = attachmentsDir(wbId, pId);
  fs.mkdirSync(dir, { recursive: true });
  let file = safeName(fileName, 'attachment');
  const base = path.parse(file);
  let n = 1;
  while (exists(path.join(dir, file))) file = `${base.name}(${n++})${base.ext}`;
  fs.writeFileSync(path.join(dir, file), buffer);
  return { file, size: buffer.length, ext: base.ext.toLowerCase() };
}

export function attachmentPath(wbId, pId, file) {
  const target = path.join(attachmentsDir(wbId, pId), safeName(file));
  if (!exists(target)) throw httpError(404, '첨부파일이 없습니다.');
  return target;
}

export function removeAttachment(wbId, pId, file) {
  const target = path.join(attachmentsDir(wbId, pId), safeName(file));
  if (exists(target)) fs.rmSync(target);
}

// ---------- 채팅 ----------
export function getChat(wbId, pId) {
  return readJson(chatFile(wbId, pId), null) || { messages: [] };
}

export function saveChat(wbId, pId, chat) {
  writeJson(chatFile(wbId, pId), { messages: chat.messages || [], updatedAt: nowIso() });
}

export function appendChat(wbId, pId, message) {
  const chat = getChat(wbId, pId);
  chat.messages.push({ ...message, ts: nowIso() });
  saveChat(wbId, pId, chat);
  return chat;
}

export function clearChat(wbId, pId) {
  saveChat(wbId, pId, { messages: [] });
}

// ---------- 가져오기 / 내보내기 ----------
/** 폴더(workbook.json 포함)를 새 문제집으로 복사해 가져온다. */
export function importWorkbookFromDir(srcDir) {
  const src = readJson(path.join(srcDir, 'workbook.json'), null);
  if (!src) throw httpError(400, '선택한 폴더에 workbook.json 이 없습니다.');
  const wb = createWorkbook({ ...src, source: src.source === 'sample' ? 'sample' : 'import' });
  for (const pId of src.problemOrder || []) {
    const pSrc = readJson(path.join(srcDir, 'problems', pId, 'problem.json'), null);
    if (!pSrc) continue;
    const p = createProblem(wb.id, pSrc);
    const refSrc = path.join(srcDir, 'problems', pId, 'references');
    if (exists(refSrc)) {
      // problem.json 에 적힌 순서를 우선하고, 목록에 없는 파일은 뒤에 붙인다
      const declared = (pSrc.references || []).map((r) => r.file);
      const files = [...declared.filter((f) => exists(path.join(refSrc, f))), ...fs.readdirSync(refSrc).filter((f) => !declared.includes(f))];
      for (const f of files) {
        const meta = (pSrc.references || []).find((r) => r.file === f) || {};
        addReferenceFile(wb.id, p.id, { fileName: f, buffer: fs.readFileSync(path.join(refSrc, f)), description: meta.description, name: meta.name });
      }
    }
  }
  return getWorkbook(wb.id);
}

export function exportWorkbookToDir(wbId, destDir) {
  const src = wbDir(wbId);
  if (!exists(src)) throw httpError(404, '문제집을 찾을 수 없습니다.');
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(src, destDir, { recursive: true });
  return destDir;
}
