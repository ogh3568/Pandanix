// 오른쪽 패널: AI 채팅 (문제별 대화 기록, 스트리밍, 빠른 작업, 답안에 삽입)
import { api, streamPost } from '../api.js';
import { state, on } from '../state.js';
import { renderMarkdown, escapeHtml } from '../markdown.js';
import { toast, confirmDialog } from './modal.js';
import { insertMarkdown, getText } from './editor.js';

let root, msgsEl, inputEl, scope = { wb: 'general', p: 'general' };
let abort = null;
let quickActions = {};


export async function initChat(el) {
  root = el;
  try { quickActions = await api.quickActions(); } catch {}
  const c = state.settings?.settings?.chat || {};
  root.innerHTML = `
    <div class="chat-wrap">
      <div class="pane-head"><h2>AI 채팅</h2><span class="badge" data-scope>일반</span><button class="btn-icon" data-clear title="대화 지우기">🗑</button></div>
      <div class="quick-actions" data-quick>${Object.entries(quickActions).map(([k, q]) => `<button class="btn btn-sm" data-qa="${k}" title="${escapeHtml(q.prompt)}">${escapeHtml(q.label)}</button>`).join('')}</div>
      <div class="chat-messages" data-msgs></div>
      <div class="chat-compose">
        <div class="chat-options">
          <label><input type="checkbox" data-ctx="problem" ${c.includeProblem !== false ? 'checked' : ''}/> 지문 포함</label>
          <label><input type="checkbox" data-ctx="references" ${c.includeReferences !== false ? 'checked' : ''}/> 참고자료 포함</label>
          <label><input type="checkbox" data-ctx="answer" ${c.includeAnswer ? 'checked' : ''}/> 내 답안 포함</label>
        </div>
        <textarea data-input placeholder="질문을 입력하세요. (Ctrl+Enter 전송)"></textarea>
        <div class="row-between" style="margin-top:6px">
          <span class="small muted" data-model></span>
          <div class="row">
            <button class="btn btn-sm" data-stop hidden>■ 중지</button>
            <button class="btn btn-sm btn-primary" data-send>보내기</button>
          </div>
        </div>
      </div>
    </div>`;
  msgsEl = root.querySelector('[data-msgs]');
  inputEl = root.querySelector('[data-input]');
  root.querySelector('[data-send]').onclick = () => send();
  root.querySelector('[data-stop]').onclick = () => abort?.();
  root.querySelector('[data-clear]').onclick = async () => {
    if (!(await confirmDialog('이 문제의 대화 기록을 모두 지울까요?', { danger: true, okLabel: '지우기' }))) return;
    await api.clearChat(scope.wb, scope.p);
    loadHistory();
  };
  root.querySelectorAll('[data-qa]').forEach((b) => (b.onclick = () => send(b.dataset.qa)));
  inputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  });
  on('problem:selected', ({ wb, p }) => { scope = { wb, p }; updateScope(); loadHistory(); });
  on('model:changed', updateModelLabel);
  updateModelLabel();
}

function updateScope() {
  const general = scope.wb === 'general';
  root.querySelector('[data-scope]').textContent = general ? '일반' : '문제별 대화';
  root.querySelector('[data-quick]').style.display = general ? 'none' : '';
  root.querySelectorAll('[data-ctx]').forEach((c) => (c.disabled = general));
}
function updateModelLabel() {
  root.querySelector('[data-model]').textContent = `${state.provider || '-'} / ${state.model || '(모델 미지정)'}`;
}

async function loadHistory() {
  try {
    const { messages } = await api.chat(scope.wb, scope.p);
    msgsEl.innerHTML = '';
    if (!messages.length) msgsEl.innerHTML = `<div class="empty"><div class="big">🐼</div>${scope.wb === 'general' ? '무엇이든 물어보세요.' : '문제에 대해 질문하거나 위의 빠른 작업 버튼을 눌러 보세요.<br><span class="small">예: "참고자료의 수치를 표로 정리해 줘"</span>'}</div>`;
    for (const m of messages) appendMessage(m);
    scrollBottom();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function appendMessage(m) {
  msgsEl.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${m.role === 'user' ? 'msg-user' : 'msg-assistant'} ${m.error ? 'msg-error' : ''}`;
  if (m.role === 'user') {
    el.innerHTML = `${escapeHtml(m.content)}<div class="msg-meta">${m.quickAction ? `<span>빠른 작업: ${escapeHtml(quickActions[m.quickAction]?.label || m.quickAction)}</span>` : ''}<span>${fmtTime(m.ts)}</span></div>`;
  } else {
    el.innerHTML = `<div class="prose" data-content>${renderMarkdown(m.content || '')}</div>
      <div class="msg-meta"><span>${escapeHtml(m.model || '')}</span>${m.usage ? `<span>토큰 ${m.usage.input ?? '?'}→${m.usage.output ?? '?'}</span>` : ''}<span>${fmtTime(m.ts)}</span></div>
      <div class="msg-tools"><button class="btn btn-sm" data-copy>복사</button><button class="btn btn-sm" data-insert>답안에 삽입</button></div>`;
    el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(el._raw ?? m.content).then(() => toast('복사했습니다.', 'ok', 1200));
    el.querySelector('[data-insert]').onclick = () => insertMarkdown(el._raw ?? m.content);
    el._raw = m.content;
  }
  msgsEl.appendChild(el);
  return el;
}
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');
const scrollBottom = () => (msgsEl.scrollTop = msgsEl.scrollHeight);

function send(quickAction = null) {
  const text = inputEl.value.trim();
  if (!text && !quickAction) return;
  if (abort) return toast('응답을 기다리는 중입니다.', 'error');
  if (!state.model) return toast('상단바에서 모델을 지정하세요.', 'error');
  const context = {};
  root.querySelectorAll('[data-ctx]').forEach((c) => (context[c.dataset.ctx] = c.checked));
  const answerText = context.answer || quickActions[quickAction]?.needsAnswer ? safeGetText() : '';
  inputEl.value = '';
  appendMessage({ role: 'user', content: quickAction ? (quickActions[quickAction]?.prompt || quickAction) + (text ? `\n\n추가 요청: ${text}` : '') : text, quickAction, ts: new Date().toISOString() });
  const el = appendMessage({ role: 'assistant', content: '', model: state.model });
  const content = el.querySelector('[data-content]');
  content.classList.add('typing');
  scrollBottom();
  let raw = '';
  let lastRender = 0;
  setBusy(true);
  abort = streamPost(
    `/api/chat/${scope.wb}/${scope.p}/stream`,
    { message: text, quickAction, provider: state.provider, model: state.model, context, answerText },
    {
      delta: (d) => {
        raw += d.text;
        const now = Date.now();
        if (now - lastRender > 120) { content.innerHTML = renderMarkdown(raw); lastRender = now; scrollBottom(); }
      },
      done: (d) => { finish(d.message.content, d.message); },
      error: (e) => { finish(raw ? raw + `\n\n❌ ${e.error}` : `❌ ${e.error}`, { model: state.model, error: true }); el.classList.add('msg-error'); },
      end: () => { if (abort) finish(raw || '(응답 없음)', { model: state.model }); },
    },
  );
  function finish(finalText, meta) {
    if (!abort) return;
    abort = null;
    setBusy(false);
    content.classList.remove('typing');
    content.innerHTML = renderMarkdown(finalText);
    el._raw = finalText;
    el.querySelector('.msg-meta').innerHTML = `<span>${escapeHtml(meta.model || '')}</span>${meta.usage ? `<span>토큰 ${meta.usage.input ?? '?'}→${meta.usage.output ?? '?'}</span>` : ''}<span>${fmtTime(new Date().toISOString())}</span>`;
    scrollBottom();
  }
}
function safeGetText() {
  try { return getText(); } catch { return ''; }
}
function setBusy(b) {
  root.querySelector('[data-send]').disabled = b;
  root.querySelector('[data-stop]').hidden = !b;
}
