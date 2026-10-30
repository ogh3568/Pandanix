// 모달, 확인창, 토스트. 모든 팝업 UI 는 이 모듈을 통해 만든다.
import { escapeHtml } from '../markdown.js';

const root = () => document.getElementById('modal-root');
const modalStack = []; // 열린 모달 (맨 뒤가 최상위). Esc 는 최상위만 닫는다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = modalStack[modalStack.length - 1];
  if (top) {
    e.preventDefault();
    top.close();
  }
});

/**
 * 모달을 연다. 반환값 { close, body, foot } .
 * @param {{title:string, body:string|HTMLElement, buttons?:Array<{label, primary?, danger?, onClick?: (ctx)=>any, close?:boolean}>, wide?:boolean, onClose?:()=>void}} opts
 */
export function openModal({ title, body, buttons = [], wide = false, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const titleId = 'modal-title-' + Math.random().toString(36).slice(2);
  const opener = document.activeElement;
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head"><h3 id="${titleId}">${escapeHtml(title)}</h3><button class="btn-icon" data-close title="닫기" aria-label="닫기">✕</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  const bodyEl = backdrop.querySelector('.modal-body');
  const footEl = backdrop.querySelector('.modal-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  const ctx = { close, body: bodyEl, foot: footEl, el: backdrop };
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', async () => {
      if (b.onClick) {
        btn.disabled = true;
        try {
          const r = await b.onClick(ctx);
          if (r === false) return;
        } catch (err) {
          toast(err.message, 'error');
          return;
        } finally {
          btn.disabled = false;
        }
      }
      if (b.close !== false) close();
    });
    footEl.appendChild(btn);
  }
  if (!buttons.length) footEl.remove();
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  // 포커스 트랩: Tab 이 모달 밖으로 나가지 않게
  backdrop.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...backdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
  root().appendChild(backdrop);
  modalStack.push(ctx);
  const first = bodyEl.querySelector('input, textarea, select') || backdrop.querySelector('[data-close]');
  first?.focus();
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = modalStack.indexOf(ctx);
    if (i >= 0) modalStack.splice(i, 1);
    backdrop.remove();
    onClose?.();
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  }
  return ctx;
}

/**
 * 간단한 팝오버 메뉴. items: [[label, onClick]] . 바깥 클릭·Esc 로 닫히고 방향키로 이동한다.
 * @param {{x:number, y:number, items:Array<[string, Function]>, minWidth?:number}} opts
 */
export function openMenu({ x, y, items, minWidth = 200 }) {
  document.querySelectorAll('.popover.menu').forEach((p) => p.remove());
  const pop = document.createElement('div');
  pop.className = 'popover menu';
  pop.setAttribute('role', 'menu');
  pop.style.cssText = `left:${Math.min(x, window.innerWidth - minWidth - 12)}px;top:${Math.min(y, window.innerHeight - items.length * 34 - 12)}px;min-width:${minWidth}px;padding:4px`;
  pop.innerHTML = items.map(([l], i) => `<div class="menu-item" role="menuitem" tabindex="0" data-i="${i}">${l}</div>`).join('');
  document.body.appendChild(pop);
  const close = () => { pop.remove(); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  const run = (i) => { close(); Promise.resolve(items[i][1]()).catch((err) => toast(err.message, 'error')); };
  const onDown = (ev) => { if (!pop.contains(ev.target)) close(); };
  const onKey = (ev) => {
    const els = [...pop.querySelectorAll('.menu-item')];
    const idx = els.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); els[(idx + 1) % els.length].focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); els[(idx - 1 + els.length) % els.length].focus(); }
    else if ((ev.key === 'Enter' || ev.key === ' ') && idx >= 0) { ev.preventDefault(); run(idx); }
  };
  pop.addEventListener('click', (ev) => { const it = ev.target.closest('[data-i]'); if (it) run(Number(it.dataset.i)); });
  setTimeout(() => { document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey); pop.querySelector('.menu-item')?.focus(); }, 0);
  return close;
}

export function confirmDialog(message, { title = '확인', okLabel = '확인', danger = false } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      buttons: [
        { label: '취소', onClick: () => resolve(false) },
        { label: okLabel, primary: !danger, danger, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog(message, { title = '입력', defaultValue = '', placeholder = '', multiline = false } = {}) {
  return new Promise((resolve) => {
    const id = 'prompt-' + Math.random().toString(36).slice(2);
    const input = multiline
      ? `<textarea id="${id}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(defaultValue)}</textarea>`
      : `<input id="${id}" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" />`;
    const ctx = openModal({
      title,
      body: `<div class="field"><label>${escapeHtml(message)}</label>${input}</div>`,
      buttons: [
        { label: '취소', onClick: () => resolve(null) },
        { label: '확인', primary: true, onClick: (c) => resolve(c.body.querySelector('#' + id).value) },
      ],
      onClose: () => resolve(null),
    });
    const el = ctx.body.querySelector('#' + id);
    if (!multiline) el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        resolve(el.value);
        ctx.close();
      }
    });
  });
}

export function toast(message, type = 'info', ms = 3200) {
  const rootEl = document.getElementById('toast-root');
  // 같은 메시지가 이미 떠 있으면 겹치지 않고 시간만 연장
  const dup = [...rootEl.children].find((c) => c.dataset.msg === message);
  if (dup) { clearTimeout(dup._timer); dup._timer = setTimeout(() => dup.remove(), ms); return; }
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'ok' ? 'toast-ok' : ''}`;
  el.dataset.msg = message;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span></span><button class="toast-close" aria-label="닫기">✕</button>`;
  el.firstChild.textContent = message;
  el.querySelector('.toast-close').onclick = () => el.remove();
  rootEl.appendChild(el);
  el._timer = setTimeout(() => el.remove(), type === 'error' ? Math.max(ms, 6000) : ms);
}

/** 폼 HTML 생성 도우미 */
export function field(label, inputHtml, hint = '') {
  return `<div class="field"><label>${escapeHtml(label)}</label>${inputHtml}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
export const input = (name, value = '', attrs = '') => `<input name="${name}" value="${escapeHtml(value ?? '')}" ${attrs} />`;
export const textarea = (name, value = '', attrs = '') => `<textarea name="${name}" ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
export function formValues(container) {
  const out = {};
  container.querySelectorAll('[name]').forEach((el) => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}
