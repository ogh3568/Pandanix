// 앱 부트스트랩: 설정 로드 → 패널 초기화 → 마지막 문제 복원.
import { api } from './api.js';
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
  const saved = prefs.get('provider');
  state.provider = saved && providers[saved] ? saved : settings.defaultProvider;
  sel.innerHTML = Object.entries(providers).map(([k, p]) => `<option value="${k}" ${k === state.provider ? 'selected' : ''}>${credentials[k]?.configured || k === 'custom' ? '' : '⚠ '}${escapeHtml(p.label)}</option>`).join('');
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
      toast(`${models.length}개 모델. 모델 입력란을 클릭해 선택하세요.`, 'ok');
      modelInput.focus();
    } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
  };
}
function fillModelList(models) {
  document.getElementById('model-list').innerHTML = models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
}

function initLayout() {
  const layout = document.getElementById('layout');
  const saved = prefs.get('layout', {});
  if (saved.left) layout.style.setProperty('--left-w', saved.left + 'px');
  if (saved.right) layout.style.setProperty('--right-w', saved.right + 'px');
  document.querySelectorAll('.splitter').forEach((sp) => {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const target = sp.dataset.target;
      const startX = e.clientX;
      const startW = target === 'left' ? document.getElementById('pane-left').offsetWidth : document.getElementById('pane-right').offsetWidth;
      const move = (ev) => {
        const w = Math.max(220, Math.min(700, target === 'left' ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX)));
        layout.style.setProperty(`--${target}-w`, w + 'px');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        prefs.set('layout', { left: document.getElementById('pane-left').offsetWidth, right: document.getElementById('pane-right').offsetWidth });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
  // 단축키: Ctrl+\ 왼쪽, Ctrl+/ 오른쪽 패널 접기
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') { layout.classList.toggle('left-collapsed'); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { layout.classList.toggle('right-collapsed'); e.preventDefault(); }
  });
}

function firstRunHint() {
  const { credentials } = state.settings;
  const any = Object.values(credentials).some((c) => c.configured);
  if (!any && !prefs.get('hint:keys')) {
    prefs.set('hint:keys', true);
    setTimeout(() => {
      toast('아직 API 키가 없습니다. ⚙️ 설정에서 키를 입력하거나 🩺 Doctor 로 환경을 점검하세요.', 'info', 8000);
    }, 600);
  }
}

boot().catch((err) => {
  console.error(err);
  toast('초기화 오류: ' + err.message, 'error');
});
