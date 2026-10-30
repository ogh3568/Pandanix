# 아키텍처 (개발자/AI 용)

## 한 장 요약

```
브라우저 (public/, 순수 ES 모듈, 빌드 없음)
   │  fetch JSON  /  fetch+ReadableStream (SSE, POST)
   ▼
Express 서버 (server/app.js)  ── 정적 파일: public/, docs/
   ├─ routes/*.js        HTTP 핸들러 (얇게 유지, 검증 + store/provider 호출)
   ├─ lib/store.js       파일 기반 저장소 (data/ 아래 JSON + 파일)
   ├─ lib/prompt.js      시스템 프롬프트 · 빠른 작업 · 문제집 생성 프롬프트
   ├─ providers/*.js     AI SDK 어댑터 (공통 인터페이스로 정규화)
   ├─ config.js          settings.json / credentials.json / PROVIDERS 정의
   └─ doctor.js          환경 점검 (CLI 와 API 공용)
```

- **런타임**: Node ≥ 18, ESM(`"type": "module"`). Windows 대상이지만 OS 의존 코드는 `IS_WINDOWS` 분기뿐(탐색기 열기, 브라우저 열기, 경로 대소문자 비교).
- **DB 없음**: 모든 상태는 `data/` 폴더. 백업=폴더 복사. → `data-model.md`
- **의존성**: `express`, `@anthropic-ai/sdk`, `openai`, `@google/genai`. 프런트는 0개(마크다운 렌더러도 자체 구현 `public/js/markdown.js`).

## 폴더 구조

```
server.js                  진입점 (startServer 호출)
server/
  app.js                   Express 구성, 라우트 마운트, 오류 핸들러, 문서 뷰어 라우트, 브라우저 자동 열기
  config.js                PROVIDERS 정의, 설정/자격증명 로드·저장·마스킹
  doctor.js / doctor-cli.js
  seed.js + seed/sample-workbook/   첫 실행 샘플 문제집(가져오기 폴더 형식 예시)
  lib/paths.js             DATA_DIR, 허용 루트 검사(resolveAllowed), JSON 읽기/쓰기
  lib/store.js             문제집·문제·참고자료·답안·첨부·채팅·가져오기/내보내기
  lib/prompt.js            프롬프트 템플릿, extractJson
  lib/html2md.js           에디터 HTML → Markdown/텍스트, 글자 수
  lib/sse.js               SSE 응답 도우미
  providers/index.js       getProvider(name), resolveProviderAndModel
  providers/anthropic.js | openai.js | gemini.js
  routes/settings.js | workbooks.js | answers.js | chat.js | generate.js | fs.js | doctor.js
public/
  index.html, css/app.css, docs-viewer.html
  js/app.js                부트스트랩, 상단바(프로바이더/모델), 패널 크기 조절
  js/api.js                모든 fetch + streamPost(SSE)
  js/state.js              전역 상태 + 이벤트 버스(on/emit) + localStorage prefs
  js/markdown.js           Markdown/CSV → HTML (escape 보장)
  js/ui/sidebar.js         왼쪽: 문제집 목록 ↔ 문제 상세(탭)
  js/ui/workbookForms.js   문제집/문제 폼, AI 생성 다이얼로그, 텍스트 자료 작성
  js/ui/editor.js          가운데: contenteditable 에디터, 표, 첨부, 자동저장, 내보내기, 기록
  js/ui/chat.js            오른쪽: 채팅, 빠른 작업, 컨텍스트 옵션
  js/ui/settings.js | doctor.js | filepicker.js | modal.js
docs/                      사용자 가이드(guide/) + 개발 문서(dev/) — 앱의 /docs 뷰어에서도 표시
tests/                     node --test (단위 + 모의 서버 통합)
data/                      사용자 데이터 (git 제외)
```

## 핵심 흐름

### 채팅 1회
1. `chat.js send()` → `POST /api/chat/:wb/:p/stream` (message, quickAction, provider, model, context, answerText)
2. `routes/chat.js`: 프로바이더 해석(`resolveProviderAndModel`) → 키 검사(`getProvider`, 없으면 SSE 열기 전에 400)
3. `buildSystemPrompt()` 가 지문·제출형식·루브릭·참고자료(텍스트만, 글자 제한)·답안을 합침
4. 이전 대화(최근 30개) + 새 메시지를 프로바이더 `streamChat()` 으로 전달, delta 마다 SSE `delta`
5. 완료 시 `chat.json` 에 user/assistant 메시지 추가 후 `done`. 오류는 `error` 이벤트 + 기록에 오류 메시지 저장
6. 클라이언트는 120ms 간격으로 Markdown 재렌더, 완료 후 "답안에 삽입" 가능

### AI 문제집 생성
`POST /api/generate/workbook` (SSE) → 프롬프트(`buildWorkbookGenerationPrompt`) → 전체 텍스트 수집 → `extractJson` → `saveGenerated` 가 문제집/문제/참고자료 파일 생성 → `done {workbook}`.

### 파일 접근
모든 사용자 지정 경로는 `resolveAllowed(path, getAllowedRoots())` 를 통과. 허용 루트 = `DATA_DIR` + `settings.allowedRoots`. Windows 는 소문자 비교.

### 프런트 이벤트
| 이벤트 | 발행 | 구독 |
|---|---|---|
| `problem:selected {wb,p,problem}` | sidebar | editor(답안 로드), chat(기록 로드) |
| `problem:changed` | sidebar/폼 | sidebar 재렌더 |
| `workbooks:changed` | workbookForms.refreshWorkbooks | sidebar |
| `answer:saved {wb,p,status}` | editor | sidebar(상태 점) |
| `model:changed` | app(상단바) | chat(라벨) |
| `settings:changed` | settings 모달 닫힘 | app(상단바 재구성) |

## 프로바이더 공통 인터페이스
```js
{
  name,
  streamChat({ model, system, messages:[{role:'user'|'assistant', content}], maxTokens }, onDelta(text), abortSignal)
    → { text, stopReason, usage:{input,output}|null, model },
  listModels() → [{ id, label }],
  ping() → { ok, detail }
}
```
자세한 구현 규약은 `providers.md`.

## 보안 모델 (로컬 앱 기준)
- 서버는 `127.0.0.1` 에만 바인딩(기본). 인증 없음 → 공유 망 노출 금지(`HOST` 변경 시 사용자 책임, FAQ 에 명시).
- 키는 서버에만 존재, 응답은 마스킹.
- 에디터 HTML 은 클라이언트 `sanitize()` 로 허용 태그만 저장/표시. 서버는 HTML 을 그대로 저장(로컬 단일 사용자 전제).
- 경로 순회 방지: `resolveAllowed`, `safeName`, ID 정규식(`^[A-Za-z0-9_-]{1,64}$`).
