import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import * as store from '../lib/store.js';
import { wrap } from '../lib/async.js';
import { httpError, resolveAllowed, safeName, isInside, readTextSmart } from '../lib/paths.js';
import { sendUserFile } from '../lib/sendfile.js';
import { getAllowedRoots } from '../config.js';
import { listLibrary, installLibraryWorkbook } from '../seed.js';

export const workbooksRouter = Router();

workbooksRouter.get('/workbooks', (req, res) => res.json({ workbooks: store.listWorkbooks() }));
workbooksRouter.post('/workbooks', (req, res) => res.status(201).json(store.createWorkbook(req.body || {})));
workbooksRouter.get('/workbooks/:wb', (req, res) => res.json(store.getWorkbook(req.params.wb)));
workbooksRouter.put('/workbooks/:wb', (req, res) => res.json(store.updateWorkbook(req.params.wb, req.body || {})));
workbooksRouter.delete('/workbooks/:wb', (req, res) => {
  store.deleteWorkbook(req.params.wb);
  res.json({ ok: true });
});

workbooksRouter.post('/workbooks/:wb/problems', (req, res) => res.status(201).json(store.createProblem(req.params.wb, req.body || {})));
workbooksRouter.get('/workbooks/:wb/problems/:p', (req, res) => res.json(store.getProblem(req.params.wb, req.params.p)));
workbooksRouter.put('/workbooks/:wb/problems/:p', (req, res) => res.json(store.updateProblem(req.params.wb, req.params.p, req.body || {})));
workbooksRouter.delete('/workbooks/:wb/problems/:p', (req, res) => {
  store.deleteProblem(req.params.wb, req.params.p);
  res.json({ ok: true });
});

/** 참고자료 업로드: { fileName, contentBase64 | content, description, name } */
workbooksRouter.post('/workbooks/:wb/problems/:p/references', (req, res) => {
  const { fileName, contentBase64, content, description, name } = req.body || {};
  if (!fileName) throw httpError(400, 'fileName 이 필요합니다.');
  const buffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : Buffer.from(String(content ?? ''), 'utf8');
  res.status(201).json(store.addReferenceFile(req.params.wb, req.params.p, { fileName, buffer, description, name }));
});

/** 로컬 파일을 참고자료로 복사: { path, description } */
workbooksRouter.post('/workbooks/:wb/problems/:p/references/from-path', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  if (!fs.statSync(abs).isFile()) throw httpError(400, '파일이 아닙니다.');
  res.status(201).json(
    store.addReferenceFile(req.params.wb, req.params.p, { fileName: path.basename(abs), buffer: fs.readFileSync(abs), description: req.body?.description || '' }),
  );
});

workbooksRouter.get('/workbooks/:wb/problems/:p/references/:file', (req, res) => {
  const file = store.referencePath(req.params.wb, req.params.p, req.params.file);
  if (req.query.download) return res.download(file);
  // ?text=1 : 인코딩(UTF-8/EUC-KR)을 판별해 텍스트로 돌려준다 (미리보기용)
  if (req.query.text) {
    res.type('text/plain; charset=utf-8');
    return res.send(readTextSmart(file));
  }
  sendUserFile(res, file);
});

workbooksRouter.delete('/workbooks/:wb/problems/:p/references/:file', (req, res) => {
  res.json(store.removeReferenceFile(req.params.wb, req.params.p, req.params.file));
});

/** 내장 문제집 라이브러리 */
workbooksRouter.get('/library', (req, res) => res.json({ library: listLibrary() }));
workbooksRouter.post('/library/:slug/install', (req, res) => res.status(201).json(installLibraryWorkbook(req.params.slug, { force: Boolean(req.body?.force) })));

/** 폴더에서 문제집 가져오기 { path } */
workbooksRouter.post('/workbooks/import', (req, res) => {
  const abs = resolveAllowed(req.body?.path, getAllowedRoots());
  res.status(201).json(store.importWorkbookFromDir(abs));
});

/** 문제집을 폴더로 내보내기 { path } → <path>/<문제집제목>/ */
workbooksRouter.post(
  '/workbooks/:wb/export',
  wrap(async (req, res) => {
    const base = resolveAllowed(req.body?.path, getAllowedRoots());
    const wb = store.getWorkbook(req.params.wb);
    const folder = safeName(wb.title, wb.id);
    const dest = path.join(base, folder === '.' || folder === '..' ? wb.id : folder);
    if (!isInside(base, dest) || path.resolve(dest) === path.resolve(base)) throw httpError(400, '내보내기 폴더 이름이 잘못되었습니다.');
    store.exportWorkbookToDir(wb.id, dest);
    res.json({ ok: true, path: dest });
  }),
);

