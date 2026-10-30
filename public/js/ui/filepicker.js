// 로컬 파일 선택기 + 파일 탐색기. 서버의 /api/fs 를 사용한다(허용된 폴더 안에서만 동작).
import { api } from '../api.js';
import { openModal, toast, promptDialog, confirmDialog } from './modal.js';
import { escapeHtml, renderMarkdown, renderCsv } from '../markdown.js';
import { prefs } from '../state.js';

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
let knownRoots = [];
const insideRoots = (p) => knownRoots.some((r) => { const a = p.replace(/[\\/]+$/, '').toLowerCase(); const b = r.replace(/[\\/]+$/, '').toLowerCase(); return a === b || a.startsWith(b + '\\') || a.startsWith(b + '/'); });
/** 경로 조각(breadcrumb) HTML. 허용 폴더 밖 조각은 클릭 불가로 표시 */
function crumbsHtml(current) {
  const parts = current.split(/[\\/]/).filter(Boolean);
  const s = sep(current);
  return `<button data-root title="허용된 폴더 목록">💽</button>` + parts.map((p, i) => {
    const path = (current.startsWith('/') ? '/' : '') + parts.slice(0, i + 1).join(s) + (i === 0 && /^[A-Za-z]:$/.test(p) ? '\\' : '');
    return insideRoots(path) ? `<button data-crumb="${escapeHtml(path)}">${escapeHtml(p)}</button>` : `<span class="muted" title="허용 폴더 밖">${escapeHtml(p)}</span>`;
  }).join('<span class="muted">›</span>');
}
const fmtDate = (ms) => new Date(ms).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const join = (dir, name) => (dir.endsWith(sep(dir)) ? dir + name : dir + sep(dir) + name);

/**
 * 경로 선택 다이얼로그.
 * @param {{mode:'file'|'dir'|'save', title?:string, defaultName?:string, accept?:(entry)=>boolean, multiple?:boolean}} opts
 * @returns {Promise<string|string[]|null>}  mode=save → 전체 파일 경로, dir → 폴더 경로, file → 파일 경로(multiple 이면 배열)
 */
export function pickPath({ mode = 'file', title, defaultName = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    let current = null;
    let selected = new Set();
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row-between" style="margin-bottom:8px">
        <div class="fp-crumbs" data-crumbs></div>
        <div class="row">
          <button class="btn btn-sm" data-newdir>📁 새 폴더</button>
          <button class="btn btn-sm" data-open-explorer title="Windows 탐색기로 열기">↗ 탐색기</button>
        </div>
      </div>
      <div class="fp-list" data-list></div>
      ${mode === 'save' ? `<div class="field" style="margin-top:10px"><label>파일 이름</label><input data-filename value="${escapeHtml(defaultName)}" /></div>` : ''}
      <div class="small muted" style="margin-top:6px" data-status></div>`;
    const listEl = body.querySelector('[data-list]');
    const crumbsEl = body.querySelector('[data-crumbs]');
    const statusEl = body.querySelector('[data-status]');

    const ctx = openModal({
      title: title || { file: '파일 선택', dir: '폴더 선택', save: '저장 위치 선택' }[mode],
      body,
      wide: true,
      buttons: [
        { label: '취소', onClick: () => resolve(null) },
        {
          label: mode === 'save' ? '저장' : '선택',
          primary: true,
          onClick: () => {
            if (!current) {
              toast('먼저 폴더로 들어가세요. (목록에서 폴더를 클릭)', 'error');
              return false;
            }
            if (mode === 'dir') return resolve(current);
            if (mode === 'save') {
              const name = body.querySelector('[data-filename]').value.trim();
              if (!name) {
                toast('파일 이름을 입력하세요.', 'error');
                return false;
              }
              return resolve(join(current, name));
            }
            if (!selected.size) {
              toast('파일을 선택하세요.', 'error');
              return false;
            }
            resolve(multiple ? [...selected] : [...selected][0]);
          },
        },
      ],
      onClose: () => resolve(null),
    });

    body.querySelector('[data-newdir]').addEventListener('click', async () => {
      if (!current) return toast('먼저 폴더로 들어가세요.', 'error');
      const name = await promptDialog('새 폴더 이름', { title: '새 폴더' });
      if (!name) return;
      try {
        await api.fsMkdir(join(current, name));
        toast('폴더를 만들었습니다.', 'ok', 1500);
        load(current);
      } catch (err) { toast(err.message, 'error'); }
    });
    body.querySelector('[data-open-explorer]').addEventListener('click', () => (current ? api.fsOpen(current).catch((e) => toast(e.message, 'error')) : toast('먼저 폴더로 들어가세요.', 'error')));

    async function showRoots() {
      current = null;
      selected.clear();
      const { roots } = await api.fsRoots();
      knownRoots = roots.map((r) => r.path);
      // 허용 폴더가 하나뿐이면 바로 그 안으로
      if (roots.length === 1 && roots[0].exists) return load(roots[0].path);
      crumbsEl.innerHTML = `<span class="muted">허용된 폴더 (하나를 선택하세요)</span>`;
      listEl.innerHTML = roots
        .map((r) => `<div class="fp-row" data-dir="${escapeHtml(r.path)}"><span>💽</span><span>${escapeHtml(r.path)}</span><span class="sz"></span><span class="mt">${r.exists ? '' : '(없음)'}</span></div>`)
        .join('');
      statusEl.textContent = '다른 폴더를 쓰려면 설정 > 파일 접근 허용 폴더 에 추가하세요.';
    }

    async function load(dir) {
      try {
        const data = await api.fsList(dir);
        current = data.path;
        selected.clear();
        prefs.set('fp:last', current);
        if (!knownRoots.length) knownRoots = (await api.fsRoots()).roots.map((r) => r.path);
        crumbsEl.innerHTML = crumbsHtml(current);
        const rows = [];
        if (data.parent) rows.push(`<div class="fp-row" data-dir="${escapeHtml(data.parent)}"><span>↩</span><span>..</span><span></span><span></span></div>`);
        for (const e of data.entries) {
          if (e.isDir) rows.push(`<div class="fp-row" data-dir="${escapeHtml(e.path)}"><span>📁</span><span>${escapeHtml(e.name)}</span><span class="sz"></span><span class="mt">${fmtDate(e.mtime)}</span></div>`);
          else if (mode !== 'dir')
            rows.push(`<div class="fp-row" data-file="${escapeHtml(e.path)}" data-name="${escapeHtml(e.name)}"><span>📄</span><span>${escapeHtml(e.name)}</span><span class="sz">${fmtSize(e.size)}</span><span class="mt">${fmtDate(e.mtime)}</span></div>`);
        }
        listEl.innerHTML = rows.join('') || '<div class="empty">비어 있음</div>';
        statusEl.textContent = current;
      } catch (err) {
        toast(err.message, 'error');
        showRoots();
      }
    }

    crumbsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-root')) showRoots();
      else load(b.dataset.crumb);
    });
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.fp-row');
      if (!row) return;
      if (row.dataset.dir) return load(row.dataset.dir);
      if (row.dataset.file) {
        if (mode === 'save') {
          body.querySelector('[data-filename]').value = row.dataset.name;
          return;
        }
        if (!multiple) {
          selected.clear();
          listEl.querySelectorAll('.selected').forEach((r) => r.classList.remove('selected'));
        }
        if (selected.has(row.dataset.file)) {
          selected.delete(row.dataset.file);
          row.classList.remove('selected');
        } else {
          selected.add(row.dataset.file);
          row.classList.add('selected');
        }
      }
    });
    listEl.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.fp-row');
      if (row?.dataset.file && mode === 'file') {
        resolve(multiple ? [row.dataset.file] : row.dataset.file);
        ctx.close();
      }
    });

    const last = prefs.get('fp:last');
    if (last) load(last);
    else showRoots();
  });
}

/** 전체 기능 파일 탐색기 (읽기 / 텍스트 편집 / 새 파일 / 삭제) */
export async function openFileExplorer() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-between" style="margin-bottom:8px">
      <div class="fp-crumbs" data-crumbs></div>
      <div class="row">
        <button class="btn btn-sm" data-newfile>📄 새 텍스트 파일</button>
        <button class="btn btn-sm" data-newdir>📁 새 폴더</button>
        <button class="btn btn-sm" data-open-explorer>↗ 탐색기</button>
      </div>
    </div>
    <div class="fp-list" data-list></div>
    <div class="fp-preview" data-preview></div>`;
  const listEl = body.querySelector('[data-list]');
  const crumbsEl = body.querySelector('[data-crumbs]');
  const previewEl = body.querySelector('[data-preview]');
  let current = null;
  openModal({ title: '파일 탐색기 (허용된 폴더 안에서 읽기/쓰기)', body, wide: true });

  async function showRoots() {
    current = null;
    const { roots } = await api.fsRoots();
    knownRoots = roots.map((r) => r.path);
    if (roots.length === 1 && roots[0].exists) return load(roots[0].path);
    crumbsEl.innerHTML = `<span class="muted">허용된 폴더 (하나를 선택하세요)</span>`;
    listEl.innerHTML = roots.map((r) => `<div class="fp-row" data-dir="${escapeHtml(r.path)}"><span>💽</span><span>${escapeHtml(r.path)}</span><span></span><span class="mt">${r.exists ? '' : '(없음)'}</span></div>`).join('');
    previewEl.innerHTML = '<div class="small muted">폴더를 추가하려면 설정 > 파일 접근 허용 폴더.</div>';
  }
  async function load(dir) {
    try {
      const data = await api.fsList(dir);
      current = data.path;
      prefs.set('fp:last', current);
      if (!knownRoots.length) knownRoots = (await api.fsRoots()).roots.map((r) => r.path);
      crumbsEl.innerHTML = crumbsHtml(current);
      const rows = [];
      if (data.parent) rows.push(`<div class="fp-row" data-dir="${escapeHtml(data.parent)}"><span>↩</span><span>..</span><span></span><span></span></div>`);
      for (const e of data.entries)
        rows.push(
          `<div class="fp-row" ${e.isDir ? `data-dir="${escapeHtml(e.path)}"` : `data-file="${escapeHtml(e.path)}" data-text="${e.isText}" data-name="${escapeHtml(e.name)}"`}><span>${e.isDir ? '📁' : '📄'}</span><span>${escapeHtml(e.name)}</span><span class="sz">${e.isDir ? '' : fmtSize(e.size)}</span><span class="mt">${fmtDate(e.mtime)}</span></div>`,
        );
      listEl.innerHTML = rows.join('') || '<div class="empty">비어 있음</div>';
      previewEl.innerHTML = '';
    } catch (err) {
      toast(err.message, 'error');
      showRoots();
    }
  }
  async function preview(path, isText, name) {
    if (!isText) {
      previewEl.innerHTML = `<div class="row"><span class="muted">${escapeHtml(name)} (미리보기 불가)</span> <a class="btn btn-sm" href="/api/fs/read?path=${encodeURIComponent(path)}&download=1">⬇ 다운로드</a> <button class="btn btn-sm btn-danger" data-del>삭제</button></div>`;
    } else {
      const { content } = await api.fsRead(path);
      previewEl.innerHTML = `
        <div class="row-between"><strong>${escapeHtml(name)}</strong>
          <div class="row"><button class="btn btn-sm" data-edit>✏️ 편집</button><button class="btn btn-sm btn-danger" data-del>삭제</button></div></div>
        <div data-view>${name.endsWith('.md') ? `<div class="prose">${renderMarkdown(content)}</div>` : name.endsWith('.csv') ? renderCsv(content) : `<pre>${escapeHtml(content)}</pre>`}</div>`;
      previewEl.querySelector('[data-edit]').addEventListener('click', () => {
        previewEl.querySelector('[data-view]').innerHTML = `<textarea style="width:100%;min-height:220px;font-family:var(--mono)">${escapeHtml(content)}</textarea><div class="row" style="margin-top:6px"><button class="btn btn-primary btn-sm" data-save>저장</button></div>`;
        previewEl.querySelector('[data-save]').addEventListener('click', async () => {
          await api.fsWrite(path, previewEl.querySelector('textarea').value);
          toast('저장했습니다.', 'ok');
          preview(path, true, name);
        });
      });
    }
    previewEl.querySelector('[data-del]').addEventListener('click', async () => {
      if (!(await confirmDialog(`${name} 을(를) 삭제할까요? 되돌릴 수 없습니다.`, { danger: true, okLabel: '삭제' }))) return;
      await api.fsDelete(path);
      toast('삭제했습니다.');
      load(current);
    });
  }
  crumbsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.hasAttribute('data-root') ? showRoots() : load(b.dataset.crumb);
  });
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.fp-row');
    if (!row) return;
    if (row.dataset.dir) return load(row.dataset.dir);
    listEl.querySelectorAll('.selected').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    preview(row.dataset.file, row.dataset.text === 'true', row.dataset.name).catch((err) => toast(err.message, 'error'));
  });
  body.querySelector('[data-newfile]').addEventListener('click', async () => {
    if (!current) return toast('먼저 폴더로 들어가세요.', 'error');
    const name = await promptDialog('파일 이름 (예: 메모.md)', { title: '새 텍스트 파일' });
    if (!name) return;
    await api.fsWrite(join(current, name), '', false).catch((e) => toast(e.message, 'error'));
    load(current);
  });
  body.querySelector('[data-newdir]').addEventListener('click', async () => {
    if (!current) return toast('먼저 폴더로 들어가세요.', 'error');
    const name = await promptDialog('새 폴더 이름', { title: '새 폴더' });
    if (!name) return;
    await api.fsMkdir(join(current, name));
    load(current);
  });
  body.querySelector('[data-open-explorer]').addEventListener('click', () => current && api.fsOpen(current).catch((e) => toast(e.message, 'error')));
  const last = prefs.get('fp:last');
  if (last) load(last);
  else showRoots();
}
