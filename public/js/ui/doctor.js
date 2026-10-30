// Doctor 모달: 환경 점검 결과 표시 + 실시간 API 테스트 + 결과 복사
import { api } from '../api.js';
import { openModal, toast } from './modal.js';
import { escapeHtml } from '../markdown.js';
import { openSettings } from './settings.js';

export async function openDoctor() {
  const body = document.createElement('div');
  body.innerHTML = '<div class="empty">점검 중…</div>';
  let last = null;
  const ctx = openModal({
    title: '🩺 Doctor · 환경 점검',
    body,
    wide: true,
    buttons: [
      { label: '결과 복사', close: false, onClick: () => { if (last) navigator.clipboard.writeText(toText(last)).then(() => toast('복사했습니다. 문제 해결을 위해 AI 나 담당자에게 붙여 넣으세요.', 'ok')); } },
      { label: '설정 열기', close: true, onClick: () => openSettings('keys') },
      { label: '다시 검사', close: false, onClick: () => run(false) },
      { label: '실시간 API 테스트', close: false, onClick: () => run(true) },
    ],
  });
  async function run(live) {
    body.innerHTML = `<div class="empty">${live ? '각 프로바이더에 실제 요청을 보내는 중… (최대 20초)' : '점검 중…'}</div>`;
    try {
      last = await api.doctor(live);
      render();
    } catch (err) {
      body.innerHTML = `<div class="empty" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
    }
  }
  const order = { fail: 0, warn: 1, ok: 2 };
  const autolink = (s) => s.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  function render() {
    const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
    const s = last.summary;
    body.innerHTML = `
      <div class="doctor-summary"><span class="badge badge-ok">정상 ${s.ok}</span><span class="badge badge-warn">주의 ${s.warn}</span><span class="badge badge-fail">실패 ${s.fail}</span><span class="small muted" style="margin-left:auto">${new Date(last.ranAt).toLocaleString('ko-KR')} ${last.live ? '· 실시간 테스트 포함' : ''}</span></div>
      ${s.fail === 0 ? '<div class="callout">✔ 필수 항목이 모두 정상입니다. 주의 항목은 선택 사항입니다.</div>' : '<div class="callout" style="background:#fee2e2">❌ 실패 항목을 먼저 해결하세요. 각 항목의 안내를 따르면 됩니다.</div>'}
      <ul class="doctor-list">${[...last.checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => `<li class="doctor-item"><span>${icon[c.status]}</span><div><div class="name">${escapeHtml(c.name)}</div><div class="detail">${escapeHtml(c.detail || '')}</div>${c.fix ? `<div class="fix">→ ${autolink(escapeHtml(c.fix))}${/^key:|anykey|defaultModel/.test(c.id) && c.status !== 'ok' ? ' <button class="btn btn-sm" data-open-settings>설정 열기</button>' : ''}</div>` : ''}</div></li>`).join('')}</ul>
      <p class="small muted" style="margin-top:10px">터미널에서도 실행할 수 있습니다: <code>npm run doctor</code> 또는 <code>doctor.bat</code></p>`;
    body.querySelectorAll('[data-open-settings]').forEach((b) => (b.onclick = () => { ctx.close(); openSettings('keys'); }));
  }
  function toText(r) {
    return `Pandanix doctor (${r.ranAt}, live=${r.live})\n` + r.checks.map((c) => `[${c.status.toUpperCase()}] ${c.name}: ${c.detail}${c.fix ? `\n    -> ${c.fix}` : ''}`).join('\n') + `\n정상 ${r.summary.ok} / 주의 ${r.summary.warn} / 실패 ${r.summary.fail}`;
  }
  run(false);
  return ctx;
}
