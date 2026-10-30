# CLAUDE.md — Pandanix 유지보수 안내 (AI/개발자용)

이 파일은 새 컨텍스트에서 이 프로젝트를 이어받는 AI 와 개발자를 위한 **출발점**입니다. 5분 안에 읽히도록 짧게 유지하세요. 자세한 내용은 `docs/dev/` 로 링크합니다.

## 한 줄 요약
Windows 로컬에서 실행하는 Node.js(Express) + 순수 JS 프런트엔드 웹 앱. 사용자는 문제집의 문제를 풀며 Claude/GPT/Gemini/OpenCode 등 AI 와 채팅한다. 빌드 단계 없음, DB 없음(모두 `data/` 아래 JSON/파일).

## 먼저 읽을 것 (순서대로)
1. `docs/dev/architecture.md` — 폴더 구조, 요청 흐름, 핵심 모듈 한 장 요약
2. `docs/dev/data-model.md` — `data/` 폴더와 JSON 스키마
3. `docs/dev/api.md` — REST/SSE 엔드포인트 전체 목록
4. `docs/dev/maintenance.md` — **흔한 수정 요청별 레시피** (프로바이더 추가, 프롬프트 수정, UI 변경, 버그 추적)
5. `docs/dev/decisions.md` — 왜 이렇게 만들었는지(ADR). 바꾸기 전에 확인
6. `docs/dev/changelog.md` — 변경 이력. **작업 후 반드시 한 줄 추가**

## 실행/검증 명령
```bash
npm install          # 최초 1회
npm start            # http://localhost:3210  (Windows: start.bat)
npm run doctor       # 환경 점검 (--live: API 연결까지)
npm test             # 단위 + 통합 테스트. API 키 없이 모의 서버로 동작. 수정 후 항상 실행
```
Linux/macOS 에서도 개발·테스트는 가능하다(doctor 가 OS 경고만 낸다).

## 지도: 무엇을 고치려면 어디를 보나
| 바꾸고 싶은 것 | 파일 |
|---|---|
| AI 에게 보내는 지시문(페르소나, 빠른 작업, 문제집 생성 프롬프트) | `server/lib/prompt.js` |
| 프로바이더 추가/모델 기본값/키 환경변수 이름 | `server/config.js` (`PROVIDERS`) + `server/providers/*.js` |
| 저장 구조(문제집/답안/채팅 파일) | `server/lib/store.js` |
| API 라우트 | `server/routes/*.js` (settings, workbooks, answers, chat, generate, fs, doctor) |
| 환경 점검 항목 | `server/doctor.js` |
| 화면 레이아웃/스타일 | `public/index.html`, `public/css/app.css` (색·간격은 `:root` 변수) |
| 왼쪽 패널(문제집/문제) | `public/js/ui/sidebar.js`, 폼: `public/js/ui/workbookForms.js` |
| 가운데 에디터 | `public/js/ui/editor.js` |
| 오른쪽 채팅 | `public/js/ui/chat.js` |
| 설정/Doctor/파일 탐색기 모달 | `public/js/ui/settings.js`, `doctor.js`, `filepicker.js` |
| 프런트 API 호출 | `public/js/api.js` (fetch 는 여기서만) |
| 내장 문제집(라이브러리) | `server/seed/library/<slug>/` (폴더 추가만으로 등록됨), 목록/설치 로직 `server/seed.js` |

## 규칙 (지켜야 할 것)
- **의존성 최소화**: 서버는 express + 3개 공식 AI SDK 뿐. 프런트는 외부 라이브러리 없음(오프라인 동작). 새 패키지를 넣기 전에 `decisions.md` 의 ADR-2 를 읽고, 넣었다면 기록.
- **파일 접근은 허용 루트 안에서만**: 사용자 경로를 받는 모든 코드는 `resolveAllowed()`(`server/lib/paths.js`)를 거친다. 우회 금지.
- **API 키는 절대 로그/응답에 노출하지 않는다**: UI 에는 `maskedCredentials()` 결과만 보낸다.
- **오류는 항상 `{ error: "한국어 메시지" }` JSON** 으로. 사용자가 읽고 조치할 수 있는 문장으로 쓴다.
- **스트리밍 응답은 SSE**(`server/lib/sse.js`). 클라이언트 중단 감지는 `res.on('close')` 를 쓴다(`req` 의 close 는 본문 수신 직후에도 발생).
- **UI 문구와 문서는 한국어**. 코드 주석도 한국어 우선.
- **문서 동기화**: 사용자에게 보이는 동작을 바꾸면 `docs/guide/` 의 해당 문서를, 구조를 바꾸면 `docs/dev/` 를 함께 고친다. 마지막에 `docs/dev/changelog.md` 에 한 줄.
- Claude API 호출 규약(모델 ID, thinking, fallbacks)은 `server/providers/anthropic.js` 상단 주석과 `docs/dev/providers.md` 를 따른다. 모델 ID 에 날짜 접미사를 붙이지 않는다.

## 알려진 한계 / 다음 할 일 후보
`docs/dev/maintenance.md` 맨 아래 "백로그" 참고. (PDF/DOCX 참고자료 본문 추출, 다크 모드, 다국어 등)
