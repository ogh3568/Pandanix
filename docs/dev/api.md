# API 레퍼런스

모든 경로는 `/api` 아래. 요청/응답은 JSON(`Content-Type: application/json`), 오류는 `{ "error": "메시지" }` + 적절한 상태 코드. 본문 크기 제한 80MB(첨부 base64 포함).

## 설정 / 프로바이더 (`routes/settings.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/settings` | `{ settings, providers, credentials(마스킹), dataDir, allowedRoots, platform }` |
| PUT | `/settings` | 부분 패치(deep-merge). 검증(`config.js validateSettingsPatch`): 포트 1~65535, 프로바이더/모델 존재, `allowedRoots` 는 절대경로·존재하는 폴더 배열(교체), 토큰 수 범위. 위반 시 400 |
| GET | `/credentials` | 마스킹된 자격증명 |
| PUT | `/credentials` | `{ [provider]: { apiKey, baseUrl, organization } }`. `apiKey` 가 빈 문자열이면 유지, 문자열 `__CLEAR__` (밑줄 2개씩) 이면 삭제 |
| POST | `/providers/:name/test` | 연결 테스트 → `{ ok, detail }` 또는 `{ ok:false, error }` (항상 200) |
| GET | `/providers/:name/models` | `{ models:[{id,label}] }` |

## 문제집 / 문제 / 참고자료 (`routes/workbooks.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/workbooks` | `{ workbooks:[요약…] }` |
| POST | `/workbooks` | `{ title, description, category, difficulty }` → 201 |
| GET/PUT/DELETE | `/workbooks/:wb` | 조회 / 수정(`problemOrder` 포함) / 삭제(답안도 삭제) |
| GET | `/library` | 내장 문제집 목록 `{ library:[{id, title, description, category, difficulty, problems:[{id,title}], installedId}] }` |
| POST | `/library/:slug/install` | `{ force? }` 설치 → 201 문제집. 이미 설치됐으면 409(`force:true` 면 복사본), 없는 slug 는 404 |
| POST | `/workbooks/import` | `{ path }` 폴더 가져오기 (허용 루트 안). 폴더 안 JSON 의 ID·파일명은 검증되고, 실패하면 롤백 |
| POST | `/workbooks/:wb/export` | `{ path }` → `<path>/<제목>/` 에 복사 |
| POST | `/workbooks/:wb/problems` | 문제 생성 (`title` 필수) |
| GET/PUT/DELETE | `/workbooks/:wb/problems/:p` | 조회(참고자료 메타 포함) / 수정 / 삭제 |
| POST | `/workbooks/:wb/problems/:p/references` | `{ fileName, contentBase64 또는 content, description, name }` → 201 문제 객체 |
| POST | `/workbooks/:wb/problems/:p/references/from-path` | `{ path, description }` 로컬 파일 복사 |
| GET | `/workbooks/:wb/problems/:p/references/:file` | 파일 서빙. `?download=1` 다운로드, `?text=1` 인코딩(UTF-8/EUC-KR) 판별 후 텍스트. HTML/SVG 등은 항상 다운로드 |
| DELETE | `/workbooks/:wb/problems/:p/references/:file` | 삭제 → 문제 객체 |

## 답안 (`routes/answers.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/answers-status` | `{ [wb]: { [p]: 'draft' 또는 'done' } }` |
| GET | `/answers/:wb/:p` | `{ html, status, updatedAt, attachments }` |
| PUT | `/answers/:wb/:p` | `{ html, status: draft 또는 done }` → 저장 + history 기록(2분 간격, 20개), `chars` 포함. 없는 문제면 404 |
| GET | `/answers/:wb/:p/history` | `{ history:[{file, savedAt}] }` (`savedAt` 은 파일명 형식 `2026-10-30T10-57-39-023Z`, UTC) |
| GET | `/answers/:wb/:p/history/:file` | `{ html }` |
| POST | `/answers/:wb/:p/attachments` | `{ fileName, contentBase64 }` → `{ file, size, ext, url }` |
| GET/DELETE | `/answers/:wb/:p/attachments/:file` | 서빙 / 삭제 |
| POST | `/answers/:wb/:p/export` | `{ format: md / html / txt, path?, fileName? }`. `path` 없으면 파일 본문 응답(다운로드), 있으면 저장 후 `{ path }` |

## 채팅 (`routes/chat.js`) — SSE
`POST /chat/:wb/:p/stream` (문제 없는 일반 채팅은 `general/general`)

요청:
```jsonc
{ "message": "…", "quickAction": "outline / summarize_refs / feedback / proofread / questions / null  (목록: GET /chat-quick-actions)",
  "provider": "anthropic", "model": "claude-opus-5-5",
  "context": { "problem": true, "references": true, "answer": false }, "answerText": "…", "maxHistory": 30 }
```
이벤트: `meta {provider, model}` → `delta {text}`× → `done {message}` 또는 `error {error}`. 15초마다 `: ping` 주석(하트비트).
키 미설정·없는 문제 등 시작 전 오류는 SSE 가 아닌 일반 JSON 400/404. 5분간 토큰이 없으면 서버가 끊고 `error` 를 보낸다(`PANDANIX_STALL_TIMEOUT_MS`). 클라이언트가 끊으면 받은 부분까지 `aborted:true` 로 저장된다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/chat/:wb/:p` | `{ messages }` |
| DELETE | `/chat/:wb/:p` | 기록 삭제 |
| GET | `/chat-quick-actions` | `{ key: { label, prompt, needsAnswer } }` (정의: `server/lib/prompt.js QUICK_ACTIONS`) |

## AI 생성 (`routes/generate.js`) — SSE
`POST /generate/workbook` `{ topic, count(1~10), difficulty, audience, extra, provider, model, workbookId? }`
이벤트: `meta` → `progress {chars}` → `done {workbook, chars}` 또는 `error`. `workbookId` 가 없는 문제집이면 호출 전에 404.

## 파일 (`routes/fs.js`) — 허용 루트 안에서만, 아니면 403
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/fs/roots` | `{ roots:[{path, exists, name}], home, platform }` |
| GET | `/fs/list?path=` | `{ path, parent(없으면 null), entries:[{name,path,isDir,size,mtime,ext,isText}] }` |
| GET | `/fs/read?path=` | 텍스트: `{ content }`, 바이너리: `{ binary:true }`, `?download=1` 로 다운로드. 2MB 초과 텍스트 413 |
| POST | `/fs/write` | `{ path, content, overwrite=true }` |
| POST | `/fs/mkdir` / `/fs/delete` / `/fs/open` | 폴더 생성 / 삭제(허용 루트 자체·앱 내부 폴더 불가) / OS 탐색기로 열기 |

`data/config`(키·설정)는 어떤 fs 엔드포인트로도 접근할 수 없다(403). 모든 요청은 Host 헤더가 localhost 계열이어야 한다(DNS rebinding 방지, `HOST` 환경변수로 외부 공개 시 해제).

## 기타
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | `{ ok, version, dataDir }` |
| GET | `/doctor?live=1` | `{ checks:[{id,name,status,detail,fix}], summary:{ok,warn,fail}, live, ranAt }` |
| GET | `/docs` | 문서 목록(뷰어용) `{ files:[{path,title,group}] }` |

## SSE 클라이언트 (`public/js/api.js streamPost`)
`EventSource` 는 GET 전용이라 `fetch` + `ReadableStream` 으로 파싱한다. 반환값은 `abort()` 함수. 핸들러: `meta, delta, progress, done, error, end`.
