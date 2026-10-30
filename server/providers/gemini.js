// Google Gemini 프로바이더 - 공식 @google/genai SDK 사용.
import { GoogleGenAI } from '@google/genai';

export function createGeminiProvider({ apiKey }) {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20 * 60 * 1000 } });

  async function streamChat({ model, system, messages, maxTokens = 16000 }, onDelta, signal) {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          maxOutputTokens: maxTokens,
          abortSignal: signal,
        },
      });
      let text = '';
      let finish = null;
      let usage = null;
      let blocked = null;
      for await (const chunk of stream) {
        let t = '';
        try { t = chunk.text || ''; } catch { t = ''; }
        if (t) {
          text += t;
          onDelta?.(t);
        }
        const cand = chunk.candidates?.[0];
        if (cand?.finishReason) finish = cand.finishReason;
        if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
        if (chunk.usageMetadata)
          usage = { input: chunk.usageMetadata.promptTokenCount, output: chunk.usageMetadata.candidatesTokenCount };
      }
      return { text, stopReason: mapFinish(finish, blocked), usage, model };
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async function listModels() {
    const out = [];
    try {
      const pager = await ai.models.list();
      for await (const m of pager) {
        const id = (m.name || '').replace(/^models\//, '');
        if (!id) continue;
        const actions = m.supportedActions || [];
        if (actions.length && !actions.includes('generateContent')) continue;
        out.push({ id, label: m.displayName || id });
      }
    } catch (err) {
      throw normalizeError(err);
    }
    return out;
  }

  async function ping() {
    const models = await listModels();
    return { ok: true, detail: `모델 ${models.length}개 조회됨` };
  }

  return { name: 'gemini', streamChat, listModels, ping };
}

/** Gemini finishReason/blockReason → 공통 stopReason */
function mapFinish(finish, blocked) {
  if (blocked) return 'refusal';
  if (!finish || finish === 'STOP') return 'end_turn';
  if (finish === 'MAX_TOKENS') return 'max_tokens';
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finish)) return 'refusal';
  return String(finish).toLowerCase();
}

function normalizeError(err) {
  const raw = String(err?.message || err);
  let msg;
  if (/API key not valid|API_KEY_INVALID|401/.test(raw)) msg = 'Gemini API 키가 잘못되었습니다.';
  else if (/PERMISSION_DENIED|403/.test(raw)) msg = 'Gemini: 접근 거부. API 활성화/권한을 확인하세요. (403)';
  else if (/NOT_FOUND|404/.test(raw)) msg = 'Gemini: 모델을 찾을 수 없습니다. 모델 ID 를 확인하세요. (404)';
  else if (/RESOURCE_EXHAUSTED|429/.test(raw)) msg = 'Gemini: 요청 한도 초과. (429)';
  else msg = `Gemini 오류: ${raw}`;
  const e = new Error(msg);
  e.status = err?.status || 502;
  e.cause = err;
  return e;
}
