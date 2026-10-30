// 설정(settings.json)과 자격증명(credentials.json)의 기본값, 읽기/쓰기, 마스킹.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, FILES, readJson, writeJson, ensureDirs, httpError } from './lib/paths.js';

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
    /** 스트리밍이므로 넉넉히. Claude 5 세대는 thinking 토큰도 여기 포함된다. */
    maxOutputTokens: 32000,
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

/** 설정 패치 검증. 잘못되면 400 오류. */
export function validateSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, '설정은 객체여야 합니다.');
  if ('port' in patch) {
    const p = Number(patch.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw httpError(400, '포트는 1~65535 사이의 정수여야 합니다.');
    patch.port = p;
  }
  if ('defaultProvider' in patch && !PROVIDERS[patch.defaultProvider]) throw httpError(400, `알 수 없는 프로바이더: ${patch.defaultProvider}`);
  if ('models' in patch) {
    if (!patch.models || typeof patch.models !== 'object' || Array.isArray(patch.models)) throw httpError(400, 'models 는 객체여야 합니다.');
    for (const [k, v] of Object.entries(patch.models)) {
      if (!PROVIDERS[k]) throw httpError(400, `알 수 없는 프로바이더: ${k}`);
      if (typeof v !== 'string') throw httpError(400, `${k} 모델 ID 는 문자열이어야 합니다.`);
      patch.models[k] = v.trim();
    }
  }
  if ('allowedRoots' in patch) {
    if (!Array.isArray(patch.allowedRoots)) throw httpError(400, 'allowedRoots 는 폴더 경로 배열이어야 합니다.');
    patch.allowedRoots = patch.allowedRoots.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    for (const r of patch.allowedRoots) {
      if (!path.isAbsolute(r)) throw httpError(400, `절대 경로여야 합니다: ${r}`);
      if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw httpError(400, `존재하지 않는 폴더: ${r}`);
    }
  }
  if (patch.chat) {
    if (typeof patch.chat !== 'object') throw httpError(400, 'chat 설정이 잘못되었습니다.');
    for (const k of ['maxOutputTokens', 'maxReferenceChars']) {
      if (k in patch.chat) {
        const n = Number(patch.chat[k]);
        if (!Number.isInteger(n) || n < (k === 'maxOutputTokens' ? 256 : 1000) || n > 2000000) throw httpError(400, `${k} 값이 범위를 벗어났습니다.`);
        patch.chat[k] = n;
      }
    }
    for (const k of ['includeProblem', 'includeReferences', 'includeAnswer']) if (k in patch.chat) patch.chat[k] = Boolean(patch.chat[k]);
  }
  if (patch.editor && 'autosaveMs' in patch.editor) {
    const n = Number(patch.editor.autosaveMs);
    if (!Number.isInteger(n) || n < 300 || n > 600000) throw httpError(400, '자동 저장 간격은 300~600000ms 사이여야 합니다.');
    patch.editor.autosaveMs = n;
  }
  if (patch.anthropic && 'fallbacks' in patch.anthropic) patch.anthropic.fallbacks = Boolean(patch.anthropic.fallbacks);
  return patch;
}

export function saveSettings(patch) {
  validateSettingsPatch(patch);
  const current = loadSettings();
  const next = deepMerge(current, patch);
  if (Array.isArray(patch.allowedRoots)) next.allowedRoots = patch.allowedRoots; // 배열은 교체
  writeJson(FILES.settings, next);
  return next;
}

/** 실제 접근 허용 루트 = 데이터 폴더 + 사용자가 추가한 폴더 */
export function getAllowedRoots(settings = loadSettings()) {
  const extra = Array.isArray(settings.allowedRoots) ? settings.allowedRoots.filter((r) => typeof r === 'string' && r.trim()) : [];
  return [DIRS.data, ...extra];
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
