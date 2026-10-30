// 서버 API 호출 모듈. 모든 fetch 는 여기서만 한다. (엔드포인트 목록: docs/dev/api.md)

async function request(method, url, body, opts = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
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
  exportWorkbook: (wb, path) => request('POST', `/api/workbooks/${wb}/export`, { path }),
  problem: (wb, p) => request('GET', `/api/workbooks/${wb}/problems/${p}`),
  createProblem: (wb, data) => request('POST', `/api/workbooks/${wb}/problems`, data),
  updateProblem: (wb, p, data) => request('PUT', `/api/workbooks/${wb}/problems/${p}`, data),
  deleteProblem: (wb, p) => request('DELETE', `/api/workbooks/${wb}/problems/${p}`),
  addReference: (wb, p, data) => request('POST', `/api/workbooks/${wb}/problems/${p}/references`, data),
  addReferenceFromPath: (wb, p, path, description) => request('POST', `/api/workbooks/${wb}/problems/${p}/references/from-path`, { path, description }),
  deleteReference: (wb, p, file) => request('DELETE', `/api/workbooks/${wb}/problems/${p}/references/${encodeURIComponent(file)}`),
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
      if (ctrl.signal.aborted) return;
      handlers.error?.({ error: '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.' });
      return;
    }
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
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
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
      handlers.end?.();
    } catch (err) {
      if (!ctrl.signal.aborted) handlers.error?.({ error: err.message });
    }
  })();
  return () => ctrl.abort();
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
