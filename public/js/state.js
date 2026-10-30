// 앱 전역 상태 + 간단한 이벤트 버스.
const listeners = new Map();

export const state = {
  settings: null,        // GET /api/settings 결과
  workbooks: [],         // 문제집 목록(요약)
  currentWorkbook: null, // 선택된 문제집(요약)
  currentProblem: null,  // 선택된 문제(상세)
  answer: null,          // 현재 답안
  provider: null,        // 상단바에서 선택한 프로바이더
  model: null,           // 상단바에서 선택한 모델
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[event:${event}]`, err);
    }
  }
}

/** localStorage 에 UI 상태(마지막 문제, 패널 너비 등) 저장 */
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('pandanix:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('pandanix:' + key, JSON.stringify(value));
    } catch {}
  },
};
