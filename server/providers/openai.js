// OpenAI 및 OpenAI 호환 엔드포인트(OpenCode Zen, Ollama, LM Studio 등) 프로바이더.
import OpenAI from 'openai';

export function createOpenAIProvider(name, { apiKey, baseUrl, organization }) {
  const client = new OpenAI({
    apiKey: apiKey || 'not-set',
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(organization ? { organization } : {}),
    maxRetries: 2,
  });

  async function streamChat({ model, system, messages, maxTokens = 16000 }, onDelta, signal) {
    const chatMessages = [];
    if (system) chatMessages.push({ role: 'system', content: system });
    for (const m of messages) chatMessages.push({ role: m.role, content: m.content });

    try {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: chatMessages,
          stream: true,
          max_completion_tokens: maxTokens,
          stream_options: { include_usage: true },
        },
        { signal },
      );
      let text = '';
      let finish = null;
      let usage = null;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      }
      return { text, stopReason: mapFinish(finish), usage, model };
    } catch (err) {
      // 일부 호환 서버는 max_completion_tokens / stream_options 를 모른다 → 단순 형태로 재시도
      if (err?.status === 400 && /max_completion_tokens|stream_options|unrecognized|unknown parameter/i.test(String(err.message))) {
        try {
          const stream = await client.chat.completions.create({ model, messages: chatMessages, stream: true, max_tokens: maxTokens }, { signal });
          let text = '';
          let finish = null;
          for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) {
              text += delta;
              onDelta?.(delta);
            }
            if (choice?.finish_reason) finish = choice.finish_reason;
          }
          return { text, stopReason: mapFinish(finish), usage: null, model };
        } catch (err2) {
          throw normalizeError(name, err2);
        }
      }
      throw normalizeError(name, err);
    }
  }

  async function listModels() {
    const out = [];
    try {
      for await (const m of client.models.list()) out.push({ id: m.id, label: m.id });
    } catch (err) {
      throw normalizeError(name, err);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  async function ping() {
    const models = await listModels();
    return { ok: true, detail: `모델 ${models.length}개 조회됨` };
  }

  return { name, streamChat, listModels, ping };
}

/** OpenAI finish_reason → 공통 stopReason (end_turn | max_tokens | refusal | 기타 원문) */
function mapFinish(reason) {
  if (!reason || reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return reason;
}

function normalizeError(name, err) {
  const status = err?.status;
  let msg;
  if (err instanceof OpenAI.APIConnectionError || err?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed|ENOTFOUND|Connection error/i.test(String(err?.message)))
    msg = `${name}: 서버에 연결할 수 없습니다. Base URL 과 서버 실행 여부, 네트워크(프록시)를 확인하세요.`;
  else if (status === 401) msg = `${name}: API 키가 잘못되었습니다. (401)`;
  else if (status === 403) msg = `${name}: 접근 거부. 권한/요금제를 확인하세요. (403)`;
  else if (status === 404) msg = `${name}: 모델 또는 엔드포인트를 찾을 수 없습니다. 모델 ID 와 Base URL 을 확인하세요. (404)`;
  else if (status === 429) msg = `${name}: 요청 한도 초과 또는 크레딧 부족. (429)`;
  else msg = `${name} 오류: ${err?.message || err}`;
  const e = new Error(msg);
  e.status = status || 502;
  e.cause = err;
  return e;
}
