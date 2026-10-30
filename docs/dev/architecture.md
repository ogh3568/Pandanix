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
  seed.js + seed/library/<slug>/   내장 문제집 라이브러리(첫 실행 시 전부 설치, 가져오기 폴더 형식 예시)
  validate-library.js      라이브러리 무결성 검사 (npm run validate:library)
  lib/paths.js             DATA_DIR, 허용 루트 검사(resolveAllowed), JSON 읽기/쓰기
  lib/store.js             문제집·문제·참고자료·답안·첨부·채팅·가져오기/내보내기
  lib/prompt.js            프롬프트 템플릿, extractJson
  lib/html2md.js           에디터 HTML → Markdown/텍스트, 글자 수
  lib/sse.js               SSE 응답 도우미
  lib/watchdog.js          프로바이더 무응답 감시
  lib/log.js               파일 로깅 (data/logs)
  lib/sendfile.js          사용자 파일 서빙 규칙
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
| `problem:selected {wb,p,problem}` | sidebar, workbookForms.refreshWorkbooks(문제집이 사라졌을 때) | editor(답안 로드), chat(기록 로드) |
| `problem:changed` | sidebar/폼, sidebar.syncFromServer | sidebar 재렌더, editor(제목·글자 수 제한 갱신) |
| `workbooks:changed` | workbookForms.refreshWorkbooks | sidebar, editor(상단 제목) |
| `answer:saved {wb,p,status}` | editor | sidebar(상태 점) |
| `model:changed` | app(상단바) | chat(라벨) |
| `settings:changed` | settings 모달 닫힘/기본 모델 저장 | app(상단바 재구성), chat(키 배너) |

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

## 타임아웃·안정성 정책
- HTTP 서버: `requestTimeout=0`, `timeout=0`, `headersTimeout=1h`, `keepAliveTimeout=65s` (`app.js tuneTimeouts`). SSE 는 15초 하트비트.
- 프로바이더 SDK: timeout 20분, 재시도 2회(연결 오류·429·5xx). 무응답 감시(`lib/watchdog.js`): 5분간 토큰이 없으면 끊고 오류 이벤트.
- 클라이언트(`api.js streamPost`): 90초 동안 아무 바이트도 없으면 연결 끊김으로 처리. `connection` 객체로 오프라인 상태 전파 → 상단 배너, 에디터 "저장 안 됨" 표시 + localStorage 백업.
- 프로세스: `unhandledRejection`/`uncaughtException` 은 로그만 남기고 계속 실행(`installCrashGuards`), 로그는 `data/logs/pandanix.log`. `start.bat` 은 비정상 종료 시 최대 5회 자동 재시작.
- 수신: `127.0.0.1` 과 `::1` 둘 다(Windows 브라우저의 localhost→IPv6 우선 대비).

## Windows/Linux 호환 메모
- 경로 비교는 `normalizeForCompare`(Windows 만 소문자). 파일명은 `safeName`(예약 이름 CON/NUL, 끝 점·공백, 200바이트 제한). Windows 에서 끝 점·공백이 붙은 사용자 경로는 거부.
- JSON 읽기는 BOM 허용(메모장 저장 대비). 텍스트 참고자료는 UTF-8 실패 시 EUC-KR 재시도(한국어 Excel CSV).
- 줄바꿈은 `\r` 제거 후 처리(markdown.js, html2md.js, renderCsv). `.bat` 는 CRLF, 나머지는 LF(`.gitattributes`).
- `rename` 은 EPERM/EBUSY(백신·색인기 잠금) 시 재시도. 탐색기 열기는 `explorer.exe`/`open`/`xdg-open` 분기.
- 테스트는 Linux/macOS/Windows 어디서나 `npm test`(`node --test` 자동 탐색, 임시 폴더 격리).

## 보안 모델 (로컬 앱 기준)
- 서버는 루프백(`127.0.0.1`, `::1`)에만 바인딩(기본)하고 Host 헤더를 검사한다(DNS rebinding 방지). 인증 없음 → 공유 망 노출 금지(`HOST` 변경 시 사용자 책임, FAQ 에 명시).
- 파일 API 는 `data/config` 를 절대 노출하지 않고, 앱 내부 폴더(workbooks/answers)는 통째로 지울 수 없다.
- 키는 서버에만 존재, 응답은 마스킹.
- 에디터 HTML 은 클라이언트 `sanitize()` 로 허용 태그만 저장/표시. 서버는 HTML 을 그대로 저장(로컬 단일 사용자 전제). 사용자가 올린 HTML/SVG 파일은 inline 으로 서빙하지 않는다(`lib/sendfile.js`).
- 경로 순회 방지: `resolveAllowed`, `safeName`, ID 정규식(`^[A-Za-z0-9_-]{1,64}$`).
