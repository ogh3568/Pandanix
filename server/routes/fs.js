// 로컬(Windows) 파일 탐색/읽기/쓰기 API. 모든 경로는 "허용된 루트" 안에 있어야 한다.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { getAllowedRoots } from '../config.js';
import { resolveAllowed, httpError, IS_WINDOWS, samePath, DIRS, isInside, readTextSmart } from '../lib/paths.js';
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
  res.json({ path: abs, content: readTextSmart(abs), size });
});

/** 텍스트 파일 쓰기/생성 { path, content, overwrite? } */
fsRouter.post('/fs/write', (req, res) => {
  const { content = '' } = req.body || {};
  const overwrite = req.body?.overwrite === undefined ? true : req.body.overwrite === true || req.body.overwrite === 'true';
  if (typeof content !== 'string') throw httpError(400, 'content 는 문자열이어야 합니다.');
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  assertNotSystemPath(abs);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw httpError(400, '같은 이름의 폴더가 있습니다.');
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
  if (getAllowedRoots().some((r) => samePath(r, abs))) throw httpError(400, '허용 루트 자체는 삭제할 수 없습니다.');
  assertNotSystemPath(abs);
  if (!fs.existsSync(abs)) throw httpError(404, '대상이 없습니다.');
  fs.rmSync(abs, { recursive: true, force: true });
  res.json({ ok: true });
});

/** data/ 안의 앱 내부 폴더(workbooks, answers, config, tmp 자체)는 탐색기로 쓰거나 지울 수 없다. 그 안의 파일은 가능. */
function assertNotSystemPath(abs) {
  const system = [DIRS.data, DIRS.workbooks, DIRS.answers, DIRS.tmp];
  if (system.some((d) => samePath(d, abs))) throw httpError(400, '앱 내부 폴더는 파일 탐색기에서 지우거나 덮어쓸 수 없습니다. 문제집은 목록의 삭제 메뉴를 사용하세요.');
  if (isInside(DIRS.config, abs)) throw httpError(403, '설정·API 키 폴더는 접근할 수 없습니다.');
}

/** Windows 탐색기로 폴더 열기 */
fsRouter.post('/fs/open', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  if (!fs.existsSync(abs)) throw httpError(404, '대상이 없습니다.');
  const target = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  const [cmd, args] = IS_WINDOWS ? ['explorer.exe', [target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  execFile(cmd, args, (err) => {
    if (res.headersSent) return;
    // explorer.exe 는 정상 실행 후에도 종료 코드 1 을 돌려주므로 ENOENT(명령 없음)만 오류로 본다
    if (err && err.code === 'ENOENT') return res.status(500).json({ error: `파일 탐색기를 열 수 없습니다 (${cmd} 없음). 경로: ${target}` });
    res.json({ ok: true, path: target });
  });
});
