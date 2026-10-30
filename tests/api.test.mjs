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

test('샘플 문제집이 시드된다', async () => {
  const { data } = await j('GET', '/api/workbooks');
  assert.equal(data.workbooks.length, 1);
  assert.equal(data.workbooks[0].problems.length, 3);
  const p = await j('GET', `/api/workbooks/${data.workbooks[0].id}/problems/${data.workbooks[0].problems[0].id}`);
  assert.deepEqual(p.data.references.map((r) => r.file), ['설비정보.md', '고장이력_2025.csv', '신규설비_견적.md']);
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
