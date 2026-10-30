// Express 앱 구성. 라우트는 server/routes/*.js, 저장소는 server/lib/store.js.
import express from 'express';
import path from 'node:path';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import { PROJECT_ROOT, DIRS, IS_WINDOWS } from './lib/paths.js';
import { initConfigFiles, loadSettings } from './config.js';
import { seedIfEmpty } from './seed.js';
import { settingsRouter } from './routes/settings.js';
import { workbooksRouter } from './routes/workbooks.js';
import { answersRouter } from './routes/answers.js';
import { chatRouter } from './routes/chat.js';
import { generateRouter } from './routes/generate.js';
import { fsRouter } from './routes/fs.js';
import { doctorRouter } from './routes/doctor.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '80mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, version: process.env.npm_package_version || '0.1.0', dataDir: DIRS.data }));
  app.use('/api', settingsRouter);
  app.use('/api', workbooksRouter);
  app.use('/api', answersRouter);
  app.use('/api', chatRouter);
  app.use('/api', generateRouter);
  app.use('/api', fsRouter);
  app.use('/api', doctorRouter);

  // 문서 뷰어: /docs → public/docs-viewer.html, /docs/*.md → docs/ 폴더의 마크다운
  app.get('/api/docs', (req, res) => res.json({ files: listDocs() }));
  app.get(['/docs', '/docs/', '/docs/index.html'], (req, res) => res.sendFile(path.join(PROJECT_ROOT, 'public', 'docs-viewer.html')));
  app.use('/docs', express.static(path.join(PROJECT_ROOT, 'docs'), { index: false }));

  app.use(express.static(path.join(PROJECT_ROOT, 'public'), { index: 'index.html' }));

  // 404 (API)
  app.use('/api', (req, res) => res.status(404).json({ error: `API 없음: ${req.method} ${req.originalUrl}` }));

  // 오류 핸들러: 항상 JSON { error }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('[pandanix] 오류:', err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: err.message || String(err) });
  });
  return app;
}

export async function startServer() {
  initConfigFiles();
  seedIfEmpty();
  const settings = loadSettings();
  const port = Number(process.env.PORT || settings.port || 3210);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  const server = app.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Pandanix 실행 중: ${url}`);
    console.log(`  데이터 폴더: ${DIRS.data}`);
    console.log(`  종료: Ctrl+C\n`);
    if (process.argv.includes('--open') || process.env.PANDANIX_OPEN === '1') openBrowser(url);
  });
  // AI 응답은 길어질 수 있으므로 요청 타임아웃 해제
  server.requestTimeout = 0;
  server.headersTimeout = 60 * 60 * 1000;
  server.keepAliveTimeout = 65 * 1000;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  포트 ${port} 가 이미 사용 중입니다. 이미 실행 중이면 브라우저에서 http://localhost:${port} 를 여세요.`);
      console.error(`  다른 포트로 실행: set PORT=3300 && npm start   (또는 data/config/settings.json 의 port 수정)\n`);
      process.exit(1);
    }
    throw err;
  });
  return server;
}

/** docs/ 아래 마크다운 목록 (뷰어 내비게이션용). 파일명 숫자 접두사 순. */
function listDocs() {
  const docsDir = path.join(PROJECT_ROOT, 'docs');
  const out = [];
  const groupLabel = { '.': '시작하기', guide: '사용 가이드', dev: '개발/유지보수' };
  const walk = (rel) => {
    const abs = path.join(docsDir, rel);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs).sort()) {
      const r = rel === '.' ? name : `${rel}/${name}`;
      const st = fs.statSync(path.join(docsDir, r));
      if (st.isDirectory()) walk(r);
      else if (name.endsWith('.md')) {
        const first = fs.readFileSync(path.join(docsDir, r), 'utf8').split('\n').find((l) => l.startsWith('# ')) || name;
        out.push({ path: r, title: first.replace(/^#\s*/, ''), group: groupLabel[rel.split('/')[0]] || rel.split('/')[0] });
      }
    }
  };
  walk('.');
  const order = ['시작하기', '사용 가이드', '개발/유지보수'];
  out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.path.localeCompare(b.path));
  return out;
}

function openBrowser(url) {
  if (IS_WINDOWS) exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}
