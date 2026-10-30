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

    const history = store.getChat(wb, p).messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const maxHistory = Number(body.maxHistory || 30);
    const messages = [...history.slice(-maxHistory).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userText }];

    store.appendChat(wb, p, { role: 'user', content: userText, quickAction: body.quickAction || null });

    const sse = openSse(res);
    sse.send('meta', { provider, model });
    const abort = new AbortController();
    // 주의: req 'close' 는 본문 수신 직후에도 발생하므로 res 쪽을 봐야 한다.
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    try {
      const result = await providerImpl.streamChat(
        { model, system, messages, maxTokens: settings.chat.maxOutputTokens },
        (delta) => sse.send('delta', { text: delta }),
        abort.signal,
      );
      let content = result.text;
      if (result.stopReason === 'refusal') content = (content ? content + '\n\n' : '') + '⚠️ 모델이 이 요청에 대한 응답을 거부했습니다. 질문을 바꿔 보세요.';
      if (result.stopReason === 'max_tokens' || result.stopReason === 'length') content += '\n\n…(출력 길이 제한에 도달했습니다. "계속" 이라고 입력하면 이어서 씁니다.)';
      const saved = { role: 'assistant', content, provider, model: result.model || model, usage: result.usage || null, stopReason: result.stopReason || null };
      store.appendChat(wb, p, saved);
      sse.send('done', { message: saved });
    } catch (err) {
      if (abort.signal.aborted) {
        store.appendChat(wb, p, { role: 'assistant', content: '(사용자가 중단함)', provider, model, aborted: true });
      } else {
        const msg = err.message || String(err);
        store.appendChat(wb, p, { role: 'assistant', content: `❌ 오류: ${msg}`, provider, model, error: true });
        sse.send('error', { error: msg });
      }
    } finally {
      sse.close();
    }
  }),
);
