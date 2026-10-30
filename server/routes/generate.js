import { Router } from 'express';
import * as store from '../lib/store.js';
import { buildWorkbookGenerationPrompt, extractJson } from '../lib/prompt.js';
import { getProvider, resolveProviderAndModel } from '../providers/index.js';
import { openSse } from '../lib/sse.js';
import { wrap } from '../lib/async.js';
import { httpError } from '../lib/paths.js';
import { createStallWatchdog } from '../lib/watchdog.js';

export const generateRouter = Router();

/**
 * AI 로 문제집 만들기 (SSE).
 * body: { topic, count, difficulty, audience, extra, provider, model, workbookId? (기존 문제집에 문제 추가) }
 * events: meta → progress {chars} → done {workbook} | error
 */
generateRouter.post(
  '/generate/workbook',
  wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.topic || !String(body.topic).trim()) throw httpError(400, '주제를 입력하세요.');
    const count = Math.min(Math.max(Number(body.count) || 3, 1), 10);
    if (body.workbookId) store.getWorkbook(String(body.workbookId)); // 없는 문제집이면 토큰 쓰기 전에 404
    const { provider, model } = resolveProviderAndModel(body.provider, body.model);
    const providerImpl = getProvider(provider);
    const { system, user } = buildWorkbookGenerationPrompt({ ...body, count });

    const sse = openSse(res);
    sse.send('meta', { provider, model });
    const abort = new AbortController();
    // 주의: req 'close' 는 본문 수신 직후에도 발생하므로 res 쪽을 봐야 한다.
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    let chars = 0;
    let lastSent = 0;
    let stallMessage = null;
    const watchdog = createStallWatchdog(abort, (msg) => { stallMessage = msg; });
    try {
      const result = await providerImpl.streamChat(
        { model, system, messages: [{ role: 'user', content: user }], maxTokens: 32000 },
        (delta) => {
          chars += delta.length;
          watchdog.touch();
          if (chars - lastSent > 200) {
            lastSent = chars;
            sse.send('progress', { chars });
          }
        },
        abort.signal,
      );
      watchdog.stop();
      if (stallMessage) throw new Error(stallMessage);
      if (result.stopReason === 'refusal') throw new Error('모델이 생성을 거부했습니다. 주제를 바꿔 보세요.');
      if (result.stopReason === 'max_tokens' || result.stopReason === 'length') throw new Error(`출력 길이 제한(${32000} 토큰)에 걸려 생성이 끊겼습니다. 문제 수를 줄이거나 참고자료 분량을 줄이도록 "추가 요구사항" 에 적어 보세요.`);
      const data = extractJson(result.text);
      const wb = saveGenerated(data, body.workbookId, { provider, model });
      sse.send('done', { workbook: wb, chars });
    } catch (err) {
      watchdog.stop();
      if (stallMessage || !abort.signal.aborted) sse.send('error', { error: stallMessage || err.message || String(err) });
    } finally {
      sse.close();
    }
  }),
);

function saveGenerated(data, existingWorkbookId, meta) {
  if (!Array.isArray(data.problems) || !data.problems.length) throw new Error('생성 결과에 problems 가 없습니다.');
  const wb = existingWorkbookId
    ? store.getWorkbook(existingWorkbookId)
    : store.createWorkbook({ title: data.title || '제목 없음', description: data.description || '', category: data.category || '', difficulty: data.difficulty || '', source: 'ai' });
  if (!existingWorkbookId) store.updateWorkbook(wb.id, { description: (data.description || '') + `\n\n_AI 생성: ${meta.provider}/${meta.model}_` });
  for (const prob of data.problems) {
    const p = store.createProblem(wb.id, {
      title: prob.title || '제목 없음',
      prompt: prob.prompt || '',
      submission: prob.submission || {},
      hints: prob.hints || [],
      rubric: prob.rubric || [],
      tags: prob.tags || [],
      difficulty: prob.difficulty || data.difficulty || '',
      estimatedMinutes: prob.estimatedMinutes || null,
    });
    for (const ref of prob.references || []) {
      if (!ref || !ref.content) continue;
      const file = ref.file || `${ref.name || 'reference'}.md`;
      store.addReferenceFile(wb.id, p.id, { fileName: file, buffer: Buffer.from(String(ref.content), 'utf8'), description: ref.description || '', name: ref.name || file });
    }
  }
  return store.getWorkbook(wb.id);
}
