import { Router } from 'express';
import * as store from '../lib/store.js';
import { buildSystemPrompt, QUICK_ACTIONS } from '../lib/prompt.js';
import { getProvider, resolveProviderAndModel } from '../providers/index.js';
import { openSse } from '../lib/sse.js';
import { wrap } from '../lib/async.js';
import { loadSettings } from '../config.js';
import { httpError } from '../lib/paths.js';

export const chatRouter = Router();

const scope = (req) => ({ wb: req.params.wb || 'general', p: req.params.p || 'general' });

chatRouter.get('/chat/:wb/:p', (req, res) => {
  const { wb, p } = scope(req);
  res.json(store.getChat(wb, p));
});

chatRouter.delete('/chat/:wb/:p', (req, res) => {
  const { wb, p } = scope(req);
  store.clearChat(wb, p);
  res.json({ ok: true });
});

chatRouter.get('/chat-quick-actions', (req, res) => res.json(QUICK_ACTIONS));

/**
 * 스트리밍 채팅 (SSE).
 * body: { message, quickAction?, provider?, model?, context?: {problem, references, answer}, answerText?, maxHistory? }
 * events: meta {provider, model} → delta {text}* → done {message} | error {error}
 */
chatRouter.post(
  '/chat/:wb/:p/stream',
  wrap(async (req, res) => {
    const { wb, p } = scope(req);
    const body = req.body || {};
    const settings = loadSettings();
    let userText = String(body.message || '').trim();
    const qa = body.quickAction ? QUICK_ACTIONS[body.quickAction] : null;
    if (qa) userText = qa.prompt + (userText ? `\n\n추가 요청: ${userText}` : '');
    if (!userText) throw httpError(400, '메시지가 비어 있습니다.');
    if (userText.length > 200000) throw httpError(413, '메시지가 너무 깁니다 (20만 자 제한). 긴 자료는 참고자료로 올리세요.');
    if (!(wb === 'general' && p === 'general')) store.getProblem(wb, p); // 없는 문제면 404

    const { provider, model } = resolveProviderAndModel(body.provider, body.model);
    const providerImpl = getProvider(provider); // 키 없으면 여기서 400 (SSE 열기 전)

    // 기본값은 설정(include*), 요청 body.context 가 있으면 덮어쓴다
    const context = {
      problem: settings.chat.includeProblem !== false,
      references: settings.chat.includeReferences !== false,
      answer: Boolean(settings.chat.includeAnswer),
      ...(body.context || {}),
    };
    if (qa?.needsAnswer) context.answer = true;
    const system = buildSystemPrompt({ workbookId: wb, problemId: p, context, answerText: body.answerText || '' });

    // 오류·중단·빈 응답은 모델에 다시 보내지 않는다 (Anthropic 은 빈 content 를 400 으로 거부)
    const history = store
      .getChat(wb, p)
      .messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error && !m.aborted && typeof m.content === 'string' && m.content.trim());
    const maxHistory = Math.min(Math.max(Number.parseInt(body.maxHistory, 10) || 30, 0), 200);
    const trimmed = history.slice(-maxHistory);
    while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift(); // 대화는 user 로 시작해야 한다
    const messages = [...trimmed.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userText }];

    store.appendChat(wb, p, { role: 'user', content: userText, quickAction: body.quickAction || null });

    const sse = openSse(res);
    sse.send('meta', { provider, model });
    const abort = new AbortController();
    // 주의: req 'close' 는 본문 수신 직후에도 발생하므로 res 쪽을 봐야 한다.
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    let partial = ''; // 중단 시에도 받은 만큼은 보존한다 (프로바이더마다 중단 동작이 달라 라우트에서 통일)
    const saveAborted = () => {
      try {
        store.appendChat(wb, p, { role: 'assistant', content: partial ? partial + '\n\n(사용자가 중단함)' : '(사용자가 중단함)', provider, model, aborted: true });
      } catch {}
    };
    try {
      const result = await providerImpl.streamChat(
        { model, system, messages, maxTokens: settings.chat.maxOutputTokens },
        (delta) => {
          partial += delta;
          sse.send('delta', { text: delta });
        },
        abort.signal,
      );
      if (abort.signal.aborted) return saveAborted();
      let content = result.text;
      if (result.stopReason === 'refusal') content = (content ? content + '\n\n' : '') + '⚠️ 모델이 이 요청에 대한 응답을 거부했습니다. 질문을 바꿔 보세요.';
      else if (result.stopReason === 'max_tokens' || result.stopReason === 'length') content += '\n\n…(출력 길이 제한에 도달했습니다. "계속" 이라고 입력하면 이어서 씁니다.)';
      else if (!content.trim()) content = '(모델이 빈 응답을 돌려주었습니다. 다시 시도해 보세요.)';
      const saved = { role: 'assistant', content, provider, model: result.model || model, usage: result.usage || null, stopReason: result.stopReason || null, ...(content.trim() ? {} : { error: true }) };
      store.appendChat(wb, p, saved);
      sse.send('done', { message: saved });
    } catch (err) {
      if (abort.signal.aborted) saveAborted();
      else {
        const msg = err.message || String(err);
        try { store.appendChat(wb, p, { role: 'assistant', content: `❌ 오류: ${msg}`, provider, model, error: true }); } catch {}
        sse.send('error', { error: msg });
      }
    } finally {
      sse.close();
    }
  }),
);
