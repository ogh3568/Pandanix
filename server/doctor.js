// 환경 점검(doctor). CLI(server/doctor-cli.js)와 API(/api/doctor) 양쪽에서 사용한다.
// 각 검사는 { id, name, status: 'ok'|'warn'|'fail', detail, fix } 를 돌려준다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DIRS, FILES, PROJECT_ROOT, IS_WINDOWS, readJson, exists } from './lib/paths.js';
import { PROVIDERS, loadSettings, loadCredentials, getAllowedRoots } from './config.js';
import { getProvider } from './providers/index.js';

const require = createRequire(import.meta.url);
const MIN_NODE_MAJOR = 22; // openai SDK 가 Node 22 이상을 요구한다 (package.json engines 와 함께 갱신)

/**
 * @param {{live?: boolean, serverRunning?: boolean}} opts
 *  live: API 키로 실제 모델 목록 호출까지 수행 (네트워크 필요)
 *  serverRunning: 서버 내부에서 호출될 때 true (포트 검사를 "사용 중(이 앱)" 으로 표시)
 */
export async function runDoctor({ live = false, serverRunning = false } = {}) {
  const checks = [];
  const add = (c) => checks.push(c);

  // 1. Node 버전
  const major = Number(process.versions.node.split('.')[0]);
  add({
    id: 'node',
    name: 'Node.js 버전',
    status: major >= MIN_NODE_MAJOR ? 'ok' : 'fail',
    detail: `v${process.versions.node}`,
    fix: major >= MIN_NODE_MAJOR ? '' : `Node.js ${MIN_NODE_MAJOR} 이상을 https://nodejs.org 에서 설치하세요 (LTS 권장).`,
  });

  // 2. OS
  add({
    id: 'os',
    name: '운영체제',
    status: IS_WINDOWS ? 'ok' : 'warn',
    detail: `${process.platform} ${process.arch}`,
    fix: IS_WINDOWS ? '' : '이 앱은 Windows 를 기준으로 만들어졌습니다. 다른 OS 에서도 동작하지만 탐색기 열기 등 일부 기능이 다를 수 있습니다.',
  });

  // 3. 의존성
  const pkg = readJson(path.join(PROJECT_ROOT, 'package.json'), {});
  const missing = Object.keys(pkg.dependencies || {}).filter((d) => {
    try {
      require.resolve(d + '/package.json', { paths: [PROJECT_ROOT] });
      return false;
    } catch {
      try {
        return !exists(path.join(PROJECT_ROOT, 'node_modules', d));
      } catch {
        return true;
      }
    }
  });
  add({
    id: 'deps',
    name: 'npm 의존성 설치',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `누락: ${missing.join(', ')}` : `${Object.keys(pkg.dependencies || {}).length}개 모두 설치됨`,
    fix: missing.length ? '프로젝트 폴더에서 `npm install` 을 실행하세요.' : '',
  });

  // 4. 데이터 폴더 쓰기 가능
  try {
    for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
    const probe = path.join(DIRS.tmp, `.probe-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    add({ id: 'data', name: '데이터 폴더 쓰기', status: 'ok', detail: DIRS.data, fix: '' });
  } catch (err) {
    add({ id: 'data', name: '데이터 폴더 쓰기', status: 'fail', detail: `${DIRS.data} - ${err.message}`, fix: '폴더 권한을 확인하거나 환경변수 PANDANIX_DATA_DIR 로 다른 위치를 지정하세요.' });
  }

  // 5. 설정 파일
  for (const [id, file, name] of [
    ['settings', FILES.settings, '설정 파일 (settings.json)'],
    ['credentials', FILES.credentials, '자격증명 파일 (credentials.json)'],
  ]) {
    if (!exists(file)) {
      add({ id, name, status: 'warn', detail: `${file} 없음`, fix: '서버를 한 번 실행하면 자동 생성됩니다 (npm start).' });
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      add({ id, name, status: 'ok', detail: file, fix: '' });
    } catch (err) {
      add({ id, name, status: 'fail', detail: `JSON 문법 오류: ${err.message}`, fix: `${file} 을 열어 JSON 문법을 고치거나, 파일을 삭제한 뒤 서버를 다시 시작하세요.` });
    }
  }

  // 6. .gitignore 에 credentials 포함 여부
  const gi = exists(path.join(PROJECT_ROOT, '.gitignore')) ? fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8') : '';
  add({
    id: 'gitignore',
    name: 'API 키 파일 git 제외',
    status: /credentials\.json/.test(gi) ? 'ok' : 'warn',
    detail: /credentials\.json/.test(gi) ? '.gitignore 에 credentials.json 포함' : '.gitignore 에 credentials.json 이 없음',
    fix: /credentials\.json/.test(gi) ? '' : '.gitignore 에 `data/config/credentials.json` 줄을 추가하세요.',
  });

  // 7. 프로바이더 키
  const creds = loadCredentials();
  const settings = loadSettings();
  let anyKey = false;
  for (const [name, def] of Object.entries(PROVIDERS)) {
    const c = creds[name] || {};
    const has = Boolean(c.apiKey);
    if (has) anyKey = true;
    const isDefault = settings.defaultProvider === name;
    const optional = Boolean(def.keyOptional);
    add({
      id: `key:${name}`,
      name: `API 키 - ${def.label}${isDefault ? ' (기본)' : ''}`,
      status: has ? 'ok' : isDefault ? 'fail' : optional ? 'ok' : 'warn',
      detail: has ? `설정됨 (${c._source === 'env' ? '환경변수 ' + def.envKey : 'credentials.json'})` : optional ? '선택 사항 (로컬 서버용)' : '미설정',
      fix: has || optional ? '' : `설정 화면에서 키를 입력하거나 환경변수 ${def.envKey} 를 지정하세요.${def.keyUrl ? ` 발급: ${def.keyUrl}` : ''}`,
    });
  }
  if (!anyKey) add({ id: 'anykey', name: 'AI 사용 가능 여부', status: 'fail', detail: '설정된 API 키가 하나도 없습니다.', fix: '최소 한 개 프로바이더의 키를 설정하세요. docs/guide/02-API-키-설정.md 참고' });

  // 8. 기본 프로바이더/모델
  const dp = settings.defaultProvider;
  const dm = settings.models?.[dp];
  add({
    id: 'defaultModel',
    name: '기본 프로바이더/모델',
    status: PROVIDERS[dp] && dm ? 'ok' : 'fail',
    detail: `${dp} / ${dm || '(모델 없음)'}`,
    fix: PROVIDERS[dp] && dm ? '' : '설정 화면에서 기본 프로바이더와 모델을 지정하세요.',
  });

  // 9. 허용 루트
  for (const root of getAllowedRoots(settings)) {
    const ok = exists(root) && fs.statSync(root).isDirectory();
    add({ id: `root:${root}`, name: '파일 접근 허용 폴더', status: ok ? 'ok' : 'warn', detail: root, fix: ok ? '' : '폴더가 없습니다. 설정에서 목록을 수정하세요.' });
  }

  // 10. 포트
  const port = Number(process.env.PORT || settings.port || 3210);
  if (serverRunning) add({ id: 'port', name: `포트 ${port}`, status: 'ok', detail: '이 앱이 사용 중', fix: '' });
  else {
    const free = await isPortFree(port);
    add({ id: 'port', name: `포트 ${port}`, status: free ? 'ok' : 'warn', detail: free ? '사용 가능' : '이미 사용 중 (앱이 이미 실행 중이거나 다른 프로그램이 점유)', fix: free ? '' : '이미 실행 중이면 브라우저에서 http://localhost:' + port + ' 를 여세요. 아니면 settings.json 의 port 를 바꾸세요.' });
  }

  // 11. 문제집 무결성
  let wbCount = 0;
  const broken = [];
  if (exists(DIRS.workbooks)) {
    for (const name of fs.readdirSync(DIRS.workbooks)) {
      const f = path.join(DIRS.workbooks, name, 'workbook.json');
      if (!exists(f)) {
        broken.push(name);
        continue;
      }
      try {
        JSON.parse(fs.readFileSync(f, 'utf8'));
        wbCount++;
      } catch {
        broken.push(name);
      }
    }
  }
  add({ id: 'workbooks', name: '문제집 데이터', status: broken.length ? 'warn' : 'ok', detail: `${wbCount}개 정상${broken.length ? `, 손상: ${broken.join(', ')}` : ''}`, fix: broken.length ? `data/workbooks/ 아래 손상된 폴더의 workbook.json 을 고치거나 폴더를 삭제하세요.` : '' });

  // 12. 실시간 API 테스트
  if (live) {
    for (const [name, def] of Object.entries(PROVIDERS)) {
      const c = creds[name] || {};
      if (!c.apiKey && !def.keyOptional) continue;
      if (def.keyOptional && !c.baseUrl) continue;
      try {
        const r = await withTimeout(getProvider(name).ping(), 20000);
        add({ id: `live:${name}`, name: `연결 테스트 - ${def.label}`, status: 'ok', detail: r.detail, fix: '' });
      } catch (err) {
        add({ id: `live:${name}`, name: `연결 테스트 - ${def.label}`, status: def.keyOptional ? 'warn' : 'fail', detail: err.message, fix: '키, Base URL, 네트워크(프록시/방화벽)를 확인하세요.' });
      }
    }
  }

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
  return { checks, summary, live, ranAt: new Date().toISOString() };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`시간 초과 (${ms / 1000}초)`)), ms))]);
}
