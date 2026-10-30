// 모달, 확인창, 토스트. 모든 팝업 UI 는 이 모듈을 통해 만든다.
import { escapeHtml } from '../markdown.js';

const root = () => document.getElementById('modal-root');

/**
 * 모달을 연다. 반환값 { close, body, foot } .
 * @param {{title:string, body:string|HTMLElement, buttons?:Array<{label, primary?, danger?, onClick?: (ctx)=>any, close?:boolean}>, wide?:boolean, onClose?:()=>void}} opts
 */
export function openModal({ title, body, buttons = [], wide = false, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="btn-icon" data-close title="닫기">✕</button></div>
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
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  root().appendChild(backdrop);
  const first = bodyEl.querySelector('input, textarea, select');
  first?.focus();
  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  }
  return ctx;
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
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'ok' ? 'toast-ok' : ''}`;
  el.textContent = message;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? Math.max(ms, 6000) : ms);
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
