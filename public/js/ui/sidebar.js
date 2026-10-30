// 왼쪽 패널: 문제집 목록 ↔ 문제 상세(지문/제출형식/참고자료/힌트)
import { api, fileToBase64 } from '../api.js';
import { state, emit, on, prefs } from '../state.js';
import { renderMarkdown, renderCsv, escapeHtml } from '../markdown.js';
import { toast, confirmDialog, openModal } from './modal.js';
import { workbookForm, problemForm, aiGenerateDialog, newTextReferenceDialog, refreshWorkbooks, libraryDialog } from './workbookForms.js';
import { pickPath } from './filepicker.js';

let root;
let expanded = new Set(prefs.get('sidebar:expanded', []));
let statusMap = {};
let activeTab = 'prompt';

export function initSidebar(el) {
  root = el;
  on('workbooks:changed', () => state.currentProblem ? renderProblem() : renderList());
  on('problem:changed', () => renderProblem());
  on('answer:saved', ({ wb, p, status }) => {
    (statusMap[wb] ||= {})[p] = status;
  });
  renderList();
}

async function loadStatus() {
  try {
    statusMap = await api.answersStatus();
  } catch {}
}

// ---------- 목록 ----------
async function renderList() {
  await loadStatus();
  const wbs = state.workbooks;
  root.innerHTML = `
    <div class="pane-head"><h2>문제집</h2><span class="badge">${wbs.length}</span></div>
    <div class="wb-actions">
      <button class="btn btn-sm" data-act="new">＋ 문제집 추가</button>
      <button class="btn btn-sm btn-primary" data-act="ai">✨ AI 로 만들기</button>
      <button class="btn btn-sm" data-act="library" title="앱에 포함된 문제집 설치">📚 내장 문제집</button>
      <button class="btn btn-sm" data-act="import" title="workbook.json 이 있는 폴더 선택">📥 가져오기</button>
      <button class="btn btn-sm" data-act="general" title="문제와 무관한 일반 채팅">💬 일반 채팅</button>
    </div>
    <div class="pane-body">
      ${wbs.length ? '' : '<div class="empty"><div class="big">📚</div>문제집이 없습니다.<br>위 버튼으로 추가하거나 AI 로 만들어 보세요.</div>'}
      <ul class="wb-list">${wbs.map(renderWorkbookItem).join('')}</ul>
    </div>`;

  root.querySelector('[data-act="new"]').onclick = async () => {
    const wb = await workbookForm();
    if (!wb) return;
    await refreshWorkbooks();
    expanded.add(wb.id);
    renderList();
    toast('문제집을 만들었습니다. 이제 문제를 추가하세요.', 'ok');
  };
  root.querySelector('[data-act="ai"]').onclick = async () => {
    const wb = await aiGenerateDialog();
    if (!wb) return;
    await refreshWorkbooks();
    expanded.add(wb.id);
    renderList();
  };
  root.querySelector('[data-act="library"]').onclick = async () => {
    const wb = await libraryDialog();
    if (wb) expanded.add(wb.id);
    renderList();
  };
  root.querySelector('[data-act="import"]').onclick = async () => {
    const dir = await pickPath({ mode: 'dir', title: '문제집 폴더 선택 (workbook.json 포함)' });
    if (!dir) return;
    try {
      const wb = await api.importWorkbook(dir);
      await refreshWorkbooks();
      expanded.add(wb.id);
      renderList();
      toast(`가져오기 완료: ${wb.title}`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  root.querySelector('[data-act="general"]').onclick = () => selectProblem(null, null);

  root.querySelectorAll('.wb-item-head').forEach((h) => {
    h.addEventListener('click', (e) => {
      if (e.target.closest('[data-menu]')) return;
      const id = h.closest('.wb-item').dataset.id;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      prefs.set('sidebar:expanded', [...expanded]);
      renderList();
    });
  });
  root.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => workbookMenu(e, b.closest('.wb-item').dataset.id)));
  root.querySelectorAll('.wb-problem').forEach((li) => li.addEventListener('click', () => selectProblem(li.dataset.wb, li.dataset.id)));
  root.querySelectorAll('[data-addp]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = await problemForm(b.dataset.addp);
      if (!p) return;
      await refreshWorkbooks();
      selectProblem(b.dataset.addp, p.id);
    }),
  );
}

function renderWorkbookItem(wb) {
  const open = expanded.has(wb.id);
  const st = statusMap[wb.id] || {};
  return `<li class="wb-item" data-id="${wb.id}">
    <div class="wb-item-head">
      <span>${open ? '▾' : '▸'}</span>
      <div style="flex:1;min-width:0">
        <div class="wb-item-title">${escapeHtml(wb.title)}</div>
        <div class="wb-item-desc">${escapeHtml((wb.description || '').split('\n')[0])}</div>
        <div class="problem-meta" style="margin:4px 0 0">
          ${wb.category ? `<span class="badge">${escapeHtml(wb.category)}</span>` : ''}
          ${wb.difficulty ? `<span class="badge">${escapeHtml(wb.difficulty)}</span>` : ''}
          <span class="badge">문제 ${wb.problems.length}</span>
          ${wb.source === 'ai' ? '<span class="badge">AI 생성</span>' : ''}
        </div>
      </div>
      <button class="btn-icon" data-menu title="메뉴">⋯</button>
    </div>
    ${open ? `<ul class="wb-problems">
      ${wb.problems.map((p, i) => `<li class="wb-problem ${state.currentProblem?.id === p.id ? 'active' : ''}" data-wb="${wb.id}" data-id="${p.id}"><span class="num">${i + 1}</span><span style="flex:1">${escapeHtml(p.title)}</span><span class="status-dot ${st[p.id] || ''}" title="${st[p.id] === 'done' ? '완료' : st[p.id] === 'draft' ? '작성 중' : '시작 전'}"></span></li>`).join('')}
      <li style="padding:4px 12px 2px 24px"><button class="btn btn-sm" data-addp="${wb.id}">＋ 문제 추가</button></li>
    </ul>` : ''}
  </li>`;
}

function workbookMenu(e, wbId) {
  e.stopPropagation();
  const wb = state.workbooks.find((w) => w.id === wbId);
  const items = [
    ['✏️ 문제집 정보 수정', async () => { if (await workbookForm(wb)) { await refreshWorkbooks(); renderList(); } }],
    ['✨ AI 로 문제 추가', async () => { if (await aiGenerateDialog({ workbookId: wbId })) { await refreshWorkbooks(); expanded.add(wbId); renderList(); } }],
    ['📤 폴더로 내보내기', async () => {
      const dir = await pickPath({ mode: 'dir', title: '내보낼 위치 선택' });
      if (!dir) return;
      const r = await api.exportWorkbook(wbId, dir);
      toast(`내보냈습니다: ${r.path}`, 'ok', 6000);
    }],
    ['🗑 문제집 삭제', async () => {
      if (!(await confirmDialog(`"${wb.title}" 문제집과 그 답안을 모두 삭제할까요?`, { danger: true, okLabel: '삭제' }))) return;
      await api.deleteWorkbook(wbId);
      if (state.currentWorkbook?.id === wbId) selectProblem(null, null);
      await refreshWorkbooks();
      renderList();
    }],
  ];
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.style.cssText = `left:${Math.min(e.clientX, window.innerWidth - 220)}px;top:${e.clientY}px;min-width:200px;padding:4px`;
  pop.innerHTML = items.map(([l], i) => `<div class="wb-problem" data-i="${i}" style="padding:7px 12px">${l}</div>`).join('');
  document.body.appendChild(pop);
  const closeMenu = () => pop.remove();
  pop.addEventListener('click', (ev) => {
    const it = ev.target.closest('[data-i]');
    if (it) items[it.dataset.i][1]().catch((err) => toast(err.message, 'error'));
    closeMenu();
  });
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { closeMenu(); document.removeEventListener('mousedown', h); } }), 0);
}

// ---------- 문제 선택 ----------
export async function selectProblem(wbId, pId) {
  if (!wbId || !pId) {
    state.currentWorkbook = null;
    state.currentProblem = null;
    prefs.set('last', null);
    emit('problem:selected', { wb: 'general', p: 'general', problem: null });
    renderList();
    return;
  }
  try {
    const [wb, problem] = await Promise.all([api.workbook(wbId), api.problem(wbId, pId)]);
    state.currentWorkbook = wb;
    state.currentProblem = problem;
    prefs.set('last', { wb: wbId, p: pId });
    activeTab = 'prompt';
    emit('problem:selected', { wb: wbId, p: pId, problem });
    renderProblem();
  } catch (err) {
    toast(err.message, 'error');
    prefs.set('last', null);
    renderList();
  }
}

// ---------- 문제 상세 ----------
async function renderProblem() {
  const p = state.currentProblem;
  const wb = state.currentWorkbook;
  if (!p) return renderList();
  const idx = wb.problems.findIndex((x) => x.id === p.id);
  const tabs = [
    ['prompt', '지문'],
    ['submission', '제출 형식'],
    ['references', `참고자료 (${p.references.length})`],
    ['hints', '힌트'],
  ];
  root.innerHTML = `
    <div class="pane-head">
      <button class="btn-icon" data-back title="문제집 목록">←</button>
      <h2 title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</h2>
      <button class="btn-icon" data-prev title="이전 문제" ${idx <= 0 ? 'disabled' : ''}>‹</button>
      <span class="small muted">${idx + 1}/${wb.problems.length}</span>
      <button class="btn-icon" data-next title="다음 문제" ${idx >= wb.problems.length - 1 ? 'disabled' : ''}>›</button>
      <button class="btn-icon" data-edit title="문제 수정">✏️</button>
      <button class="btn-icon" data-del title="문제 삭제">🗑</button>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${activeTab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}</div>
    <div class="pane-body" data-tabbody></div>`;
  root.querySelector('[data-back]').onclick = () => renderList();
  root.querySelector('[data-prev]').onclick = () => idx > 0 && selectProblem(wb.id, wb.problems[idx - 1].id);
  root.querySelector('[data-next]').onclick = () => idx < wb.problems.length - 1 && selectProblem(wb.id, wb.problems[idx + 1].id);
  root.querySelector('[data-edit]').onclick = async () => {
    const updated = await problemForm(wb.id, p);
    if (updated) {
      state.currentProblem = updated;
      await refreshWorkbooks(); // 목록 제목·문제 수 갱신 → workbooks:changed
      emit('problem:changed', updated);
    }
  };
  root.querySelector('[data-del]').onclick = async () => {
    if (!(await confirmDialog(`"${p.title}" 문제와 답안을 삭제할까요?`, { danger: true, okLabel: '삭제' }))) return;
    await api.deleteProblem(wb.id, p.id);
    await refreshWorkbooks();
    selectProblem(null, null);
  };
  root.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      renderTab();
    }),
  );
  renderTab();
}

function renderTab() {
  const p = state.currentProblem;
  const wb = state.currentWorkbook;
  const body = root.querySelector('[data-tabbody]');
  if (activeTab === 'prompt') {
    body.innerHTML = `
      <div class="problem-meta">
        <span class="badge">${escapeHtml(wb.title)}</span>
        ${p.difficulty ? `<span class="badge">${escapeHtml(p.difficulty)}</span>` : ''}
        ${p.estimatedMinutes ? `<span class="badge">약 ${p.estimatedMinutes}분</span>` : ''}
        ${(p.tags || []).map((t) => `<span class="badge">#${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="prose">${renderMarkdown(p.prompt || '_지문이 없습니다. ✏️ 버튼으로 작성하세요._')}</div>`;
  } else if (activeTab === 'submission') {
    const s = p.submission || {};
    body.innerHTML = `
      <div class="prose">${renderMarkdown(s.format || '_제출 형식이 지정되지 않았습니다._')}</div>
      ${s.charLimit ? `<div class="callout">글자 수 제한: <b>${s.charLimit.toLocaleString()}자 이내</b> (공백 포함 기준, 에디터 하단에서 실시간 확인)</div>` : ''}
      ${s.deliverables?.length ? `<h4>산출물</h4><ul>${s.deliverables.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
      ${p.rubric?.length ? `<h4>평가 기준</h4><ol>${p.rubric.map((r) => `<li>${escapeHtml(typeof r === 'string' ? r : r.criterion || '')}</li>`).join('')}</ol>` : ''}`;
  } else if (activeTab === 'hints') {
    body.innerHTML = p.hints?.length
      ? `<div class="callout">힌트는 AI 에게 어떻게 질문하면 좋은지에 대한 제안입니다.</div><ol>${p.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ol>`
      : '<div class="empty">힌트가 없습니다.</div>';
  } else if (activeTab === 'references') {
    renderReferences(body);
  }
}

function renderReferences(body) {
  const p = state.currentProblem;
  const wb = state.currentWorkbook;
  body.innerHTML = `
    <div class="row" style="margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-sm" data-upload>⬆ 파일 업로드</button>
      <button class="btn btn-sm" data-frompath>📁 로컬 파일에서</button>
      <button class="btn btn-sm" data-newtext>📝 텍스트 자료 작성</button>
      <input type="file" multiple hidden data-fileinput />
    </div>
    ${p.references.length ? '' : '<div class="empty">참고자료가 없습니다.</div>'}
    ${p.references
      .map(
        (r) => `<div class="ref-item" data-file="${escapeHtml(r.file)}">
          <div class="row-between">
            <div style="min-width:0"><div class="ref-name" title="클릭하여 미리보기">${iconFor(r.ext)} ${escapeHtml(r.name)}</div>
              <div class="small muted">${escapeHtml(r.description || '')} <span>· ${escapeHtml(r.file)} · ${(r.size / 1024).toFixed(1)} KB</span></div></div>
            <div class="row">
              <a class="btn-icon" title="다운로드" href="${api.referenceUrl(wb.id, p.id, r.file, true)}">⬇</a>
              <button class="btn-icon" title="삭제" data-delref>🗑</button>
            </div>
          </div>
          <div class="ref-preview" hidden></div>
        </div>`,
      )
      .join('')}`;
  const fileInput = body.querySelector('[data-fileinput]');
  body.querySelector('[data-upload]').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    for (const f of fileInput.files) {
      try {
        state.currentProblem = await api.addReference(wb.id, p.id, { fileName: f.name, contentBase64: await fileToBase64(f) });
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error');
      }
    }
    toast('참고자료를 추가했습니다.', 'ok');
    emit('problem:changed', state.currentProblem);
  };
  body.querySelector('[data-frompath]').onclick = async () => {
    const paths = await pickPath({ mode: 'file', multiple: true, title: '참고자료로 추가할 파일 선택' });
    if (!paths) return;
    for (const path of paths) {
      try {
        state.currentProblem = await api.addReferenceFromPath(wb.id, p.id, path);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    emit('problem:changed', state.currentProblem);
  };
  body.querySelector('[data-newtext]').onclick = async () => {
    const updated = await newTextReferenceDialog(wb.id, p.id);
    if (updated) {
      state.currentProblem = updated;
      emit('problem:changed', updated);
    }
  };
  body.querySelectorAll('.ref-item').forEach((item) => {
    const file = item.dataset.file;
    const ref = p.references.find((r) => r.file === file);
    item.querySelector('.ref-name').onclick = async () => {
      const pv = item.querySelector('.ref-preview');
      if (!pv.hidden) return (pv.hidden = true);
      pv.hidden = false;
      pv.innerHTML = '<span class="muted">불러오는 중…</span>';
      try {
        if (ref.isText) {
          const text = await api.referenceText(wb.id, p.id, file);
          pv.innerHTML = ref.ext === '.md' ? `<div class="prose">${renderMarkdown(text)}</div>` : ref.ext === '.csv' ? renderCsv(text) : `<pre>${escapeHtml(text)}</pre>`;
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ref.ext)) {
          pv.innerHTML = `<img src="${api.referenceUrl(wb.id, p.id, file)}" style="max-width:100%" />`;
        } else if (ref.ext === '.pdf') {
          pv.innerHTML = `<iframe src="${api.referenceUrl(wb.id, p.id, file)}" style="width:100%;height:420px;border:0"></iframe>`;
        } else {
          pv.innerHTML = `<span class="muted">미리보기를 지원하지 않는 형식입니다. 다운로드하여 여세요.</span>`;
        }
      } catch (err) {
        pv.innerHTML = `<span style="color:var(--danger)">${escapeHtml(err.message)}</span>`;
      }
    };
    item.querySelector('[data-delref]').onclick = async () => {
      if (!(await confirmDialog(`참고자료 "${ref.name}" 을(를) 삭제할까요?`, { danger: true, okLabel: '삭제' }))) return;
      state.currentProblem = await api.deleteReference(wb.id, p.id, file);
      emit('problem:changed', state.currentProblem);
    };
  });
}

function iconFor(ext) {
  return { '.md': '📝', '.txt': '📄', '.csv': '📊', '.xlsx': '📊', '.xls': '📊', '.pdf': '📕', '.docx': '📘', '.pptx': '📙', '.png': '🖼', '.jpg': '🖼', '.jpeg': '🖼', '.json': '🧾' }[ext] || '📎';
}

/**
 * 외부 변경 반영: 창이 다시 포커스될 때(다른 탭/탐색기에서 파일을 바꾼 경우) 목록과 현재 문제를 다시 읽는다.
 * 3초 이내 중복 호출은 무시한다.
 */
let lastSync = 0;
export async function syncFromServer() {
  const now = Date.now();
  if (now - lastSync < 3000) return;
  lastSync = now;
  try {
    await refreshWorkbooks();
    if (state.currentWorkbook && state.currentProblem) {
      const fresh = await api.problem(state.currentWorkbook.id, state.currentProblem.id).catch(() => null);
      if (!fresh) return selectProblem(null, null);
      const changed = fresh.updatedAt !== state.currentProblem.updatedAt || JSON.stringify(fresh.references.map((r) => r.file + r.size)) !== JSON.stringify(state.currentProblem.references.map((r) => r.file + r.size));
      if (changed) {
        state.currentProblem = fresh;
        emit('problem:changed', fresh);
      }
    }
  } catch {
    /* 서버 꺼짐 등은 무시 */
  }
}

export function restoreLast() {
  const last = prefs.get('last');
  if (last?.wb && last?.p) selectProblem(last.wb, last.p);
  else selectProblem(null, null);
}

export { openModal };
