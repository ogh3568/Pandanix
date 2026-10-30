// Express 앱 구성. 라우트는 server/routes/*.js, 저장소는 server/lib/store.js.
import express from 'express';
import path from 'node:path';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import { PROJECT_ROOT, DIRS, IS_WINDOWS } from './lib/paths.js';
import { initConfigFiles, loadSettings } from './config.js';
import { seedIfEmpty } from './seed.js';
import { installFileLogging, LOG_FILE } from './lib/log.js';
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
  // DNS rebinding 방지: 로컬 전용으로 띄웠을 때 Host 헤더가 localhost 계열이 아니면 거부
  app.use(hostGuard);
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
    const { status, message } = describeError(err);
    if (status >= 500) console.error('[pandanix] 오류:', err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: message });
  });
  return app;
}

/** 시스템/파서 오류를 사용자가 읽을 수 있는 한국어 문장으로 바꾼다 */
function describeError(err) {
  if (err.status && err.message && !err.code) return { status: err.status, message: err.message };
  if (err.type === 'entity.too.large') return { status: 413, message: '요청이 너무 큽니다. 파일은 60MB 이하로 올리세요.' };
  if (err.type === 'entity.parse.failed') return { status: 400, message: '요청 본문이 올바른 JSON 이 아닙니다.' };
  const byCode = {
    ENOENT: [404, '파일이나 폴더가 없습니다.'],
    EEXIST: [409, '같은 이름의 파일이나 폴더가 이미 있습니다.'],
    EISDIR: [400, '파일이 와야 할 자리에 폴더가 있습니다.'],
    ENOTDIR: [400, '폴더가 와야 할 자리에 파일이 있습니다.'],
    ENAMETOOLONG: [400, '파일 이름이 너무 깁니다.'],
    EPERM: [423, '다른 프로그램이 파일을 사용 중이거나 권한이 없습니다. 잠시 후 다시 시도하세요.'],
    EBUSY: [423, '다른 프로그램이 파일을 사용 중입니다. 잠시 후 다시 시도하세요.'],
    EACCES: [403, '파일 접근 권한이 없습니다.'],
    ENOSPC: [507, '디스크 공간이 부족합니다.'],
  };
  if (err.code && byCode[err.code]) return { status: err.status || byCode[err.code][0], message: `${byCode[err.code][1]} (${err.code}${err.path ? ': ' + err.path : ''})` };
  return { status: err.status || 500, message: err.message || String(err) };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function hostGuard(req, res, next) {
  if (process.env.HOST && process.env.HOST !== '127.0.0.1' && process.env.HOST !== 'localhost') return next(); // 사용자가 외부 공개를 선택한 경우
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!host || LOCAL_HOSTS.has(host)) return next();
  res.status(403).json({ error: `허용되지 않은 Host 헤더입니다: ${host}. 브라우저에서 http://localhost:<포트> 로 접속하세요.` });
}

export async function startServer() {
  initConfigFiles();
  installFileLogging();
  installCrashGuards();
  seedIfEmpty();
  const settings = loadSettings();
  const port = Number(process.env.PORT || settings.port || 3210);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  const server = app.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Pandanix 실행 중: ${url}`);
    console.log(`  데이터 폴더: ${DIRS.data}`);
    console.log(`  로그 파일: ${LOG_FILE}`);
    console.log(`  종료: Ctrl+C\n`);
    if (process.argv.includes('--open') || process.env.PANDANIX_OPEN === '1') openBrowser(url);
  });
  tuneTimeouts(server);
  // Windows 일부 브라우저는 localhost 를 ::1 로 먼저 풀기 때문에 IPv6 루프백에도 같이 연다 (실패해도 무시)
  if (host === '127.0.0.1') {
    try {
      const v6 = app.listen(port, '::1');
      v6.on('error', () => {});
      tuneTimeouts(v6);
    } catch {
      /* IPv6 미지원 환경 */
    }
  }
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

/**
 * 타임아웃 정책: AI 응답·문제집 생성은 수 분이 걸릴 수 있으므로 요청/헤더 타임아웃을 사실상 해제한다.
 * SSE 는 15초마다 하트비트를 보내 프록시·브라우저가 연결을 끊지 않게 한다 (server/lib/sse.js).
 * 프로바이더 호출은 "무응답 감시"(routes/chat.js, generate.js) 로 5분간 아무 토큰도 없으면 끊고 오류를 알린다.
 */
function tuneTimeouts(server) {
  server.requestTimeout = 0; // 요청 전체 시간 제한 없음
  server.headersTimeout = 60 * 60 * 1000; // keepAliveTimeout 보다 커야 한다
  server.keepAliveTimeout = 65 * 1000;
  server.timeout = 0; // 소켓 유휴 제한 없음 (SSE 장시간 대기)
}

/**
 * 예상치 못한 예외/거부로 서버(그리고 사용자가 보는 화면)가 꺼지지 않게 한다.
 * 로컬 단일 사용자 앱이므로 "로그 남기고 계속" 이 사용자에게 더 낫다. start.bat 은 그래도 죽으면 자동 재시작한다.
 */
function installCrashGuards() {
  process.on('unhandledRejection', (reason) => {
    console.error('[pandanix] 처리되지 않은 Promise 거부 (서버는 계속 실행):', reason);
  });
  process.on('uncaughtException', (err) => {
    if (err && err.code === 'EADDRINUSE') throw err; // 기동 실패는 그대로 알린다
    console.error('[pandanix] 처리되지 않은 예외 (서버는 계속 실행):', err);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`[pandanix] ${sig} 수신, 종료합니다.`);
      process.exit(0);
    });
  }
}

function openBrowser(url) {
  if (IS_WINDOWS) exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}
