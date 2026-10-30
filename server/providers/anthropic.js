// Anthropic(Claude) 프로바이더 - 공식 SDK 사용.
import Anthropic from '@anthropic-ai/sdk';

/** 서버측 대체(fallbacks)를 지원하는 모델 패턴 (Claude 5 세대) */
const FALLBACK_CAPABLE = /^claude-(opus-5|sonnet-5-5|fable-5)/;

export function createAnthropicProvider({ apiKey, baseUrl }, settings = {}) {
  // timeout: 긴 보고서 생성에 대비해 20분 (SDK 기본 10분). 재시도는 연결 오류·429·5xx 에만 적용된다.
  const client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}), maxRetries: 2, timeout: 20 * 60 * 1000 });
  const useFallbacks = settings?.anthropic?.fallbacks !== false;

  async function streamChat({ model, system, messages, maxTokens = 16000 }, onDelta, signal) {
    const params = {
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    const wantFallbacks = useFallbacks && FALLBACK_CAPABLE.test(model);

    const run = async (withFallbacks) => {
      const stream = withFallbacks
        ? client.beta.messages.stream(
            { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
            { signal },
          )
        : client.messages.stream(params, { signal });
      let text = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          onDelta?.(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      return {
        text,
        stopReason: final.stop_reason,
        stopDetails: final.stop_details || null,
        usage: final.usage ? { input: final.usage.input_tokens, output: final.usage.output_tokens } : null,
        model: final.model,
      };
    };

    try {
      return await run(wantFallbacks);
    } catch (err) {
      // fallbacks 파라미터를 거부하는 환경(프록시/구형 모델)이면 한 번 더 시도
      if (wantFallbacks && err?.status === 400 && /fallback|beta/i.test(String(err.message))) {
        return await run(false);
      }
      throw normalizeError(err);
    }
  }

  async function listModels() {
    const out = [];
    for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name || m.id });
    return out;
  }

  async function ping() {
    const models = await listModels();
    return { ok: true, detail: `모델 ${models.length}개 조회됨` };
  }

  return { name: 'anthropic', streamChat, listModels, ping };
}

function normalizeError(err) {
  const e = new Error(friendlyMessage(err));
  e.status = err?.status || 502;
  e.cause = err;
  return e;
}

function friendlyMessage(err) {
  const status = err?.status;
  if (status === 401) return 'Anthropic API 키가 잘못되었거나 만료되었습니다. (401)';
  if (status === 403) return 'Anthropic API 접근이 거부되었습니다. 계정 권한/결제 상태를 확인하세요. (403)';
  if (status === 404) return 'Anthropic: 모델을 찾을 수 없습니다. 설정에서 모델 ID 를 확인하세요. (404)';
  if (status === 429) return 'Anthropic: 요청 한도 초과. 잠시 후 다시 시도하세요. (429)';
  if (status === 529 || status >= 500) return `Anthropic 서버 오류 (${status}). 잠시 후 다시 시도하세요.`;
  return `Anthropic 오류: ${err?.message || err}`;
}
