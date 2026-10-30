# API 레퍼런스

모든 경로는 `/api` 아래. 요청/응답은 JSON(`Content-Type: application/json`), 오류는 `{ "error": "메시지" }` + 적절한 상태 코드. 본문 크기 제한 80MB(첨부 base64 포함).

## 설정 / 프로바이더 (`routes/settings.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/settings` | `{ settings, providers, credentials(마스킹), dataDir, allowedRoots, platform }` |
| PUT | `/settings` | 부분 패치(deep-merge). `allowedRoots` 는 배열 교체, 존재하지 않는 폴더면 400 |
| GET | `/credentials` | 마스킹된 자격증명 |
| PUT | `/credentials` | `{ [provider]: { apiKey, baseUrl, organization } }`. `apiKey` 빈 문자열=유지, `"__CLEAR__"`=삭제 |
| POST | `/providers/:name/test` | 연결 테스트 → `{ ok, detail }` 또는 `{ ok:false, error }` (항상 200) |
| GET | `/providers/:name/models` | `{ models:[{id,label}] }` |

## 문제집 / 문제 / 참고자료 (`routes/workbooks.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/workbooks` | `{ workbooks:[요약…] }` |
| POST | `/workbooks` | `{ title, description, category, difficulty }` → 201 |
| GET/PUT/DELETE | `/workbooks/:wb` | 조회 / 수정(`problemOrder` 포함) / 삭제(답안도 삭제) |
| POST | `/workbooks/import` | `{ path }` 폴더 가져오기 (허용 루트 안) |
| POST | `/workbooks/:wb/export` | `{ path }` → `<path>/<제목>/` 에 복사 |
| POST | `/workbooks/:wb/problems` | 문제 생성 (`title` 필수) |
| GET/PUT/DELETE | `/workbooks/:wb/problems/:p` | 조회(참고자료 메타 포함) / 수정 / 삭제 |
| POST | `/workbooks/:wb/problems/:p/references` | `{ fileName, contentBase64 | content, description, name }` |
| POST | `/workbooks/:wb/problems/:p/references/from-path` | `{ path, description }` 로컬 파일 복사 |
| GET | `/workbooks/:wb/problems/:p/references/:file` | 파일 서빙 (`?download=1`) |
| DELETE | `/workbooks/:wb/problems/:p/references/:file` | 삭제 |

## 답안 (`routes/answers.js`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/answers-status` | `{ [wb]: { [p]: 'draft'|'done' } }` |
| GET | `/answers/:wb/:p` | `{ html, status, updatedAt, attachments }` |
| PUT | `/answers/:wb/:p` | `{ html, status }` → 저장 + history 기록, `chars` 포함 |
| GET | `/answers/:wb/:p/history` | `{ history:[{file, savedAt}] }` |
| GET | `/answers/:wb/:p/history/:file` | `{ html }` |
| POST | `/answers/:wb/:p/attachments` | `{ fileName, contentBase64 }` → `{ file, size, ext, url }` |
| GET/DELETE | `/answers/:wb/:p/attachments/:file` | 서빙 / 삭제 |
| POST | `/answers/:wb/:p/export` | `{ format: md|html|txt, path?, fileName? }`. `path` 없으면 파일 본문 응답(다운로드), 있으면 저장 후 `{ path }` |

## 채팅 (`routes/chat.js`) — SSE
`POST /chat/:wb/:p/stream` (문제 없는 일반 채팅은 `general/general`)

요청:
```jsonc
{ "message": "…", "quickAction": "outline|summarize_refs|feedback|proofread|questions|null",
  "provider": "anthropic", "model": "claude-opus-5-5",
  "context": { "problem": true, "references": true, "answer": false }, "answerText": "…", "maxHistory": 30 }
```
이벤트: `meta {provider, model}` → `delta {text}`× → `done {message}` | `error {error}`. 15초마다 `: ping` 주석.
키 미설정 등 시작 전 오류는 SSE 가 아닌 일반 JSON 400.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/chat/:wb/:p` | `{ messages }` |
| DELETE | `/chat/:wb/:p` | 기록 삭제 |
| GET | `/chat-quick-actions` | `{ key: 프롬프트 문구 }` |

## AI 생성 (`routes/generate.js`) — SSE
`POST /generate/workbook` `{ topic, count(1~10), difficulty, audience, extra, provider, model, workbookId? }`
이벤트: `meta` → `progress {chars}` → `done {workbook, chars}` | `error`.

## 파일 (`routes/fs.js`) — 허용 루트 안에서만, 아니면 403
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/fs/roots` | `{ roots:[{path, exists, name}], home, platform }` |
| GET | `/fs/list?path=` | `{ path, parent|null, entries:[{name,path,isDir,size,mtime,ext,isText}] }` |
| GET | `/fs/read?path=` | 텍스트: `{ content }`, 바이너리: `{ binary:true }`, `?download=1` 로 다운로드. 2MB 초과 텍스트 413 |
| POST | `/fs/write` | `{ path, content, overwrite=true }` |
| POST | `/fs/mkdir` / `/fs/delete` / `/fs/open` | 폴더 생성 / 삭제(루트 자체 불가) / OS 탐색기로 열기 |

## 기타
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | `{ ok, version, dataDir }` |
| GET | `/doctor?live=1` | `{ checks:[{id,name,status,detail,fix}], summary:{ok,warn,fail}, live, ranAt }` |
| GET | `/docs` | 문서 목록(뷰어용) `{ files:[{path,title,group}] }` |

## SSE 클라이언트 (`public/js/api.js streamPost`)
`EventSource` 는 GET 전용이라 `fetch` + `ReadableStream` 으로 파싱한다. 반환값은 `abort()` 함수. 핸들러: `meta, delta, progress, done, error, end`.
