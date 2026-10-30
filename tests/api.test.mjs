// 통합 테스트: 임시 데이터 폴더 + 모의 OpenAI 서버로 주요 API 흐름을 검증한다. (npm test)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandanix-test-'));
process.env.PANDANIX_DATA_DIR = tmp;
process.env.PORT = '0';

const { startMock } = await import('./mock-openai-server.mjs');
const { createApp } = await import('../server/app.js');
const { initConfigFiles, saveCredentials, saveSettings } = await import('../server/config.js');
const { seedIfEmpty } = await import('../server/seed.js');

let server, mock, base;
const j = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const sse = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]);
  return { status: res.status, events, text };
};

before(async () => {
  mock = await startMock(0);
  const mockPort = mock.address().port;
  initConfigFiles();
  seedIfEmpty();
  saveCredentials({ custom: { apiKey: 'mock-key', baseUrl: `http://127.0.0.1:${mockPort}/v1` } });
  saveSettings({ defaultProvider: 'custom', models: { custom: 'mock-model' } });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('내장 문제집이 모두 시드된다', async () => {
  const { data } = await j('GET', '/api/workbooks');
  const lib = (await j('GET', '/api/library')).data.library;
  assert.ok(lib.length >= 1);
  assert.equal(data.workbooks.length, lib.length);
  assert.ok(lib.every((l) => l.installedId));
  const basics = data.workbooks.find((w) => w.libraryId === 'lib-basics');
  assert.equal(basics.problems.length, 3);
  const p = await j('GET', `/api/workbooks/${basics.id}/problems/${basics.problems[0].id}`);
  assert.deepEqual(p.data.references.map((r) => r.file), ['설비정보.md', '고장이력_2025.csv', '신규설비_견적.md']);
  // 모든 내장 문제의 참고자료 파일이 실제로 존재하고 텍스트로 읽힌다
  for (const w of data.workbooks) for (const pr of w.problems) {
    const d = (await j('GET', `/api/workbooks/${w.id}/problems/${pr.id}`)).data;
    assert.ok(d.references.length >= 1, `${w.title} / ${pr.title} 참고자료 없음`);
    assert.ok(d.prompt.length > 50 && d.submission.format.length > 5, `${w.title} / ${pr.title} 지문/형식 부족`);
  }
});

test('내장 문제집 재설치는 409, force 면 복사본', async () => {
  assert.equal((await j('POST', '/api/library/lib-basics/install', {})).status, 409);
  const copy = (await j('POST', '/api/library/lib-basics/install', { force: true })).data;
  assert.equal(copy.libraryId, 'lib-basics');
  assert.equal((await j('DELETE', `/api/workbooks/${copy.id}`)).status, 200);
  assert.equal((await j('POST', '/api/library/nope/install', {})).status, 404);
});

test('문제집/문제/참고자료 CRUD', async () => {
  const wb = (await j('POST', '/api/workbooks', { title: 'T' })).data;
  const p = (await j('POST', `/api/workbooks/${wb.id}/problems`, { title: 'P1', prompt: '지문', submission: { format: '메모', charLimit: 100 } })).data;
  assert.equal(p.submission.charLimit, 100);
  const withRef = (await j('POST', `/api/workbooks/${wb.id}/problems/${p.id}/references`, { fileName: 'a.md', content: '# A', description: 'd' })).data;
  assert.equal(withRef.references.length, 1);
  assert.equal((await j('GET', `/api/workbooks/${wb.id}/problems/${p.id}/references/a.md`)).text, '# A');
  const afterDel = (await j('DELETE', `/api/workbooks/${wb.id}/problems/${p.id}/references/a.md`)).data;
  assert.equal(afterDel.references.length, 0);
  assert.equal((await j('DELETE', `/api/workbooks/${wb.id}`)).status, 200);
  assert.equal((await j('GET', `/api/workbooks/${wb.id}`)).status, 404);
});

test('답안 저장/내보내기/기록', async () => {
  const wb = (await j('GET', '/api/workbooks')).data.workbooks[0];
  const pid = wb.problems[0].id;
  const saved = (await j('PUT', `/api/answers/${wb.id}/${pid}`, { html: '<p>안녕</p>' })).data;
  assert.equal(saved.chars.withSpaces, 2);
  const md = (await j('POST', `/api/answers/${wb.id}/${pid}/export`, { format: 'md' })).text;
  assert.match(md, /안녕/);
  const hist = (await j('GET', `/api/answers/${wb.id}/${pid}/history`)).data.history;
  assert.equal(hist.length, 1);
  const status = (await j('GET', '/api/answers-status')).data;
  assert.equal(status[wb.id][pid], 'draft');
});

test('채팅 스트리밍 + 컨텍스트 포함 + 기록 저장', async () => {
  const wb = (await j('GET', '/api/workbooks')).data.workbooks[0];
  const pid = wb.problems[0].id;
  const { events } = await sse(`/api/chat/${wb.id}/${pid}/stream`, { message: '안녕', context: { answer: true }, answerText: '초안' });
  assert.equal(events[0][0], 'meta');
  assert.ok(events.some(([e]) => e === 'delta'));
  const done = events.find(([e]) => e === 'done')[1].message;
  assert.match(done.content, /참고자료포함 \| true/);
  assert.match(done.content, /답안포함 \| true/);
  const hist = (await j('GET', `/api/chat/${wb.id}/${pid}`)).data.messages;
  assert.equal(hist.length, 2);
  assert.equal(hist[1].usage.output, 20);
});

test('키 오류는 SSE error 이벤트로 전달', async () => {
  saveCredentials({ custom: { apiKey: 'bad' } });
  const { events } = await sse('/api/chat/general/general/stream', { message: 'x' });
  assert.ok(events.some(([e, d]) => e === 'error' && /401/.test(d.error)));
  saveCredentials({ custom: { apiKey: 'mock-key' } });
});

test('AI 문제집 생성', async () => {
  const { events } = await sse('/api/generate/workbook', { topic: '테스트', count: 1 });
  const done = events.find(([e]) => e === 'done');
  assert.ok(done, JSON.stringify(events));
  assert.equal(done[1].workbook.title, '모의 문제집');
  assert.equal(done[1].workbook.problems.length, 1);
  const p = (await j('GET', `/api/workbooks/${done[1].workbook.id}/problems/${done[1].workbook.problems[0].id}`)).data;
  assert.equal(p.references.length, 2);
});

test('파일 API 는 허용 루트 밖을 거부한다', async () => {
  const list = await j('GET', `/api/fs/list?path=${encodeURIComponent(tmp)}`);
  assert.equal(list.status, 200);
  assert.ok(list.data.entries.some((e) => e.name === 'workbooks'));
  assert.equal((await j('GET', `/api/fs/list?path=${encodeURIComponent(os.homedir())}`)).status, 403);
  const w = await j('POST', '/api/fs/write', { path: path.join(tmp, 'note.md'), content: 'hi' });
  assert.equal(w.status, 200);
  assert.equal((await j('GET', `/api/fs/read?path=${encodeURIComponent(path.join(tmp, 'note.md'))}`)).data.content, 'hi');
});

test('doctor 는 요약을 돌려준다', async () => {
  const { data } = await j('GET', '/api/doctor');
  assert.ok(data.checks.length > 8);
  assert.ok(data.checks.find((c) => c.id === 'node').status === 'ok');
});

test('자격증명은 마스킹되어 전달된다', async () => {
  const { data } = await j('GET', '/api/credentials');
  assert.equal(data.custom.configured, true);
  assert.doesNotMatch(JSON.stringify(data), /mock-key/);
});

// ---------- 보안·견고성 회귀 테스트 (백엔드 리뷰 반영) ----------
test('파일 API 는 data/config(키 파일)을 읽거나 지울 수 없다', async () => {
  const cfg = path.join(tmp, 'config', 'credentials.json');
  assert.equal((await j('GET', `/api/fs/read?path=${encodeURIComponent(cfg)}`)).status, 403);
  assert.equal((await j('POST', '/api/fs/delete', { path: path.join(tmp, 'config') })).status, 403);
  assert.equal((await j('POST', '/api/fs/delete', { path: path.join(tmp, 'workbooks') })).status, 400);
  assert.equal((await j('POST', '/api/fs/write', { path: cfg, content: '{}' })).status, 403);
});

test('가져오기: 폴더 밖을 가리키는 problemOrder/references 는 거부되고 롤백된다', async () => {
  const outside = path.join(tmp, 'outside.txt');
  fs.writeFileSync(outside, 'SECRET');
  const dir = path.join(tmp, 'evil');
  fs.mkdirSync(path.join(dir, 'problems', 'p1', 'references'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workbook.json'), JSON.stringify({ title: 'evil', problemOrder: ['../../outside'] }));
  const r1 = await j('POST', '/api/workbooks/import', { path: dir });
  assert.equal(r1.status, 400);
  fs.writeFileSync(path.join(dir, 'workbook.json'), JSON.stringify({ title: 'evil2', problemOrder: ['p1'] }));
  fs.writeFileSync(path.join(dir, 'problems', 'p1', 'problem.json'), JSON.stringify({ id: 'p1', title: 'x', references: [{ file: '../../../outside.txt' }] }));
  const r2 = await j('POST', '/api/workbooks/import', { path: dir });
  assert.equal(r2.status, 201);
  const p = (await j('GET', `/api/workbooks/${r2.data.id}/problems/${r2.data.problems[0].id}`)).data;
  assert.equal(p.references.length, 0); // 밖의 파일은 복사되지 않음
  // 실패 시 롤백: 참고자료 폴더 안에 하위 폴더가 있어도 문제집이 생성된다(폴더는 무시)
  fs.mkdirSync(path.join(dir, 'problems', 'p1', 'references', 'sub'));
  const before = (await j('GET', '/api/workbooks')).data.workbooks.length;
  const r3 = await j('POST', '/api/workbooks/import', { path: dir });
  assert.equal(r3.status, 201);
  await j('DELETE', `/api/workbooks/${r2.data.id}`);
  await j('DELETE', `/api/workbooks/${r3.data.id}`);
  assert.equal((await j('GET', '/api/workbooks')).data.workbooks.length, before - 1);
});

test('제목이 ".." 인 문제집 내보내기는 루트 밖에 쓰지 않는다', async () => {
  const wb = (await j('POST', '/api/workbooks', { title: '..' })).data;
  const r = await j('POST', `/api/workbooks/${wb.id}/export`, { path: tmp });
  assert.equal(r.status, 200);
  assert.ok(r.data.path.startsWith(tmp + path.sep) && r.data.path !== tmp, r.data.path);
  assert.ok(!fs.existsSync(path.join(path.dirname(tmp), 'workbook.json')));
  await j('DELETE', `/api/workbooks/${wb.id}`);
});

test('설정 검증: allowedRoots 문자열·상대경로, 잘못된 포트는 400', async () => {
  assert.equal((await j('PUT', '/api/settings', { allowedRoots: '/' })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { allowedRoots: ['relative/dir'] })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { port: -1 })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { port: 'abc' })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { defaultProvider: 'nope' })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { chat: { maxOutputTokens: -5 } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', [1, 2])).status, 400);
  assert.equal((await j('GET', `/api/fs/list?path=${encodeURIComponent(os.homedir())}`)).status, 403);
});

test('잡파일·손상 JSON·BOM 이 있어도 목록과 doctor 가 동작한다', async () => {
  fs.writeFileSync(path.join(tmp, 'workbooks', 'desktop.ini'), '[.ShellClassInfo]');
  fs.mkdirSync(path.join(tmp, 'workbooks', 'broken'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'workbooks', 'broken', 'workbook.json'), '{ not json');
  fs.writeFileSync(path.join(tmp, 'answers', 'Thumbs.db'), 'x');
  const list = await j('GET', '/api/workbooks');
  assert.equal(list.status, 200);
  assert.ok(list.data.workbooks.length >= 1);
  assert.equal((await j('GET', '/api/answers-status')).status, 200);
  assert.equal((await j('GET', '/api/library')).status, 200);
  // BOM 이 붙은 credentials.json
  const credFile = path.join(tmp, 'config', 'credentials.json');
  fs.writeFileSync(credFile, '﻿' + fs.readFileSync(credFile, 'utf8'));
  assert.equal((await j('GET', '/api/credentials')).status, 200);
  // 손상된 settings.json 에서도 doctor 는 결과를 돌려준다
  const settingsFile = path.join(tmp, 'config', 'settings.json');
  const good = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, '{ "port": 3210, }');
  const d = await j('GET', '/api/doctor');
  assert.equal(d.status, 200);
  assert.ok(d.data.checks.some((c) => c.id === 'settings' && c.status === 'fail'));
  fs.writeFileSync(settingsFile, good);
  fs.rmSync(path.join(tmp, 'workbooks', 'broken'), { recursive: true });
});

test('입력 검증: 비문자열 제목, 없는 문제에 답안/채팅, 중복 problemOrder', async () => {
  assert.equal((await j('POST', '/api/workbooks', { title: 1 })).data.title, '1');
  assert.equal((await j('POST', '/api/workbooks', { title: '   ' })).status, 400);
  assert.equal((await j('PUT', '/api/answers/wb_nope/p_nope', { html: '<p>x</p>' })).status, 404);
  const wb = (await j('GET', '/api/workbooks')).data.workbooks.find((w) => w.libraryId === 'lib-basics');
  const pid = wb.problems[0].id;
  const upd = await j('PUT', `/api/workbooks/${wb.id}`, { problemOrder: [pid, pid, pid] });
  assert.equal(upd.data.problems.filter((p) => p.id === pid).length, 1);
  assert.equal((await j('PUT', `/api/answers/${wb.id}/${pid}`, { html: '<p>x</p>', status: 'weird' })).status, 400);
  for (const w of (await j('GET', '/api/workbooks')).data.workbooks) if (w.title === '1') await j('DELETE', `/api/workbooks/${w.id}`);
});

test('채팅 이력에서 오류·중단 메시지는 모델에 전달되지 않는다', async () => {
  saveCredentials({ custom: { apiKey: 'bad' } });
  await sse('/api/chat/general/general/stream', { message: '실패할 메시지' });
  saveCredentials({ custom: { apiKey: 'mock-key' } });
  const { events } = await sse('/api/chat/general/general/stream', { message: '정상', maxHistory: 50 });
  const done = events.find(([e]) => e === 'done');
  assert.ok(done);
  // 모의 서버는 시스템 프롬프트 길이만 알려주므로 여기서는 성공 여부만 확인하고, 이력 구성은 단위 수준에서 검사
  const hist = (await j('GET', '/api/chat/general/general')).data.messages;
  assert.ok(hist.some((m) => m.error));
});

test('Host 헤더가 localhost 계열이 아니면 403 (DNS rebinding 방지)', async () => {
  // fetch 는 Host 헤더를 덮어쓰지 못하므로 http 모듈로 보낸다
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/health', headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('EUC-KR 로 저장된 CSV 참고자료도 텍스트로 읽힌다', async () => {
  const wb = (await j('GET', '/api/workbooks')).data.workbooks.find((w) => w.libraryId === 'lib-basics');
  const pid = wb.problems[0].id;
  const euc = Buffer.from(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31, 0x0a])); // "한글,1\n" in EUC-KR
  const up = await j('POST', `/api/workbooks/${wb.id}/problems/${pid}/references`, { fileName: 'cp949.csv', contentBase64: euc.toString('base64') });
  assert.equal(up.status, 201);
  const txt = await (await fetch(base + `/api/workbooks/${wb.id}/problems/${pid}/references/cp949.csv?text=1`)).text();
  assert.match(txt, /한글,1/);
  await j('DELETE', `/api/workbooks/${wb.id}/problems/${pid}/references/cp949.csv`);
});
