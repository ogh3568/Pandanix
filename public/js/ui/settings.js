// 설정 모달: API 키 / 기본 모델 / 파일 접근 폴더 / 채팅 옵션 / 정보
import { api } from '../api.js';
import { state, emit } from '../state.js';
import { openModal, toast, confirmDialog } from './modal.js';
import { escapeHtml } from '../markdown.js';

export async function openSettings(section = 'keys') {
  state.settings = await api.settings();
  const body = document.createElement('div');
  body.className = 'settings-grid';
  const sections = [['keys', '🔑 API 키'], ['models', '🤖 기본 모델'], ['roots', '📁 파일 접근 허용 폴더'], ['chat', '💬 채팅 옵션'], ['info', 'ℹ️ 정보']];
  body.innerHTML = `<nav class="settings-nav">${sections.map(([k, l]) => `<button data-sec="${k}" class="${k === section ? 'active' : ''}">${l}</button>`).join('')}</nav><div data-content></div>`;
  const content = body.querySelector('[data-content]');
  const show = (k) => {
    body.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('active', b.dataset.sec === k));
    ({ keys: renderKeys, models: renderModels, roots: renderRoots, chat: renderChat, info: renderInfo })[k](content);
  };
  body.querySelectorAll('[data-sec]').forEach((b) => (b.onclick = () => show(b.dataset.sec)));
  openModal({ title: '설정', body, wide: true, buttons: [{ label: '닫기' }], onClose: () => emit('settings:changed', state.settings) });
  show(section);
}

function renderKeys(el) {
  const { credentials, providers } = state.settings;
  el.innerHTML = `
    <div class="callout">키는 <code>data/config/credentials.json</code> 에 저장됩니다(git 제외). 환경변수(예: ANTHROPIC_API_KEY)가 있으면 그 값이 우선합니다. 입력란을 비워 두면 기존 키가 유지됩니다.</div>
    ${Object.entries(credentials).map(([name, c]) => `
      <div class="provider-card" data-provider="${name}">
        <div class="row-between">
          <div><strong>${escapeHtml(c.label)}</strong> ${c.note ? `<span class="small muted">· ${escapeHtml(c.note)}</span>` : ''}</div>
          <span class="badge ${c.configured ? 'badge-ok' : ''}">${c.configured ? `설정됨 (${c.source === 'env' ? '환경변수' : c.apiKeyMasked})` : '미설정'}</span>
        </div>
        <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="flex:2;margin:0;min-width:220px"><label>API 키 ${c.keyUrl ? `(<a href="${c.keyUrl}" target="_blank" rel="noopener">발급 페이지</a>)` : ''}</label><input type="password" name="apiKey" placeholder="${c.configured ? '새 키로 바꾸려면 입력' : '키 입력'}" autocomplete="off" /></div>
          ${c.fields.includes('baseUrl') ? `<div class="field" style="flex:2;margin:0;min-width:220px"><label>Base URL</label><input name="baseUrl" value="${escapeHtml(c.baseUrl)}" placeholder="${name === 'openai' ? '비우면 공식 API' : 'https://…/v1'}" /></div>` : ''}
          ${c.fields.includes('organization') ? `<div class="field" style="flex:1;margin:0"><label>Organization (선택)</label><input name="organization" value="${escapeHtml(c.organization)}" /></div>` : ''}
          <button class="btn btn-sm btn-primary" data-save>저장</button>
          <button class="btn btn-sm" data-test>연결 테스트</button>
          ${c.configured && c.source !== 'env' ? '<button class="btn btn-sm btn-danger" data-clear>키 삭제</button>' : ''}
        </div>
        <div class="test-result" data-result></div>
      </div>`).join('')}`;
  el.querySelectorAll('.provider-card').forEach((card) => {
    const name = card.dataset.provider;
    const result = card.querySelector('[data-result]');
    card.querySelector('[data-save]').onclick = async () => {
      const patch = {};
      card.querySelectorAll('input[name]').forEach((i) => (patch[i.name] = i.value));
      try {
        await api.saveCredentials({ [name]: patch });
        state.settings = await api.settings();
        toast('저장했습니다.', 'ok');
        renderKeys(el);
      } catch (err) { toast(err.message, 'error'); }
    };
    card.querySelector('[data-test]').onclick = async () => {
      result.innerHTML = '<span class="muted">테스트 중…</span>';
      const r = await api.testProvider(name);
      result.innerHTML = r.ok ? `<span style="color:var(--ok)">✔ 연결 성공 · ${escapeHtml(r.detail || '')}</span>` : `<span style="color:var(--danger)">✘ ${escapeHtml(r.error || '실패')}</span>`;
    };
    card.querySelector('[data-clear]')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`${name} 키를 삭제할까요?`, { danger: true, okLabel: '삭제' }))) return;
      await api.saveCredentials({ [name]: { apiKey: '__CLEAR__' } });
      state.settings = await api.settings();
      renderKeys(el);
    });
  });
}

function renderModels(el) {
  const { settings, providers, credentials } = state.settings;
  el.innerHTML = `
    <div class="callout">프로바이더별 기본 모델입니다. 상단바에서 언제든 바꿀 수 있고, 여기 값은 앱 시작 시 기본값으로 쓰입니다. "목록" 버튼은 API 로 사용 가능한 모델을 조회합니다(키 필요).</div>
    <div class="field"><label>기본 프로바이더</label><select name="defaultProvider">${Object.entries(providers).map(([k, p]) => `<option value="${k}" ${settings.defaultProvider === k ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}</select></div>
    ${Object.entries(providers).map(([k, p]) => `
      <div class="field"><label>${escapeHtml(p.label)} 모델 ${credentials[k]?.configured ? '' : '<span class="badge">키 미설정</span>'}</label>
        <div class="row"><input name="model:${k}" list="dl-${k}" value="${escapeHtml(settings.models[k] || '')}" placeholder="${escapeHtml(p.defaultModel || '모델 ID 입력 (예: 목록에서 선택)')}" /><datalist id="dl-${k}"></datalist>
        <button class="btn btn-sm" data-list="${k}">목록</button></div></div>`).join('')}
    <div class="row"><button class="btn btn-primary" data-save>저장</button></div>`;
  el.querySelectorAll('[data-list]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    b.textContent = '조회 중…';
    try {
      const { models } = await api.listModels(b.dataset.list);
      el.querySelector(`#dl-${b.dataset.list}`).innerHTML = models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
      toast(`${models.length}개 모델을 불러왔습니다. 입력란을 클릭해 선택하세요.`, 'ok');
    } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; b.textContent = '목록'; }
  }));
  el.querySelector('[data-save]').onclick = async () => {
    const models = {};
    el.querySelectorAll('[name^="model:"]').forEach((i) => (models[i.name.slice(6)] = i.value.trim()));
    await api.saveSettings({ defaultProvider: el.querySelector('[name=defaultProvider]').value, models });
    state.settings = await api.settings();
    toast('저장했습니다.', 'ok');
  };
}

function renderRoots(el) {
  const { settings, dataDir, platform } = state.settings;
  const ex = platform === 'win32' ? 'C:\\Users\\홍길동\\Documents' : '/home/user/Documents';
  el.innerHTML = `
    <div class="callout">파일 탐색기, 참고자료 가져오기, 답안 내보내기는 아래 폴더(와 그 하위) 안에서만 동작합니다. 데이터 폴더는 항상 포함됩니다.</div>
    <ul class="doctor-list">
      <li class="doctor-item"><span>🔒</span><div><div class="name">${escapeHtml(dataDir)}</div><div class="detail">데이터 폴더 (항상 허용)</div></div></li>
      ${settings.allowedRoots.map((r, i) => `<li class="doctor-item"><span>📁</span><div class="row-between"><div class="name">${escapeHtml(r)}</div><button class="btn btn-sm btn-danger" data-rm="${i}">제거</button></div></li>`).join('')}
    </ul>
    <div class="field" style="margin-top:12px"><label>폴더 추가 (전체 경로)</label><div class="row"><input name="newRoot" placeholder="${escapeHtml(ex)}" /><button class="btn btn-primary" data-add>추가</button></div><div class="hint">탐색기 주소창의 경로를 복사해 붙여 넣으세요. 폴더가 실제로 존재해야 합니다.</div></div>`;
  const save = async (roots) => {
    try {
      await api.saveSettings({ allowedRoots: roots });
      state.settings = await api.settings();
      renderRoots(el);
    } catch (err) { toast(err.message, 'error'); }
  };
  el.querySelector('[data-add]').onclick = () => {
    const v = el.querySelector('[name=newRoot]').value.trim();
    if (v) save([...settings.allowedRoots, v]);
  };
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => save(settings.allowedRoots.filter((_, i) => i !== Number(b.dataset.rm)))));
}

function renderChat(el) {
  const c = state.settings.settings.chat;
  const a = state.settings.settings.anthropic || {};
  el.innerHTML = `
    <div class="field"><label>최대 출력 토큰</label><input type="number" name="maxOutputTokens" value="${c.maxOutputTokens}" min="256" /><div class="hint">응답이 중간에 잘리면 늘리세요. (기본 16000)</div></div>
    <div class="field"><label>참고자료 최대 글자 수 (프롬프트에 포함)</label><input type="number" name="maxReferenceChars" value="${c.maxReferenceChars}" min="1000" /><div class="hint">너무 크면 비용과 속도에 영향. 넘치는 부분은 잘립니다.</div></div>
    <div class="field"><label>기본 컨텍스트 포함 여부</label>
      <label><input type="checkbox" name="includeProblem" ${c.includeProblem ? 'checked' : ''}/> 지문·제출형식 포함</label>
      <label><input type="checkbox" name="includeReferences" ${c.includeReferences ? 'checked' : ''}/> 참고자료 포함</label>
      <label><input type="checkbox" name="includeAnswer" ${c.includeAnswer ? 'checked' : ''}/> 내 답안 포함</label></div>
    <div class="field"><label>Claude 안전 거부 시 서버측 대체 모델 사용 (fallbacks)</label><label><input type="checkbox" name="fallbacks" ${a.fallbacks !== false ? 'checked' : ''}/> 사용</label><div class="hint">Claude 5 세대 모델에서 요청이 거부되면 Anthropic 이 권장하는 다른 모델로 자동 재시도합니다.</div></div>
    <div class="field"><label>자동 저장 간격 (ms)</label><input type="number" name="autosaveMs" value="${state.settings.settings.editor.autosaveMs}" min="300" /></div>
    <button class="btn btn-primary" data-save>저장</button>`;
  el.querySelector('[data-save]').onclick = async () => {
    const g = (n) => el.querySelector(`[name=${n}]`);
    await api.saveSettings({
      chat: { maxOutputTokens: Number(g('maxOutputTokens').value), maxReferenceChars: Number(g('maxReferenceChars').value), includeProblem: g('includeProblem').checked, includeReferences: g('includeReferences').checked, includeAnswer: g('includeAnswer').checked },
      anthropic: { fallbacks: g('fallbacks').checked },
      editor: { autosaveMs: Number(g('autosaveMs').value) },
    });
    state.settings = await api.settings();
    toast('저장했습니다.', 'ok');
  };
}

function renderInfo(el) {
  const s = state.settings;
  el.innerHTML = `
    <table style="width:100%">
      <tr><th style="width:160px">데이터 폴더</th><td><code>${escapeHtml(s.dataDir)}</code> <button class="btn btn-sm" data-open>탐색기로 열기</button></td></tr>
      <tr><th>설정 파일</th><td><code>data/config/settings.json</code></td></tr>
      <tr><th>API 키 파일</th><td><code>data/config/credentials.json</code></td></tr>
      <tr><th>문제집</th><td><code>data/workbooks/&lt;id&gt;/workbook.json</code></td></tr>
      <tr><th>답안·채팅</th><td><code>data/answers/&lt;문제집id&gt;/&lt;문제id&gt;/</code></td></tr>
      <tr><th>플랫폼</th><td>${escapeHtml(s.platform)}</td></tr>
    </table>
    <p class="small muted">문서: <a href="/docs/index.html" target="_blank">사용 가이드</a> · 유지보수(AI 용): <code>CLAUDE.md</code>, <code>docs/dev/</code></p>`;
  el.querySelector('[data-open]').onclick = () => api.fsOpen(s.dataDir).catch((e) => toast(e.message, 'error'));
}
