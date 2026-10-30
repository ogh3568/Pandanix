// 프로바이더 레지스트리. 이름 → 인스턴스. 새 프로바이더 추가는 docs/dev/providers.md 참고.
import { PROVIDERS, loadCredentials, loadSettings } from '../config.js';
import { httpError } from '../lib/paths.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';
import { createGeminiProvider } from './gemini.js';

/**
 * 프로바이더 인스턴스를 만든다. 키가 없으면 400 오류.
 * @param {string} name  anthropic | openai | gemini | opencode | custom
 */
export function getProvider(name, { requireKey = true } = {}) {
  const def = PROVIDERS[name];
  if (!def) throw httpError(400, `알 수 없는 프로바이더: ${name}`);
  const creds = loadCredentials()[name] || {};
  const settings = loadSettings();
  if (requireKey && !creds.apiKey && !def.keyOptional) {
    throw httpError(400, `${def.label} API 키가 설정되지 않았습니다. 설정 화면에서 키를 입력하세요.`);
  }
  switch (def.kind) {
    case 'anthropic':
      return createAnthropicProvider(creds, settings);
    case 'gemini':
      return createGeminiProvider(creds);
    case 'openai':
      return createOpenAIProvider(name, creds, def.label);
    default:
      throw httpError(500, `프로바이더 종류 미구현: ${def.kind}`);
  }
}

/** 요청에 provider/model 이 없으면 설정의 기본값을 쓴다. */
export function resolveProviderAndModel(provider, model) {
  const settings = loadSettings();
  const p = provider || settings.defaultProvider;
  const m = model || settings.models?.[p] || PROVIDERS[p]?.defaultModel;
  if (!m) throw httpError(400, `${PROVIDERS[p]?.label || p} 의 모델이 지정되지 않았습니다. 설정에서 모델을 선택하세요.`);
  return { provider: p, model: m };
}

/**
 * 스트리밍 없이 전체 응답을 받는 편의 함수.
 */
export async function completeText({ provider, model, system, messages, maxTokens }, onDelta, signal) {
  const resolved = resolveProviderAndModel(provider, model);
  const p = getProvider(resolved.provider);
  return p.streamChat({ model: resolved.model, system, messages, maxTokens }, onDelta, signal);
}
