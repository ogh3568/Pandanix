#!/usr/bin/env node
// 사용 가이드용 화면 캡처 생성기.
// - 임시 데이터 폴더로 서버와 모의 AI 서버를 띄우고, Playwright 로 각 화면을 캡처하면서
//   버튼/영역에 번호 박스와 라벨을 그려 docs/images/*.png 로 저장한다.
// - 실행: node scripts/capture-guide-screenshots.mjs   (Playwright 와 Chromium 이 설치돼 있어야 한다: npx playwright install chromium)
// - UI 를 바꿨다면 이 스크립트를 다시 돌려 이미지를 갱신하고, docs/guide/*.md 의 설명 번호와 맞는지 확인한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright 를 찾을 수 없습니다. `npm i -D playwright && npx playwright install chromium` 후 다시 실행하세요.');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'images');
const PORT = 3456;
const MOCK_PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandanix-shots-'));
fs.mkdirSync(OUT, { recursive: true });

const procs = [];
function run(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  procs.push(p);
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('서버가 뜨지 않았습니다: ' + url);
}
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};

// ---------- 주석(annotation) 도우미 ----------
const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f', '#b45309', '#1d4ed8', '#be123c', '#047857'];
/**
 * marks: [{ sel | box:{x,y,w,h}, n, label, color?, area?:boolean, pad?:number, labelPos?:'tl'|'tr'|'bl'|'br'|'below' }]
 */
async function annotate(page, marks) {
  await page.evaluate(
    ({ marks, COLORS }) => {
      document.getElementById('__anno')?.remove();
      const layer = document.createElement('div');
      layer.id = '__anno';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;font-family:"Malgun Gothic",system-ui,sans-serif';
      document.body.appendChild(layer);
      marks.forEach((m, i) => {
        let r;
        if (m.box) r = { left: m.box.x, top: m.box.y, width: m.box.w, height: m.box.h };
        else {
          const el = typeof m.sel === 'string' ? document.querySelector(m.sel) : m.sel;
          if (!el) return;
          const b = el.getBoundingClientRect();
          r = { left: b.left, top: b.top, width: b.width, height: b.height };
        }
        const pad = m.pad ?? 4;
        const color = m.color || COLORS[(m.n ? m.n - 1 : i) % COLORS.length];
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border:${m.area ? 4 : 3}px solid ${color};border-radius:${m.area ? 10 : 6}px;box-sizing:border-box;${m.area ? `background:${color}14;` : ''}`;
        layer.appendChild(box);
        if (m.n && !m.label) {
          // 번호만: 박스 왼쪽 위 모서리에 작은 원형 배지 (촘촘한 툴바용)
          const badge = document.createElement('div');
          badge.textContent = m.n;
          badge.style.cssText = `position:fixed;left:${r.left - pad - 10}px;top:${r.top - pad - 10}px;width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;background:${color};color:#fff;font-size:12px;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.3)`;
          layer.appendChild(badge);
          return;
        }
        if (m.n || m.label) {
          const tag = document.createElement('div');
          const text = `${m.n ? `<span style="display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;background:#fff;color:${color};font-weight:800;margin-right:${m.label ? 6 : 0}px">${m.n}</span>` : ''}${m.label || ''}`;
          tag.innerHTML = text;
          const size = m.area ? 18 : 13;
          tag.style.cssText = `position:fixed;background:${color};color:#fff;font-size:${size}px;font-weight:700;padding:${m.area ? 6 : 3}px ${m.area ? 12 : 8}px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);line-height:1.4;`;
          layer.appendChild(tag);
          const tw = tag.offsetWidth;
          const th = tag.offsetHeight;
          const pos = m.labelPos || (m.area ? 'center' : 'tl');
          let x = r.left - pad;
          let y = r.top - pad - th - 4;
          if (pos === 'center') { x = r.left + r.width / 2 - tw / 2; y = r.top + 14; }
          if (pos === 'tr') x = r.left + r.width + pad - tw;
          if (pos === 'bl') y = r.top + r.height + pad + 4;
          if (pos === 'br') { x = r.left + r.width + pad - tw; y = r.top + r.height + pad + 4; }
          if (pos === 'below') { x = r.left + r.width / 2 - tw / 2; y = r.top + r.height + pad + 4; }
          if (pos === 'right') { x = r.left + r.width + pad + 6; y = r.top + r.height / 2 - th / 2; }
          if (pos === 'left') { x = r.left - pad - tw - 6; y = r.top + r.height / 2 - th / 2; }
          if (pos === 'inside') { x = r.left + 6; y = r.top + 6; }
          x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
          y = Math.max(4, Math.min(y, window.innerHeight - th - 4));
          tag.style.left = x + 'px';
          tag.style.top = y + 'px';
        }
      });
    },
    { marks: marks.map((m) => ({ ...m, sel: typeof m.sel === 'string' ? m.sel : undefined })), COLORS },
  );
}
async function clearAnno(page) {
  await page.evaluate(() => document.getElementById('__anno')?.remove());
}
async function rect(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, sel);
}
const failures = [];
async function shot(page, name, { clipSel, clip, marks = [], pad = 8, extend = {} } = {}) {
  try {
    if (marks.length) await annotate(page, marks);
    let c = clip;
    if (clipSel) {
      const r = await rect(page, clipSel);
      c = { x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 };
    }
    if (c) {
      // 라벨이 패널 밖으로 나갈 수 있으니 필요한 만큼 넓힌다
      c.x -= extend.left || 0; c.width += (extend.left || 0) + (extend.right || 0);
      c.y -= extend.top || 0; c.height += (extend.top || 0) + (extend.bottom || 0);
      c.x = Math.max(0, c.x); c.y = Math.max(0, c.y);
      c.width = Math.min(c.width, 1500 - c.x);
      c.height = Math.min(c.height, 900 - c.y);
    }
    await page.screenshot({ path: path.join(OUT, name), clip: c });
    console.log('  ✔', name);
  } catch (err) {
    failures.push(`${name}: ${err.message.split('\n')[0]}`);
    console.log('  ✘', name, err.message.split('\n')[0]);
  } finally {
    await clearAnno(page).catch(() => {});
  }
}
/** 한 단계 실패가 전체를 멈추지 않게 */
async function step(name, fn) {
  try { await fn(); } catch (err) { failures.push(`${name}: ${err.message.split('\n')[0]}`); console.log('  ✘ step', name, err.message.split('\n')[0]); }
}
async function openFirstProblem(page, wbTitle, idx = 0) {
  if (await page.locator('[data-back]').count()) { await page.locator('[data-back]').click(); await sleep(250); }
  const item = page.locator('.wb-item', { hasText: wbTitle }).first();
  if (!(await item.locator('.wb-problem').count())) { await item.locator('.wb-item-head').click(); await sleep(300); }
  await item.locator('.wb-problem').nth(idx).click();
  await sleep(600);
}

// ---------- 본문 ----------
async function main() {
  console.log('임시 데이터:', tmp);
  run('node', ['tests/mock-openai-server.mjs', String(MOCK_PORT)]);
  run('node', ['server.js'], { PANDANIX_DATA_DIR: tmp, PORT: String(PORT), PANDANIX_OPEN: '0' });
  await waitFor(BASE + '/api/health');
  // 모의 AI 를 "GPT (OpenAI)" 로 보이게 연결하고 기본 프로바이더로 설정
  await api('PUT', '/api/credentials', { openai: { apiKey: 'sk-demo-key-for-screenshots', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1` } });
  await api('PUT', '/api/settings', { defaultProvider: 'openai', models: { openai: 'gpt-5' } });
  const wbs = (await api('GET', '/api/workbooks')).workbooks;
  const basics = wbs.find((w) => w.libraryId === 'lib-basics');
  const p1 = basics.problems[0];
  // 답안 샘플
  await api('PUT', `/api/answers/${basics.id}/${p1.id}`, {
    html: '<h2>1. 개요</h2><p>3호 프레스는 2013년 도입 후 상각이 끝났고, 2025년 들어 고장이 잦아 <b>교체 여부를 검토</b>했습니다.</p><h2>2. 현황 분석</h2><p>1~10월 고장 19건, 정지 92시간, 수리비 1,655만 원.</p><h2>3. 대안 비교</h2><table><tr><th>구분</th><th>유지보수 지속</th><th>신규 교체(A사)</th></tr><tr><td>초기 비용</td><td>0</td><td>2억 6,000만 원</td></tr><tr><td>연간 비용</td><td>약 2,000만 원 + 잔업</td><td>전력비 30% 절감</td></tr></table><p><br></p>',
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.warn('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(500);
  await page.keyboard.press('Escape');

  // 1. 전체 개요
  await openFirstProblem(page, basics.title, 0);
  await page.fill('[data-input]', '참고자료 요약해줘');
  await page.click('[data-send]');
  await page.waitForFunction(() => !document.querySelector('[data-send]').disabled, null, { timeout: 15000 });
  await sleep(300);
  await shot(page, 'overview.png', {
    marks: [
      { sel: '.topbar', n: 1, label: '상단바 — 프로바이더/모델 선택, 파일, Doctor, 설정, 가이드', area: true, labelPos: 'inside', pad: 0 },
      { sel: '#pane-left', n: 2, label: '문제 패널 — 문제집 → 문제 → 지문·제출 형식·참고자료·힌트', area: true, pad: 0 },
      { sel: '#pane-center', n: 3, label: '답안 작성란', area: true, pad: 0 },
      { sel: '#pane-right', n: 4, label: 'AI 채팅', area: true, pad: 0 },
    ],
  });

  // 2. 상단바
  await shot(page, 'topbar.png', {
    clip: { x: 0, y: 0, width: 1500, height: 64 },
    marks: [
      { sel: '.topbar-actions .btn-icon:nth-of-type(1)', n: 1 },
      { sel: '#provider-select', n: 2 },
      { sel: '#model-input', n: 3 },
      { sel: '#btn-fetch-models', n: 4 },
      { sel: '#btn-files', n: 5 },
      { sel: '#btn-doctor', n: 6 },
      { sel: '#btn-settings', n: 7 },
      { sel: 'a[href="/docs/index.html"]', n: 8 },
    ],
  });

  // 3. 채팅 패널
  await shot(page, 'chat.png', {
    clipSel: '#pane-right',
    extend: { left: 240 },
    marks: [
      { sel: '#chat [data-clear]', n: 1, label: '대화 지우기', labelPos: 'left' },
      { sel: '#chat .quick-actions', n: 2, label: '빠른 작업 버튼', labelPos: 'left' },
      { sel: '#chat .msg-assistant .msg-tools', n: 3, label: '복사 / 답안에 삽입', labelPos: 'left' },
      { sel: '#chat .chat-options', n: 4, label: 'AI 에게 보낼 컨텍스트 선택', labelPos: 'left' },
      { sel: '#chat [data-input]', n: 5, label: '질문 입력 (Ctrl+Enter 전송)', labelPos: 'left' },
      { sel: '#chat [data-send]', n: 6, label: '보내기 / 응답 중엔 ■ 중지', labelPos: 'left' },
      { sel: '#chat [data-model]', n: 7, label: '현재 프로바이더 / 모델', labelPos: 'left' },
    ],
  });

  // 4. 에디터
  await shot(page, 'editor.png', {
    clipSel: '#pane-center',
    marks: [
      { sel: '#editor [data-cmd="formatBlock"]', n: 1 },
      { sel: '#editor [data-cmd="bold"]', n: 2 },
      { sel: '#editor [data-cmd="insertUnorderedList"]', n: 3 },
      { sel: '#editor [data-table]', n: 4 },
      { sel: '#editor [data-image]', n: 5 },
      { sel: '#editor [data-attach]', n: 6 },
      { sel: '#editor [data-link]', n: 7 },
      { sel: '#editor [data-cmd="undo"]', n: 8 },
      { sel: '#editor [data-history]', n: 9 },
      { sel: '#editor [data-export]', n: 10 },
      { sel: '#editor [data-status]', n: 11 },
      { sel: '#editor [data-save]', n: 12 },
      { sel: '#editor .editor-page', n: 13, label: '답안 본문 — 입력하면 자동 저장', labelPos: 'inside', area: true, pad: 0 },
      { sel: '#editor .editor-status', n: 14, label: '글자 수 · 제한 대비 남은 글자 · 저장 상태', labelPos: 'tl' },
    ],
  });

  // 5. 표 도구
  await page.click('#editor .editor-page td');
  await page.mouse.up();
  await sleep(300);
  await shot(page, 'editor-table.png', {
    clipSel: '#pane-center',
    marks: [{ sel: '.table-tools', n: 1, label: '표 안에 커서를 두면 나타나는 표 도구 (행/열 추가·삭제, 머리글 전환, 표 삭제)', labelPos: 'below' }],
  });
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 500);

  // 6. 내보내기 메뉴
  await page.click('#editor [data-export]');
  await sleep(200);
  await shot(page, 'export-menu.png', {
    clipSel: '#pane-center',
    marks: [{ sel: '.popover.menu', n: 1, label: '내보내기 메뉴 (다운로드 / 로컬 폴더에 저장 / 클립보드)', labelPos: 'below' }],
  });
  await page.keyboard.press('Escape');

  // 7. 문제 상세 (지문)
  await shot(page, 'problem-view.png', {
    clipSel: '#pane-left',
    extend: { right: 200 },
    marks: [
      { sel: '#sidebar [data-back]', n: 1 },
      { sel: '#sidebar [data-prev]', n: 2 },
      { sel: '#sidebar [data-next]', n: 3 },
      { sel: '#sidebar [data-edit]', n: 4 },
      { sel: '#sidebar [data-del]', n: 5 },
      { sel: '#sidebar .tabs', n: 6, label: '탭: 지문 · 제출 형식 · 참고자료 · 힌트', labelPos: 'right' },
      { sel: '#sidebar .problem-meta', n: 7, label: '문제집 · 난이도 · 예상 시간 · 태그', labelPos: 'right' },
    ],
  });
  await page.locator('#sidebar .tab', { hasText: '제출 형식' }).click();
  await sleep(200);
  await shot(page, 'problem-submission.png', {
    clipSel: '#pane-left',
    extend: { right: 220 },
    marks: [
      { sel: '#sidebar .callout', n: 1, label: '글자 수 제한 (에디터 하단과 연동)' },
      { sel: '#sidebar [data-tabbody] ol', n: 2, label: '평가 기준: AI 답안 피드백의 채점 기준', labelPos: 'tl' },
    ],
  });
  // 8. 참고자료
  await page.locator('#sidebar .tab', { hasText: '참고자료' }).click();
  await sleep(200);
  await page.locator('#sidebar .ref-name').nth(1).click();
  await sleep(500);
  await shot(page, 'references.png', {
    clipSel: '#pane-left',
    extend: { right: 240 },
    marks: [
      { sel: '#sidebar [data-upload]', n: 1 },
      { sel: '#sidebar [data-frompath]', n: 2 },
      { sel: '#sidebar [data-newtext]', n: 3 },
      { sel: '#sidebar .ref-item:nth-of-type(3) .ref-name', n: 4, label: '이름 클릭 → 미리보기 펼침/접힘', labelPos: 'right' },
      { sel: '#sidebar .ref-item:nth-of-type(3) a.btn-icon', n: 5 },
      { sel: '#sidebar .ref-item:nth-of-type(3) [data-delref]', n: 6 },
    ],
  });
  await page.locator('#sidebar .tab', { hasText: '힌트' }).click();
  await sleep(200);
  await shot(page, 'hints.png', { clipSel: '#pane-left', extend: { right: 120 }, marks: [{ sel: '#sidebar [data-tabbody]', n: 1, label: 'AI 에게 어떻게 물을지 힌트', labelPos: 'inside', pad: 0 }] });

  // 9. 문제집 목록 (목록 맨 위 문제집을 펼쳐서 캡처)
  await page.locator('[data-back]').click();
  await sleep(300);
  const firstCard = page.locator('#sidebar .wb-item').first();
  const firstId = await firstCard.getAttribute('data-id');
  if (!(await firstCard.locator('.wb-problem').count())) { await firstCard.locator('.wb-item-head').click(); await sleep(300); }
  await page.evaluate(() => { document.querySelector('#sidebar .pane-body').scrollTop = 0; });
  await shot(page, 'workbook-list.png', {
    clipSel: '#pane-left',
    extend: { right: 260 },
    marks: [
      { sel: '#sidebar [data-act="new"]', n: 1 },
      { sel: '#sidebar [data-act="ai"]', n: 2 },
      { sel: '#sidebar [data-act="library"]', n: 3 },
      { sel: '#sidebar [data-act="import"]', n: 4 },
      { sel: '#sidebar [data-act="general"]', n: 5 },
      { sel: `#sidebar .wb-item[data-id="${firstId}"] .wb-item-head`, n: 6, label: '문제집 카드 (클릭해 펼치기/접기)', labelPos: 'right' },
      { sel: `#sidebar .wb-item[data-id="${firstId}"] [data-menu]`, n: 7, label: '⋯ 문제집 메뉴', labelPos: 'right' },
      { sel: `#sidebar .wb-item[data-id="${firstId}"] .wb-problem`, n: 8, label: '문제 — 오른쪽 점: 시작 전 · 작성 중 · 완료', labelPos: 'right' },
      { sel: `#sidebar .wb-item[data-id="${firstId}"] [data-addp]`, n: 9, label: '문제 직접 추가', labelPos: 'right' },
    ],
  });
  // 10. 문제집 메뉴
  await page.locator(`#sidebar .wb-item[data-id="${firstId}"] [data-menu]`).click();
  await sleep(200);
  await shot(page, 'workbook-menu.png', { clipSel: '#pane-left', extend: { right: 200 }, marks: [{ sel: '.popover.menu', n: 1, label: '⋯ 메뉴: 수정 · AI 로 문제 추가 · 내보내기 · 삭제', labelPos: 'below' }] });
  await page.keyboard.press('Escape');

  // 11. 문제 추가 폼
  await page.locator(`#sidebar .wb-item[data-id="${firstId}"] [data-addp]`).click();
  await sleep(300);
  await shot(page, 'problem-form.png', {
    marks: [
      { sel: '.modal [name=title]', n: 1, label: '제목' },
      { sel: '.modal [name=prompt]', n: 2, label: '지문 (Markdown)' },
      { sel: '.modal [name=format]', n: 3, label: '제출 형식' },
      { sel: '.modal [name=charLimit]', n: 4, label: '글자 수 제한' },
      { sel: '.modal [name=hints]', n: 5, label: '힌트' },
      { sel: '.modal [name=rubric]', n: 6, label: '평가 기준' },
    ],
  });
  await page.keyboard.press('Escape');

  // 12. AI 로 문제집 만들기
  await page.click('#sidebar [data-act="ai"]');
  await sleep(300);
  await shot(page, 'ai-generate.png', {
    marks: [
      { sel: '.modal .callout', n: 1, label: '사용될 프로바이더/모델 (상단바에서 선택)' },
      { sel: '.modal [name=topic]', n: 2, label: '주제/분야' },
      { sel: '.modal [name=count]', n: 3, label: '문제 수', labelPos: 'bl' },
      { sel: '.modal [name=difficulty]', n: 4, label: '난이도', labelPos: 'bl' },
      { sel: '.modal [name=extra]', n: 5, label: '추가 요구사항' },
      { sel: '.modal-foot .btn-primary', n: 6, label: '생성 시작', labelPos: 'left' },
    ],
  });
  await page.keyboard.press('Escape');

  // 13. 내장 문제집
  await page.click('#sidebar [data-act="library"]');
  await sleep(600);
  await shot(page, 'library.png', {
    marks: [
      { sel: '.modal .provider-card:nth-of-type(1)', n: 1, label: '내장 문제집 카드: 분야·난이도·문제 목록', labelPos: 'inside' },
      { sel: '.modal .provider-card:nth-of-type(1) [data-install]', n: 2, label: '설치됨이면 복사본 추가, 아니면 설치', labelPos: 'left' },
    ],
  });
  await page.keyboard.press('Escape');

  // 14. 설정
  await page.click('#btn-settings');
  await sleep(400);
  await shot(page, 'settings-keys.png', {
    marks: [
      { sel: '.settings-nav', n: 1, label: '설정 메뉴', labelPos: 'bl' },
      { sel: '.provider-card[data-provider="anthropic"] input[name=apiKey]', n: 2, label: 'API 키 붙여넣기', labelPos: 'inside' },
      { sel: '.provider-card[data-provider="anthropic"] [data-save]', n: 3 },
      { sel: '.provider-card[data-provider="anthropic"] [data-test]', n: 4, label: '연결 테스트', labelPos: 'bl' },
      { sel: '.provider-card[data-provider="openai"] .badge', n: 5, label: '설정 상태 (마스킹된 키)', labelPos: 'left' },
    ],
  });
  await page.click('[data-sec="models"]');
  await sleep(300);
  await shot(page, 'settings-models.png', {
    marks: [
      { sel: '.modal [name=defaultProvider]', n: 1, label: '기본 프로바이더' },
      { sel: '.modal [name="model:anthropic"]', n: 2, label: '프로바이더별 기본 모델 ID' },
      { sel: '.modal [data-list="anthropic"]', n: 3, label: '목록 조회 (키 필요)', labelPos: 'right' },
      { sel: '.modal [data-save]', n: 4, label: '저장 → 상단바에 반영', labelPos: 'right' },
    ],
  });
  await page.click('[data-sec="roots"]');
  await sleep(300);
  await shot(page, 'settings-roots.png', {
    marks: [
      { sel: '.modal .doctor-list', n: 1, label: '현재 허용된 폴더 (데이터 폴더는 항상 포함)' },
      { sel: '.modal [name=newRoot]', n: 2, label: '전체 경로 입력 (탐색기 주소창 복사)' },
      { sel: '.modal [data-add]', n: 3, label: '추가', labelPos: 'right' },
    ],
  });
  await page.click('[data-sec="chat"]');
  await sleep(300);
  await shot(page, 'settings-chat.png', { marks: [{ sel: '.modal [data-content]', n: 1, label: '채팅 옵션: 출력 토큰, 참고자료 길이, 기본 컨텍스트, 자동 저장 간격', labelPos: 'inside', pad: 0 }] });
  await page.keyboard.press('Escape');

  // 15. Doctor
  await page.click('#btn-doctor');
  await sleep(1200);
  await shot(page, 'doctor.png', {
    marks: [
      { sel: '.modal .doctor-summary', n: 1, label: '요약: 정상 · 주의 · 실패' },
      { sel: '.modal .doctor-list', n: 2, label: '점검 항목 (실패 → 주의 → 정상 순, 조치 안내 포함)', labelPos: 'inside', pad: 0 },
      { sel: '.modal-foot', n: 3, label: '결과 복사 · 설정 열기 · 다시 검사 · 실시간 API 테스트', labelPos: 'tl' },
    ],
  });
  await page.keyboard.press('Escape');

  // 16. 파일 탐색기
  await page.click('#btn-files');
  await sleep(700);
  const firstFile = page.locator('.fp-row[data-file]').first();
  if (await firstFile.count()) { await firstFile.click(); await sleep(400); }
  await shot(page, 'file-explorer.png', {
    marks: [
      { sel: '.modal .fp-crumbs', n: 1, label: '경로 (💽 = 허용 폴더 목록)' },
      { sel: '.modal [data-newfile]', n: 2, label: '새 텍스트 파일 · 새 폴더 · Windows 탐색기로 열기', labelPos: 'bl' },
      { sel: '.modal .fp-list', n: 3, label: '폴더/파일 목록 (폴더 클릭 → 이동, 파일 클릭 → 미리보기)', labelPos: 'inside', pad: 0 },
      { sel: '.modal .fp-preview', n: 4, label: '미리보기 · 편집 · 삭제', labelPos: 'tl' },
    ],
  });
  await page.keyboard.press('Escape');

  await step('17. 파일 선택기 (내보내기 → 로컬 폴더에 저장)', async () => {
    // 17. 파일 선택기 (내보내기 → 로컬 폴더에 저장)
    await openFirstProblem(page, basics.title, 0);
    await page.click('#editor [data-export]');
    await sleep(200);
    await page.locator('.menu-item', { hasText: 'Markdown 을 로컬 폴더에 저장' }).click();
    await page.waitForSelector('.modal [data-filename]');
    await sleep(500);
    await shot(page, 'file-picker-save.png', {
      marks: [
        { sel: '.modal .fp-crumbs', n: 1, label: '현재 폴더' },
        { sel: '.modal .fp-list', n: 2, label: '폴더로 들어가서 위치 선택', labelPos: 'inside', pad: 0 },
        { sel: '.modal [data-filename]', n: 3, label: '파일 이름' },
        { sel: '.modal-foot .btn-primary', n: 4, label: '저장', labelPos: 'left' },
      ],
    });
    await page.keyboard.press('Escape');
  });
  await step('18. 이전 저장본', async () => {
    // 18. 이전 저장본
    await page.click('#editor [data-history]');
    await sleep(500);
    await shot(page, 'history.png', { marks: [{ sel: '.modal', n: 1, label: '이전 저장본: 왼쪽에서 시각 선택 → 미리보기 → 되돌리기', labelPos: 'inside', pad: 0 }] });
    await page.keyboard.press('Escape');
  });
  await step('19. 일반 채팅 + 키 없음 배너', async () => {
    // 19. 일반 채팅 + 키 없음 배너
    await page.selectOption('#provider-select', 'anthropic');
    await sleep(300);
    await shot(page, 'chat-no-key.png', { clipSel: '#pane-right', extend: { left: 200 }, marks: [{ sel: '.chat-banner', n: 1, label: '선택한 프로바이더에 키가 없을 때 안내', labelPos: 'bl' }] });
    await page.selectOption('#provider-select', 'openai');
  });
  await step('20. 문서 뷰어', async () => {
    // 20. 문서 뷰어
    await page.goto(BASE + '/docs/', { waitUntil: 'networkidle' });
    await sleep(400);
    await shot(page, 'docs-viewer.png', { marks: [{ sel: '.docs-nav', n: 1, label: '문서 목차 (개발 문서는 접힘)', labelPos: 'inside' }, { sel: '.docs-main', n: 2, label: '본문', labelPos: 'inside' }] });
  });
  await browser.close();
  if (failures.length) console.log('\n실패한 캡처:\n - ' + failures.join('\n - '));
  else console.log('\n모든 캡처 완료');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const p of procs) p.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
