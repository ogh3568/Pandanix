// 로컬(Windows) 파일 탐색/읽기/쓰기 API. 모든 경로는 "허용된 루트" 안에 있어야 한다.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { getAllowedRoots } from '../config.js';
import { resolveAllowed, httpError, IS_WINDOWS } from '../lib/paths.js';
import { TEXT_EXTS } from '../lib/store.js';

export const fsRouter = Router();

const MAX_TEXT_READ = 2 * 1024 * 1024; // 2MB

fsRouter.get('/fs/roots', (req, res) => {
  const roots = getAllowedRoots().map((p) => ({ path: p, exists: fs.existsSync(p), name: path.basename(p) || p }));
  res.json({ roots, home: process.env.USERPROFILE || process.env.HOME || '', platform: process.platform });
});

fsRouter.get('/fs/list', (req, res) => {
  const abs = resolveAllowed(req.query.path, getAllowedRoots());
  if (!fs.existsSync(abs)) throw httpError(404, '폴더가 없습니다: ' + abs);
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw httpError(400, '폴더가 아닙니다: ' + abs);
  const entries = [];
  for (const name of fs.readdirSync(abs)) {
    try {
      const full = path.join(abs, name);
      const s = fs.statSync(full);
      entries.push({ name, path: full, isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs, ext: path.extname(name).toLowerCase(), isText: TEXT_EXTS.has(path.extname(name).toLowerCase()) });
    } catch {
      /* 접근 불가 항목은 건너뜀 */
    }
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const parent = path.dirname(abs);
  const roots = getAllowedRoots();
  const canGoUp = roots.some((r) => path.resolve(parent) !== abs && isInsideAny(parent, roots));
  res.json({ path: abs, parent: canGoUp ? parent : null, entries });
});

function isInsideAny(p, roots) {
  try {
    resolveAllowed(p, roots);
    return true;
  } catch {
    return false;
  }
}

fsRouter.get('/fs/read', (req, res) => {
  const abs = resolveAllowed(req.query.path, getAllowedRoots());
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw httpError(404, '파일이 없습니다.');
  if (req.query.download) return res.download(abs);
  const ext = path.extname(abs).toLowerCase();
  const size = fs.statSync(abs).size;
  if (!TEXT_EXTS.has(ext)) return res.json({ path: abs, binary: true, size });
  if (size > MAX_TEXT_READ) throw httpError(413, '2MB 보다 큰 텍스트 파일은 미리보기할 수 없습니다.');
  res.json({ path: abs, content: fs.readFileSync(abs, 'utf8'), size });
});

/** 텍스트 파일 쓰기/생성 { path, content, overwrite? } */
fsRouter.post('/fs/write', (req, res) => {
  const { content = '', overwrite = true } = req.body || {};
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  if (fs.existsSync(abs) && !overwrite) throw httpError(409, '이미 파일이 있습니다.');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content), 'utf8');
  res.json({ ok: true, path: abs });
});

fsRouter.post('/fs/mkdir', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  fs.mkdirSync(abs, { recursive: true });
  res.json({ ok: true, path: abs });
});

fsRouter.post('/fs/delete', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  if (getAllowedRoots().some((r) => path.resolve(r) === abs)) throw httpError(400, '허용 루트 자체는 삭제할 수 없습니다.');
  if (!fs.existsSync(abs)) throw httpError(404, '대상이 없습니다.');
  fs.rmSync(abs, { recursive: true, force: true });
  res.json({ ok: true });
});

/** Windows 탐색기로 폴더 열기 */
fsRouter.post('/fs/open', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  if (!fs.existsSync(abs)) throw httpError(404, '대상이 없습니다.');
  const target = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  if (IS_WINDOWS) execFile('explorer.exe', [target]);
  else if (process.platform === 'darwin') execFile('open', [target]);
  else execFile('xdg-open', [target]);
  res.json({ ok: true, path: target });
});
