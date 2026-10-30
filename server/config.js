// 설정(settings.json)과 자격증명(credentials.json)의 기본값, 읽기/쓰기, 마스킹.
import fs from 'node:fs';
import { DIRS, FILES, readJson, writeJson, ensureDirs } from './lib/paths.js';

/** 지원 프로바이더 정의. 새 프로바이더 추가 방법은 docs/dev/providers.md 참고 */
export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    fields: ['apiKey'],
  },
  openai: {
    label: 'GPT (OpenAI)',
    kind: 'openai',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5',
    defaultBaseUrl: '',
    keyUrl: 'https://platform.openai.com/api-keys',
    fields: ['apiKey', 'baseUrl', 'organization'],
  },
  gemini: {
    label: 'Gemini (Google)',
    kind: 'gemini',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-pro',
    keyUrl: 'https://aistudio.google.com/apikey',
    fields: ['apiKey'],
  },
  opencode: {
    label: 'OpenCode Zen',
    kind: 'openai', // OpenAI 호환 엔드포인트
    envKey: 'OPENCODE_API_KEY',
    defaultModel: '',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    keyUrl: 'https://opencode.ai/zen',
    fields: ['apiKey', 'baseUrl'],
  },
  custom: {
    label: '사용자 정의 (OpenAI 호환)',
    kind: 'openai',
    envKey: 'CUSTOM_API_KEY',
    defaultModel: '',
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyUrl: '',
    fields: ['apiKey', 'baseUrl'],
    note: 'Ollama, LM Studio, vLLM 등 OpenAI 호환 서버',
    /** 키 없이도 동작하는 로컬 서버용. UI 경고·doctor 실패·키 검사에서 제외된다. */
    keyOptional: true,
  },
};

export const DEFAULT_SETTINGS = {
  port: 3210,
  defaultProvider: 'anthropic',
  models: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.defaultModel])),
  /** 파일 탐색기/내보내기에서 접근을 허용할 폴더 목록. 데이터 폴더는 항상 포함된다. */
  allowedRoots: [],
  chat: {
    maxOutputTokens: 16000,
    includeProblem: true,
    includeReferences: true,
    includeAnswer: false,
    /** 참고자료 텍스트를 프롬프트에 넣을 때 최대 글자 수 */
    maxReferenceChars: 120000,
  },
  anthropic: {
    /** 안전 분류기 거부 시 서버측 대체 모델 사용 (server-side fallbacks) */
    fallbacks: true,
  },
  editor: {
    autosaveMs: 1500,
  },
};

export const DEFAULT_CREDENTIALS = {
  _comment: 'API 키를 여기에 입력하세요. 이 파일은 .gitignore 에 포함되어 있습니다. 환경변수(ANTHROPIC_API_KEY 등)가 설정되어 있으면 환경변수가 우선합니다.',
  anthropic: { apiKey: '' },
  openai: { apiKey: '', baseUrl: '', organization: '' },
  gemini: { apiKey: '' },
  opencode: { apiKey: '', baseUrl: 'https://opencode.ai/zen/v1' },
  custom: { apiKey: '', baseUrl: 'http://localhost:11434/v1' },
};

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

/** 첫 실행 시 설정/자격증명 파일을 만든다. */
export function initConfigFiles() {
  ensureDirs();
  if (!fs.existsSync(FILES.settings)) writeJson(FILES.settings, DEFAULT_SETTINGS);
  if (!fs.existsSync(FILES.credentials)) writeJson(FILES.credentials, DEFAULT_CREDENTIALS);
  if (!fs.existsSync(FILES.credentialsExample)) writeJson(FILES.credentialsExample, DEFAULT_CREDENTIALS);
}

export function loadSettings() {
  const raw = readJson(FILES.settings, {});
  const merged = deepMerge(DEFAULT_SETTINGS, raw);
  return merged;
}

export function saveSettings(patch) {
  const current = loadSettings();
  const next = deepMerge(current, patch);
  // allowedRoots 는 배열 교체
  if (Array.isArray(patch.allowedRoots)) next.allowedRoots = patch.allowedRoots.filter((s) => typeof s === 'string' && s.trim());
  writeJson(FILES.settings, next);
  return next;
}

/** 실제 접근 허용 루트 = 데이터 폴더 + 사용자가 추가한 폴더 */
export function getAllowedRoots(settings = loadSettings()) {
  return [DIRS.data, ...(settings.allowedRoots || [])];
}

/** 파일 값에 환경변수를 덮어쓴 "실효" 자격증명 */
export function loadCredentials() {
  const raw = readJson(FILES.credentials, {});
  const merged = deepMerge(DEFAULT_CREDENTIALS, raw);
  for (const [name, def] of Object.entries(PROVIDERS)) {
    const envVal = process.env[def.envKey] || (name === 'gemini' ? process.env.GOOGLE_API_KEY : '');
    merged[name] = merged[name] || {};
    merged[name]._source = 'file';
    if (envVal) {
      merged[name].apiKey = envVal;
      merged[name]._source = 'env';
    }
    if (!merged[name].baseUrl && def.defaultBaseUrl) merged[name].baseUrl = def.defaultBaseUrl;
  }
  return merged;
}

/** UI 로 보낼 때: 키는 마스킹하고 설정 여부만 알려준다. */
export function maskedCredentials() {
  const creds = loadCredentials();
  const out = {};
  for (const [name, def] of Object.entries(PROVIDERS)) {
    const c = creds[name] || {};
    out[name] = {
      configured: Boolean(c.apiKey),
      source: c.apiKey ? c._source : null,
      apiKeyMasked: maskKey(c.apiKey),
      baseUrl: c.baseUrl || '',
      organization: c.organization || '',
      fields: def.fields,
      label: def.label,
      keyUrl: def.keyUrl,
      note: def.note || '',
      kind: def.kind,
    };
  }
  return out;
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '…' + key.slice(-4);
}

/**
 * 자격증명 저장. apiKey 가 빈 문자열이면 유지(변경 안 함), "__CLEAR__" 면 삭제.
 */
export function saveCredentials(patch) {
  const raw = readJson(FILES.credentials, {});
  const next = deepMerge(DEFAULT_CREDENTIALS, raw);
  for (const [name, values] of Object.entries(patch || {})) {
    if (!PROVIDERS[name] || !values || typeof values !== 'object') continue;
    next[name] = next[name] || {};
    for (const field of PROVIDERS[name].fields) {
      if (!(field in values)) continue;
      const v = values[field];
      if (field === 'apiKey') {
        if (v === '__CLEAR__') next[name].apiKey = '';
        else if (typeof v === 'string' && v.trim()) next[name].apiKey = v.trim();
      } else if (typeof v === 'string') {
        next[name][field] = v.trim();
      }
    }
  }
  writeJson(FILES.credentials, next);
  return maskedCredentials();
}
