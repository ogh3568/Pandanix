import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../lib/store.js';
import { htmlToMarkdown, htmlToText, countChars } from '../lib/html2md.js';
import { httpError, resolveAllowed, safeName } from '../lib/paths.js';
import { getAllowedRoots } from '../config.js';

export const answersRouter = Router();

/** 모든 답안의 상태 맵 { [wbId]: { [pId]: 'draft'|'done' } } - 사이드바 상태 점 표시용 */
answersRouter.get('/answers-status', (req, res) => res.json(store.answerStatusMap()));

answersRouter.get('/answers/:wb/:p', (req, res) => res.json(store.getAnswer(req.params.wb, req.params.p)));

answersRouter.put('/answers/:wb/:p', (req, res) => {
  const { html, status } = req.body || {};
  const saved = store.saveAnswer(req.params.wb, req.params.p, { html, status });
  res.json({ ...saved, chars: countChars(htmlToText(saved.html)) });
});

answersRouter.get('/answers/:wb/:p/history', (req, res) => res.json({ history: store.listAnswerHistory(req.params.wb, req.params.p) }));
answersRouter.get('/answers/:wb/:p/history/:file', (req, res) => res.json({ html: store.readAnswerHistory(req.params.wb, req.params.p, req.params.file) }));

/** 첨부 업로드 { fileName, contentBase64 } */
answersRouter.post('/answers/:wb/:p/attachments', (req, res) => {
  const { fileName, contentBase64 } = req.body || {};
  if (!fileName || !contentBase64) throw httpError(400, 'fileName, contentBase64 가 필요합니다.');
  const info = store.addAttachment(req.params.wb, req.params.p, fileName, Buffer.from(contentBase64, 'base64'));
  res.status(201).json({ ...info, url: `/api/answers/${req.params.wb}/${req.params.p}/attachments/${encodeURIComponent(info.file)}` });
});

answersRouter.get('/answers/:wb/:p/attachments/:file', (req, res) => {
  const file = store.attachmentPath(req.params.wb, req.params.p, req.params.file);
  if (req.query.download) return res.download(file);
  res.sendFile(file);
});

answersRouter.delete('/answers/:wb/:p/attachments/:file', (req, res) => {
  store.removeAttachment(req.params.wb, req.params.p, req.params.file);
  res.json({ ok: true });
});

/**
 * 내보내기: { format: html|md|txt, path?: 저장 폴더(허용 루트 안), fileName? }
 * path 가 없으면 파일 내용을 응답으로 돌려준다(브라우저 다운로드용).
 */
answersRouter.post('/answers/:wb/:p/export', (req, res) => {
  const { format = 'md', path: dir, fileName } = req.body || {};
  const answer = store.getAnswer(req.params.wb, req.params.p);
  const problem = store.getProblem(req.params.wb, req.params.p);
  const { content, ext, mime } = render(answer.html, format, problem);
  const name = safeName(fileName || `${problem.title}.${ext}`);
  if (!dir) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return res.send(content);
  }
  const abs = resolveAllowed(dir, getAllowedRoots());
  fs.mkdirSync(abs, { recursive: true });
  const target = path.join(abs, name);
  fs.writeFileSync(target, content, 'utf8');
  res.json({ ok: true, path: target });
});

function render(html, format, problem) {
  if (format === 'html') {
    const doc = `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(problem.title)}</title>
<style>body{font-family:'Malgun Gothic',system-ui,sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 16px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}img{max-width:100%}</style></head>
<body><h1>${escapeHtml(problem.title)}</h1>\n${html}\n</body></html>`;
    return { content: doc, ext: 'html', mime: 'text/html; charset=utf-8' };
  }
  if (format === 'txt') return { content: htmlToText(html), ext: 'txt', mime: 'text/plain; charset=utf-8' };
  return { content: `# ${problem.title}\n\n${htmlToMarkdown(html)}\n`, ext: 'md', mime: 'text/markdown; charset=utf-8' };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
