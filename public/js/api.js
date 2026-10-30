// 서버 API 호출 모듈. 모든 fetch 는 여기서만 한다. (엔드포인트 목록: docs/dev/api.md)

export const OFFLINE_MESSAGE = '서버에 연결할 수 없습니다. 검은 서버 창이 닫혔는지 확인하고 start.bat 을 다시 실행하세요.';

/** 서버 연결 상태 (editor 의 저장 실패 표시, 상단 배너 등에서 참조) */
export const connection = { online: true, listeners: new Set(), set(v) { if (this.online !== v) { this.online = v; this.listeners.forEach((fn) => fn(v)); } } };

async function request(method, url, body, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
    });
  } catch (err) {
    connection.set(false);
    const e = new Error(OFFLINE_MESSAGE);
    e.offline = true;
    throw e;
  }
  connection.set(true);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (data && data.error) || (typeof data === 'string' ? data : `HTTP ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),

  // 설정
  settings: () => request('GET', '/api/settings'),
  saveSettings: (patch) => request('PUT', '/api/settings', patch),
  saveCredentials: (patch) => request('PUT', '/api/credentials', patch),
  testProvider: (name) => request('POST', `/api/providers/${name}/test`, {}),
  listModels: (name) => request('GET', `/api/providers/${name}/models`),
  doctor: (live) => request('GET', `/api/doctor${live ? '?live=1' : ''}`),

  // 문제집
  workbooks: () => request('GET', '/api/workbooks'),
  workbook: (wb) => request('GET', `/api/workbooks/${wb}`),
  createWorkbook: (data) => request('POST', '/api/workbooks', data),
  updateWorkbook: (wb, data) => request('PUT', `/api/workbooks/${wb}`, data),
  deleteWorkbook: (wb) => request('DELETE', `/api/workbooks/${wb}`),
  importWorkbook: (path) => request('POST', '/api/workbooks/import', { path }),
  library: () => request('GET', '/api/library'),
  installLibrary: (slug, force = false) => request('POST', `/api/library/${slug}/install`, { force }),
  exportWorkbook: (wb, path) => request('POST', `/api/workbooks/${wb}/export`, { path }),
  problem: (wb, p) => request('GET', `/api/workbooks/${wb}/problems/${p}`),
  createProblem: (wb, data) => request('POST', `/api/workbooks/${wb}/problems`, data),
  updateProblem: (wb, p, data) => request('PUT', `/api/workbooks/${wb}/problems/${p}`, data),
  deleteProblem: (wb, p) => request('DELETE', `/api/workbooks/${wb}/problems/${p}`),
  addReference: (wb, p, data) => request('POST', `/api/workbooks/${wb}/problems/${p}/references`, data),
  addReferenceFromPath: (wb, p, path, description) => request('POST', `/api/workbooks/${wb}/problems/${p}/references/from-path`, { path, description }),
  deleteReference: (wb, p, file) => request('DELETE', `/api/workbooks/${wb}/problems/${p}/references/${encodeURIComponent(file)}`),
  referenceText: async (wb, p, file) => {
    const res = await fetch(`/api/workbooks/${wb}/problems/${p}/references/${encodeURIComponent(file)}?text=1`);
    if (!res.ok) throw new Error(`참고자료를 읽을 수 없습니다 (HTTP ${res.status})`);
    return res.text();
  },
  referenceUrl: (wb, p, file, download) => `/api/workbooks/${wb}/problems/${p}/references/${encodeURIComponent(file)}${download ? '?download=1' : ''}`,

  // 답안
  answer: (wb, p) => request('GET', `/api/answers/${wb}/${p}`),
  saveAnswer: (wb, p, data) => request('PUT', `/api/answers/${wb}/${p}`, data),
  answerHistory: (wb, p) => request('GET', `/api/answers/${wb}/${p}/history`),
  answerHistoryItem: (wb, p, file) => request('GET', `/api/answers/${wb}/${p}/history/${encodeURIComponent(file)}`),
  uploadAttachment: (wb, p, fileName, contentBase64) => request('POST', `/api/answers/${wb}/${p}/attachments`, { fileName, contentBase64 }),
  deleteAttachment: (wb, p, file) => request('DELETE', `/api/answers/${wb}/${p}/attachments/${encodeURIComponent(file)}`),
  attachmentUrl: (wb, p, file) => `/api/answers/${wb}/${p}/attachments/${encodeURIComponent(file)}`,
  exportAnswer: (wb, p, data) => request('POST', `/api/answers/${wb}/${p}/export`, data),
  /** 내보내기 결과를 파일 본문(Blob)으로 받는다 (다운로드/클립보드용) */
  exportAnswerBlob: async (wb, p, format) => {
    const res = await fetch(`/api/answers/${wb}/${p}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.blob();
  },
  answersStatus: () => request('GET', '/api/answers-status'),

  // 채팅
  chat: (wb, p) => request('GET', `/api/chat/${wb}/${p}`),
  clearChat: (wb, p) => request('DELETE', `/api/chat/${wb}/${p}`),
  quickActions: () => request('GET', '/api/chat-quick-actions'),

  // 파일
  fsRoots: () => request('GET', '/api/fs/roots'),
  fsList: (path) => request('GET', `/api/fs/list?path=${encodeURIComponent(path)}`),
  fsRead: (path) => request('GET', `/api/fs/read?path=${encodeURIComponent(path)}`),
  fsWrite: (path, content, overwrite = true) => request('POST', '/api/fs/write', { path, content, overwrite }),
  fsMkdir: (path) => request('POST', '/api/fs/mkdir', { path }),
  fsDelete: (path) => request('POST', '/api/fs/delete', { path }),
  fsOpen: (path) => request('POST', '/api/fs/open', { path }),
};

/**
 * POST 로 SSE 스트림을 받는다. (EventSource 는 GET 만 가능하므로 fetch + ReadableStream 사용)
 * handlers: { meta, delta, progress, done, error }
 * 반환: abort() 함수
 */
export function streamPost(url, body, handlers = {}) {
  const ctrl = new AbortController();
  (async () => {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      if (ctrl.signal.aborted) return handlers.abort?.();
      connection.set(false);
      handlers.error?.({ error: OFFLINE_MESSAGE });
      return;
    }
    connection.set(true);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {}
      handlers.error?.({ error: msg });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // 연결 감시: 서버는 15초마다 하트비트(: ping)를 보낸다. 90초 동안 아무것도 안 오면 끊긴 것으로 본다 (절전 모드 복귀 등).
    let lastActivity = Date.now();
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > 90000) {
        clearInterval(idleTimer);
        ctrl.abort();
        handlers.error?.({ error: '서버와의 연결이 끊겼습니다 (90초 무응답). 다시 시도하세요.' });
      }
    }, 5000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lastActivity = Date.now();
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            handlers[event]?.(JSON.parse(data));
          } catch (e) {
            console.warn('SSE parse error', e);
          }
        }
      }
      clearInterval(idleTimer);
      handlers.end?.();
    } catch (err) {
      clearInterval(idleTimer);
      if (ctrl.signal.aborted) handlers.abort?.();
      else handlers.error?.({ error: err.message });
    }
  })();
  return () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
  };
}

/** 업로드 가능 최대 크기 (서버 본문 80MB 제한, base64 팽창 고려) */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function fileToBase64(file) {
  if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new Error(`${file.name}: 파일이 너무 큽니다 (최대 50MB).`));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
