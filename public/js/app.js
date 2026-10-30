// 앱 부트스트랩: 설정 로드 → 패널 초기화 → 마지막 문제 복원.
import { api, connection } from './api.js';
import { state, emit, on, prefs } from './state.js';
import { toast } from './ui/modal.js';
import { initSidebar, restoreLast, syncFromServer } from './ui/sidebar.js';
import { initEditor } from './ui/editor.js';
import { initChat } from './ui/chat.js';
import { openSettings } from './ui/settings.js';
import { openDoctor } from './ui/doctor.js';
import { openFileExplorer } from './ui/filepicker.js';
import { refreshWorkbooks } from './ui/workbookForms.js';
import { escapeHtml } from './markdown.js';
import { initThemeToggle, getTheme } from './theme.js';
import { openMenu } from './ui/modal.js';

async function boot() {
  try {
    state.settings = await api.settings();
  } catch (err) {
    document.body.innerHTML = `<div class="empty"><div class="big">⚠️</div>서버에 연결할 수 없습니다.<br><span class="small">${escapeHtml(err.message)}</span></div>`;
    return;
  }
  initProviderBar();
  await refreshWorkbooks();
  initSidebar(document.getElementById('sidebar'));
  initEditor(document.getElementById('editor'));
  await initChat(document.getElementById('chat'));
  initLayout();
  initThemeToggle(document.getElementById('btn-theme'));
  document.getElementById('btn-theme').addEventListener('themechange', (e) => toast({ system: '시스템 설정을 따릅니다.', light: '라이트 모드', dark: '다크 모드' }[e.detail], 'ok', 1200));
  document.getElementById('btn-settings').onclick = () => openSettings();
  document.getElementById('btn-doctor').onclick = () => openDoctor();
  document.getElementById('btn-files').onclick = () => openFileExplorer();
  on('settings:changed', () => { initProviderBar(); });
  restoreLast();
  firstRunHint();
  // 다른 탭/탐색기에서 바꾼 내용을 창에 돌아올 때 반영
  window.addEventListener('focus', () => syncFromServer());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromServer(); });
}

function initProviderBar() {
  const { settings, providers, credentials } = state.settings;
  const sel = document.getElementById('provider-select');
  const modelInput = document.getElementById('model-input');
  const usable = (k) => credentials[k]?.configured || providers[k]?.keyOptional;
  const saved = prefs.get('provider');
  state.provider = saved && providers[saved] ? saved : settings.defaultProvider;
  // 선택된 프로바이더에 키가 없고 키 있는 프로바이더가 있으면 그쪽으로 자동 전환 (첫 실행 편의)
  if (!usable(state.provider)) {
    const alt = Object.keys(providers).find((k) => credentials[k]?.configured);
    if (alt) { state.provider = alt; prefs.set('provider', alt); }
  }
  sel.innerHTML = Object.entries(providers).map(([k, p]) => `<option value="${k}" ${k === state.provider ? 'selected' : ''}>${usable(k) ? '' : '⚠ '}${escapeHtml(p.label)}${usable(k) ? '' : ' (키 없음)'}</option>`).join('');
  const applyModel = () => {
    const perProvider = prefs.get('models', {});
    state.model = perProvider[state.provider] || settings.models[state.provider] || '';
    modelInput.value = state.model;
    emit('model:changed');
  };
  applyModel();
  sel.onchange = () => { state.provider = sel.value; prefs.set('provider', state.provider); applyModel(); fillModelList([]); };
  modelInput.onchange = () => { state.model = modelInput.value.trim(); prefs.set('models', { ...prefs.get('models', {}), [state.provider]: state.model }); emit('model:changed'); };
  document.getElementById('btn-fetch-models').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { models } = await api.listModels(state.provider);
      fillModelList(models);
      if (!models.length) return toast('조회된 모델이 없습니다. 모델 ID 를 직접 입력하세요.', 'error');
      const r = b.getBoundingClientRect();
      openMenu({
        x: r.left - 200,
        y: r.bottom + 4,
        minWidth: 300,
        items: models.slice(0, 60).map((m) => [`${escapeHtml(m.id)}${m.label && m.label !== m.id ? ` <span class="muted small">${escapeHtml(m.label)}</span>` : ''}`, () => { modelInput.value = m.id; modelInput.dispatchEvent(new Event('change')); toast(`모델: ${m.id}`, 'ok', 1500); }]),
      });
    } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
  };
}
function fillModelList(models) {
  document.getElementById('model-list').innerHTML = models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
}

const CENTER_MIN = 420;
function initLayout() {
  const layout = document.getElementById('layout');
  const saved = prefs.get('layout', {});
  if (saved.left) layout.style.setProperty('--left-w', saved.left + 'px');
  if (saved.right) layout.style.setProperty('--right-w', saved.right + 'px');
  if (saved.leftCollapsed) layout.classList.add('left-collapsed');
  if (saved.rightCollapsed) layout.classList.add('right-collapsed');
  // 접기 버튼 (상단바)
  const actions = document.querySelector('.topbar-actions');
  const mk = (side, title, icon) => {
    const b = document.createElement('button');
    b.className = 'btn-icon';
    b.title = title + (side === 'left' ? ' (Ctrl+\\)' : ' (Ctrl+/)');
    b.textContent = icon;
    b.onclick = () => toggle(side);
    actions.prepend(b);
    return b;
  };
  mk('right', '오른쪽(채팅) 패널 접기/펼치기', '▶|');
  mk('left', '왼쪽(문제) 패널 접기/펼치기', '|◀');
  function toggle(side) {
    layout.classList.toggle(`${side}-collapsed`);
    prefs.set('layout', { ...prefs.get('layout', {}), leftCollapsed: layout.classList.contains('left-collapsed'), rightCollapsed: layout.classList.contains('right-collapsed') });
  }
  // 스플리터 더블클릭 → 기본 폭 복원
  document.querySelectorAll('.splitter').forEach((sp) => sp.addEventListener('dblclick', () => {
    layout.style.removeProperty('--left-w');
    layout.style.removeProperty('--right-w');
    prefs.set('layout', { leftCollapsed: layout.classList.contains('left-collapsed'), rightCollapsed: layout.classList.contains('right-collapsed') });
    toast('패널 크기를 기본값으로 되돌렸습니다.', 'ok', 1500);
  }));
  document.querySelectorAll('.splitter').forEach((sp) => {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const target = sp.dataset.target;
      const startX = e.clientX;
      const startW = target === 'left' ? document.getElementById('pane-left').offsetWidth : document.getElementById('pane-right').offsetWidth;
      const move = (ev) => {
        const other = target === 'left' ? document.getElementById('pane-right').offsetWidth : document.getElementById('pane-left').offsetWidth;
        const maxW = Math.max(220, window.innerWidth - other - CENTER_MIN - 12); // 가운데 최소 폭 보장
        const w = Math.max(220, Math.min(maxW, target === 'left' ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX)));
        layout.style.setProperty(`--${target}-w`, w + 'px');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        prefs.set('layout', { ...prefs.get('layout', {}), left: document.getElementById('pane-left').offsetWidth, right: document.getElementById('pane-right').offsetWidth });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
  // 단축키: Ctrl+\ 왼쪽, Ctrl+/ 오른쪽 패널 접기
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') { toggle('left'); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { toggle('right'); e.preventDefault(); }
  });
  // 서버 연결 끊김 배너
  let banner = null;
  connection.listeners.add((online) => {
    if (online) { banner?.remove(); banner = null; return; }
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.textContent = '⚠ 서버에 연결할 수 없습니다. 검은 서버 창이 닫혔다면 start.bat 을 다시 실행하세요. 작성 중인 답안은 이 브라우저에 임시 보관됩니다.';
    document.body.appendChild(banner);
    const timer = setInterval(async () => { try { await api.get('/api/health'); clearInterval(timer); } catch {} }, 5000);
  });
}

function firstRunHint() {
  const { credentials } = state.settings;
  const any = Object.values(credentials).some((c) => c.configured);
  if (!any && !prefs.get('hint:keys')) {
    prefs.set('hint:keys', true);
    setTimeout(() => openSettings('keys'), 400); // 첫 실행: 바로 키 입력 화면으로
  }
}

boot().catch((err) => {
  console.error(err);
  toast('초기화 오류: ' + err.message, 'error');
});
