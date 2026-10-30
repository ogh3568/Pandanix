// 가운데 패널: 답안 에디터 (contenteditable 기반 간단 리치텍스트 + 표 + 첨부 + 자동저장 + 내보내기)
import { api, fileToBase64 } from '../api.js';
import { state, on, emit } from '../state.js';
import { escapeHtml, renderMarkdown } from '../markdown.js';
import { toast, openModal, confirmDialog } from './modal.js';
import { pickPath } from './filepicker.js';

let root, page, statusEl, scope = { wb: 'general', p: 'general' };
let dirty = false;
let saveTimer = null;
let lastSavedHtml = '';
let answerStatus = 'draft';

const ALLOWED_TAGS = new Set(['P', 'BR', 'DIV', 'H1', 'H2', 'H3', 'H4', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A', 'IMG', 'CODE', 'PRE', 'BLOCKQUOTE', 'HR', 'SPAN', 'SUP', 'SUB']);
const ALLOWED_ATTRS = { A: ['href', 'target', 'rel', 'class', 'download'], IMG: ['src', 'alt'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], SPAN: ['class'] };

export function initEditor(el) {
  root = el;
  root.innerHTML = `
    <div class="editor-wrap">
      <div class="editor-toolbar">
        <select data-cmd="formatBlock" title="문단 형식">
          <option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3</option><option value="blockquote">인용</option><option value="pre">코드</option>
        </select>
        <span class="sep"></span>
        <button class="tb" data-cmd="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
        <button class="tb" data-cmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
        <button class="tb" data-cmd="underline" title="밑줄 (Ctrl+U)"><u>U</u></button>
        <button class="tb" data-cmd="strikeThrough" title="취소선"><s>S</s></button>
        <button class="tb" data-cmd="removeFormat" title="서식 지우기">Tx</button>
        <span class="sep"></span>
        <button class="tb" data-cmd="insertUnorderedList" title="글머리 기호">• 목록</button>
        <button class="tb" data-cmd="insertOrderedList" title="번호 매기기">1. 목록</button>
        <button class="tb" data-cmd="insertHorizontalRule" title="구분선">—</button>
        <span class="sep"></span>
        <button class="tb" data-table title="표 삽입">▦ 표</button>
        <button class="tb" data-image title="이미지 삽입">🖼</button>
        <button class="tb" data-attach title="파일 첨부 (답안 폴더에 저장, 본문에 링크)">📎 첨부</button>
        <button class="tb" data-link title="링크">🔗</button>
        <span class="sep"></span>
        <button class="tb" data-cmd="undo" title="실행 취소 (Ctrl+Z)">↶</button>
        <button class="tb" data-cmd="redo" title="다시 실행 (Ctrl+Y)">↷</button>
        <span style="flex:1"></span>
        <button class="tb" data-history title="이전 저장본 보기">🕘</button>
        <button class="tb" data-export title="내보내기">⬇ 내보내기</button>
        <button class="tb" data-status title="완료 표시 전환">○ 작성 중</button>
        <button class="btn btn-sm btn-primary" data-save title="저장 (Ctrl+S)">저장</button>
      </div>
      <div class="editor-scroll">
        <div class="editor-page" contenteditable="true" spellcheck="false" data-placeholder="여기에 답안을 작성하세요. 오른쪽 AI 채팅의 응답은 '답안에 삽입' 으로 가져올 수 있습니다."></div>
      </div>
      <div class="editor-status">
        <span data-chars></span>
        <span data-limit></span>
        <span data-saved class="muted"></span>
        <span style="flex:1"></span>
        <span data-attachments class="attachments"></span>
      </div>
    </div>`;
  page = root.querySelector('.editor-page');
  statusEl = root.querySelector('.editor-status');

  root.querySelectorAll('[data-cmd]').forEach((b) => {
    if (b.tagName === 'SELECT') b.addEventListener('change', () => { exec('formatBlock', b.value); b.value = 'p'; });
    else b.addEventListener('mousedown', (e) => { e.preventDefault(); exec(b.dataset.cmd); });
  });
  root.querySelector('[data-table]').addEventListener('mousedown', (e) => { e.preventDefault(); tableGrid(e.currentTarget); });
  root.querySelector('[data-image]').addEventListener('click', () => pickFile('image/*', insertImage));
  root.querySelector('[data-attach]').addEventListener('click', () => pickFile('*/*', attachFile));
  root.querySelector('[data-link]').addEventListener('mousedown', (e) => { e.preventDefault(); const url = prompt('링크 주소'); if (url) exec('createLink', url); });
  root.querySelector('[data-save]').addEventListener('click', () => save(true));
  root.querySelector('[data-export]').addEventListener('click', exportMenu);
  root.querySelector('[data-history]').addEventListener('click', showHistory);
  root.querySelector('[data-status]').addEventListener('click', toggleStatus);

  page.addEventListener('input', () => { dirty = true; updateCounts(); scheduleSave(); });
  page.addEventListener('paste', onPaste);
  page.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); }
    if (e.key === 'Tab' && closest('TD,TH')) { e.preventDefault(); moveCell(e.shiftKey ? -1 : 1); }
  });
  page.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || a.classList.contains('attachment-chip'))) { window.open(a.href, '_blank'); e.preventDefault(); }
  });
  document.addEventListener('selectionchange', updateToolbarState);
  page.addEventListener('keyup', tableToolbar);
  page.addEventListener('mouseup', tableToolbar);

  on('problem:selected', ({ wb, p }) => load(wb, p));
  // 문제 수정(제목·글자 수 제한 등) 후 상단 제목과 글자 수 표시를 갱신
  on('problem:changed', () => { if (scope.wb !== 'general') { updateCounts(); updateTitle(); } });
  on('workbooks:changed', () => { if (scope.wb !== 'general') updateTitle(); });
  window.addEventListener('beforeunload', (e) => { if (dirty) { save(false); e.preventDefault(); e.returnValue = ''; } });
}

function exec(cmd, val = null) {
  page.focus();
  document.execCommand(cmd, false, val);
  dirty = true;
  updateCounts();
  scheduleSave();
}
function closest(sel) {
  const s = window.getSelection();
  if (!s?.anchorNode) return null;
  const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  return el?.closest(sel) && page.contains(el) ? el.closest(sel) : null;
}
function updateToolbarState() {
  if (!page.contains(document.activeElement) && document.activeElement !== page) return;
  for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'])
    root.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle('active', document.queryCommandState(cmd));
}

// ---------- 불러오기 / 저장 ----------
async function load(wb, p) {
  if (dirty) await save(false);
  scope = { wb, p };
  const general = wb === 'general';
  page.contentEditable = !general;
  if (general) {
    page.innerHTML = '';
    lastSavedHtml = '';
    page.dataset.placeholder = '왼쪽에서 문제를 선택하면 답안을 작성할 수 있습니다.';
    statusEl.querySelector('[data-chars]').textContent = '';
    statusEl.querySelector('[data-limit]').textContent = '';
    statusEl.querySelector('[data-saved]').textContent = '';
    statusEl.querySelector('[data-attachments]').innerHTML = '';
    document.getElementById('topbar-title').textContent = '일반 채팅';
    return;
  }
  page.dataset.placeholder = "여기에 답안을 작성하세요. 오른쪽 AI 채팅의 응답은 '답안에 삽입' 으로 가져올 수 있습니다.";
  try {
    state.answer = await api.answer(wb, p);
    page.innerHTML = sanitize(state.answer.html || '');
    lastSavedHtml = page.innerHTML;
    answerStatus = state.answer.status || 'draft';
    dirty = false;
    renderStatusButton();
    renderAttachments();
    updateCounts();
    statusEl.querySelector('[data-saved]').textContent = state.answer.updatedAt ? `마지막 저장 ${new Date(state.answer.updatedAt).toLocaleString('ko-KR')}` : '아직 저장되지 않음';
    updateTitle();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function updateTitle() {
  document.getElementById('topbar-title').textContent = `${state.currentWorkbook?.title || ''} › ${state.currentProblem?.title || ''}`;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  const ms = state.settings?.settings?.editor?.autosaveMs ?? 1500;
  saveTimer = setTimeout(() => save(false), ms);
}

async function save(explicit) {
  clearTimeout(saveTimer);
  if (scope.wb === 'general') return;
  const html = page.innerHTML;
  if (!explicit && html === lastSavedHtml) { dirty = false; return; }
  try {
    const res = await api.saveAnswer(scope.wb, scope.p, { html, status: answerStatus });
    lastSavedHtml = html;
    dirty = false;
    statusEl.querySelector('[data-saved]').textContent = `저장됨 ${new Date(res.updatedAt).toLocaleTimeString('ko-KR')}`;
    emit('answer:saved', { wb: scope.wb, p: scope.p, status: answerStatus });
    if (explicit) toast('저장했습니다.', 'ok', 1200);
  } catch (err) {
    toast('저장 실패: ' + err.message, 'error');
  }
}

async function toggleStatus() {
  answerStatus = answerStatus === 'done' ? 'draft' : 'done';
  renderStatusButton();
  await save(true);
}
function renderStatusButton() {
  const b = root.querySelector('[data-status]');
  b.textContent = answerStatus === 'done' ? '✔ 완료' : '○ 작성 중';
  b.classList.toggle('active', answerStatus === 'done');
}

// ---------- 글자 수 ----------
export function getText() {
  return page.innerText.replace(/ /g, ' ');
}
function updateCounts() {
  const text = getText();
  const withSpaces = text.replace(/\n/g, '').length;
  const without = text.replace(/\s/g, '').length;
  statusEl.querySelector('[data-chars]').textContent = `${withSpaces.toLocaleString()}자 (공백 제외 ${without.toLocaleString()}자)`;
  const limit = state.currentProblem?.submission?.charLimit;
  const el = statusEl.querySelector('[data-limit]');
  if (limit) {
    const over = withSpaces > limit;
    el.innerHTML = `<span class="${over ? 'over' : ''}">제한 ${limit.toLocaleString()}자 ${over ? `(${(withSpaces - limit).toLocaleString()}자 초과)` : `(${(limit - withSpaces).toLocaleString()}자 남음)`}</span>`;
  } else el.textContent = '';
}

// ---------- 삽입 ----------
export function insertHtml(html) {
  if (scope.wb === 'general') return toast('먼저 문제를 선택하세요.', 'error');
  page.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount || !page.contains(sel.anchorNode)) {
    const r = document.createRange();
    r.selectNodeContents(page);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // 표/블록 요소를 표 셀 안에 넣으면 표가 중첩되므로, 캐럿을 표 뒤로 옮긴다
  if (/<(table|h[1-6]|ul|ol|pre|blockquote)\b/i.test(html)) {
    const table = closest('TABLE');
    if (table) {
      let after = table.nextSibling;
      if (!after || after.nodeType !== 1 || after.tagName !== 'P') {
        after = document.createElement('p');
        after.innerHTML = '<br>';
        table.after(after);
      }
      const r = document.createRange();
      r.selectNodeContents(after);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  document.execCommand('insertHTML', false, sanitize(html));
  dirty = true;
  updateCounts();
  scheduleSave();
}
export function insertMarkdown(md) {
  insertHtml(renderMarkdown(md));
}

function pickFile(accept, handler) {
  if (scope.wb === 'general') return toast('먼저 문제를 선택하세요.', 'error');
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.multiple = true;
  inp.onchange = async () => { for (const f of inp.files) await handler(f).catch((e) => toast(e.message, 'error')); };
  inp.click();
}
async function upload(file) {
  return api.uploadAttachment(scope.wb, scope.p, file.name, await fileToBase64(file));
}
async function insertImage(file) {
  const r = await upload(file);
  insertHtml(`<img src="${r.url}" alt="${escapeHtml(file.name)}" />`);
  renderAttachments();
}
async function attachFile(file) {
  const r = await upload(file);
  insertHtml(`<a class="attachment-chip" href="${r.url}" target="_blank" download>📎 ${escapeHtml(file.name)}</a>&nbsp;`);
  renderAttachments();
}
async function renderAttachments() {
  try {
    const a = await api.answer(scope.wb, scope.p);
    const el = statusEl.querySelector('[data-attachments]');
    el.innerHTML = a.attachments.map((f) => `<span class="chip" title="${escapeHtml(f.file)}"><a href="${api.attachmentUrl(scope.wb, scope.p, f.file)}" target="_blank">📎 ${escapeHtml(f.file)}</a><button class="btn-icon" data-rm="${escapeHtml(f.file)}" title="첨부 삭제">✕</button></span>`).join('');
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog(`첨부 "${b.dataset.rm}" 을(를) 삭제할까요? 본문의 링크는 남습니다.`, { danger: true, okLabel: '삭제' }))) return;
      await api.deleteAttachment(scope.wb, scope.p, b.dataset.rm);
      renderAttachments();
    }));
  } catch {}
}

// ---------- 표 ----------
function tableGrid(anchor) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const pop = document.createElement('div');
  pop.className = 'popover';
  const r = anchor.getBoundingClientRect();
  pop.style.cssText = `left:${r.left}px;top:${r.bottom + 4}px`;
  pop.innerHTML = `<div class="table-grid">${Array.from({ length: 64 }, (_, i) => `<span data-r="${Math.floor(i / 8) + 1}" data-c="${(i % 8) + 1}"></span>`).join('')}</div><div class="small muted" style="text-align:center;padding:0 0 6px" data-label>표 크기 선택</div>`;
  document.body.appendChild(pop);
  const cells = pop.querySelectorAll('span');
  pop.addEventListener('mouseover', (e) => {
    const t = e.target.closest('span');
    if (!t) return;
    cells.forEach((c) => c.classList.toggle('on', +c.dataset.r <= +t.dataset.r && +c.dataset.c <= +t.dataset.c));
    pop.querySelector('[data-label]').textContent = `${t.dataset.r} 행 × ${t.dataset.c} 열`;
  });
  pop.addEventListener('mousedown', (e) => {
    const t = e.target.closest('span');
    if (!t) return;
    e.preventDefault();
    insertTable(+t.dataset.r, +t.dataset.c);
    pop.remove();
  });
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', h); } }), 0);
}
function insertTable(rows, cols) {
  const head = `<tr>${Array.from({ length: cols }, (_, i) => `<th>열 ${i + 1}</th>`).join('')}</tr>`;
  const body = Array.from({ length: Math.max(rows - 1, 1) }, () => `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`).join('');
  insertHtml(`<table>${head}${body}</table><p><br></p>`);
}
function moveCell(dir) {
  const cell = closest('TD,TH');
  if (!cell) return;
  const all = [...cell.closest('table').querySelectorAll('td,th')];
  let i = all.indexOf(cell) + dir;
  if (i >= all.length) { addRow(cell); i = all.length; }
  const target = [...cell.closest('table').querySelectorAll('td,th')][i];
  if (!target) return;
  const r = document.createRange();
  r.selectNodeContents(target);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
function addRow(cell) {
  const tr = cell.closest('tr');
  const clone = tr.cloneNode(true);
  clone.querySelectorAll('td,th').forEach((c) => { const td = document.createElement('td'); td.innerHTML = '<br>'; c.replaceWith(td); });
  tr.after(clone);
  dirty = true; scheduleSave();
}
function tableToolbar() {
  document.querySelector('.table-tools')?.remove();
  const cell = closest('TD,TH');
  if (!cell) return;
  const table = cell.closest('table');
  const bar = document.createElement('div');
  bar.className = 'popover table-tools';
  const r = table.getBoundingClientRect();
  bar.style.cssText = `left:${Math.max(r.left, 8)}px;top:${Math.max(r.top - 34, 60)}px;padding:2px;display:flex;gap:2px`;
  const acts = [
    ['행 +', () => addRow(cell)],
    ['열 +', () => { const idx = [...cell.parentElement.children].indexOf(cell); table.querySelectorAll('tr').forEach((tr) => { const c = document.createElement(tr.children[idx]?.tagName === 'TH' ? 'th' : 'td'); c.innerHTML = '<br>'; tr.children[idx] ? tr.children[idx].after(c) : tr.appendChild(c); }); }],
    ['행 −', () => { if (table.querySelectorAll('tr').length > 1) cell.closest('tr').remove(); else table.remove(); }],
    ['열 −', () => { const idx = [...cell.parentElement.children].indexOf(cell); table.querySelectorAll('tr').forEach((tr) => tr.children[idx]?.remove()); if (!table.querySelector('td,th')) table.remove(); }],
    ['머리글 전환', () => { const tr = cell.closest('tr'); tr.querySelectorAll('td,th').forEach((c) => { const n = document.createElement(c.tagName === 'TH' ? 'td' : 'th'); n.innerHTML = c.innerHTML; c.replaceWith(n); }); }],
    ['표 삭제', () => table.remove()],
  ];
  for (const [label, fn] of acts) {
    const b = document.createElement('button');
    b.className = 'tb';
    b.textContent = label;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); dirty = true; updateCounts(); scheduleSave(); bar.remove(); });
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  const remove = () => { bar.remove(); document.removeEventListener('mousedown', onDown); };
  const onDown = (ev) => { if (!bar.contains(ev.target)) remove(); };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

// ---------- 붙여넣기 / 정화 ----------
function onPaste(e) {
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  if (e.clipboardData.files?.length) {
    e.preventDefault();
    for (const f of e.clipboardData.files) (f.type.startsWith('image/') ? insertImage : attachFile)(f).catch((err) => toast(err.message, 'error'));
    return;
  }
  if (!html && !text) return;
  e.preventDefault();
  if (html) document.execCommand('insertHTML', false, sanitize(html));
  else if (/^\s*\|.*\|\s*\n\s*\|?\s*:?-{2,}/.test(text) || /^#{1,6}\s/m.test(text)) document.execCommand('insertHTML', false, renderMarkdown(text));
  else document.execCommand('insertText', false, text);
  dirty = true;
  updateCounts();
  scheduleSave();
}

export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'].includes(tag)) { child.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {
        // 허용되지 않은 태그는 내용만 남김
        walk(child);
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const ok = (ALLOWED_ATTRS[tag] || []).includes(attr.name);
        if (!ok || /^javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

// ---------- 내보내기 / 기록 ----------
function exportMenu(e) {
  const items = [
    ['Markdown (.md) 다운로드', () => download('md')],
    ['HTML (.html) 다운로드', () => download('html')],
    ['텍스트 (.txt) 다운로드', () => download('txt')],
    ['Markdown 을 로컬 폴더에 저장…', () => saveTo('md')],
    ['HTML 을 로컬 폴더에 저장…', () => saveTo('html')],
    ['본문을 클립보드에 복사 (Markdown)', async () => { const r = await fetch(`/api/answers/${scope.wb}/${scope.p}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'md' }) }); await navigator.clipboard.writeText(await r.text()); toast('복사했습니다.', 'ok'); }],
  ];
  const pop = document.createElement('div');
  pop.className = 'popover';
  const r = e.currentTarget.getBoundingClientRect();
  pop.style.cssText = `left:${Math.min(r.left, window.innerWidth - 300)}px;top:${r.bottom + 4}px;min-width:260px;padding:4px`;
  pop.innerHTML = items.map(([l], i) => `<div class="wb-problem" data-i="${i}" style="padding:7px 12px">${l}</div>`).join('');
  document.body.appendChild(pop);
  pop.addEventListener('click', async (ev) => { const it = ev.target.closest('[data-i]'); pop.remove(); if (it) await items[it.dataset.i][1]().catch((err) => toast(err.message, 'error')); });
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', h); } }), 0);
}
async function download(format) {
  if (scope.wb === 'general') return toast('먼저 문제를 선택하세요.', 'error');
  await save(false);
  const res = await fetch(`/api/answers/${scope.wb}/${scope.p}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.currentProblem?.title || 'answer'}.${format}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function saveTo(format) {
  if (scope.wb === 'general') return toast('먼저 문제를 선택하세요.', 'error');
  await save(false);
  const full = await pickPath({ mode: 'save', title: '저장 위치', defaultName: `${state.currentProblem?.title || 'answer'}.${format}` });
  if (!full) return;
  const i = Math.max(full.lastIndexOf('\\'), full.lastIndexOf('/'));
  const r = await api.exportAnswer(scope.wb, scope.p, { format, path: full.slice(0, i), fileName: full.slice(i + 1) });
  toast(`저장했습니다: ${r.path}`, 'ok', 6000);
}
async function showHistory() {
  if (scope.wb === 'general') return;
  const { history } = await api.answerHistory(scope.wb, scope.p);
  const body = document.createElement('div');
  body.innerHTML = history.length
    ? `<div class="row" style="align-items:flex-start;gap:12px"><div style="width:220px;flex:none" class="stack">${history.map((h) => `<button class="btn btn-sm" data-h="${h.file}">${h.savedAt.replace('T', ' ').replace(/-(\d\d)-(\d\d)-\d+Z$/, ':$1:$2')}</button>`).join('')}</div><div style="flex:1;min-width:0"><div class="prose" data-view style="border:1px solid var(--border);border-radius:8px;padding:10px;max-height:50vh;overflow:auto">왼쪽에서 저장본을 선택하세요.</div></div></div>`
    : '<div class="empty">저장 기록이 없습니다.</div>';
  let selectedHtml = null;
  openModal({
    title: '이전 저장본 (최근 20개)',
    body,
    wide: true,
    buttons: [{ label: '닫기' }, { label: '이 버전으로 되돌리기', primary: true, onClick: () => { if (!selectedHtml) { toast('저장본을 선택하세요.', 'error'); return false; } page.innerHTML = sanitize(selectedHtml); dirty = true; updateCounts(); save(true); } }],
  });
  body.querySelectorAll('[data-h]').forEach((b) => (b.onclick = async () => { const { html } = await api.answerHistoryItem(scope.wb, scope.p, b.dataset.h); selectedHtml = html; body.querySelector('[data-view]').innerHTML = sanitize(html); }));
}
