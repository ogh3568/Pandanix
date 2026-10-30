# 유지보수 가이드 (AI 가 새 컨텍스트에서 이어받을 때)

## 작업 시작 체크리스트
1. `CLAUDE.md` → 이 문서 → 관련 `docs/dev/*.md` 읽기
2. `npm install && npm test` 로 현재 상태가 초록인지 확인
3. 사용자 요청을 "어느 계층" 문제인지 분류: 프롬프트 / 프로바이더 / 저장소 / 라우트 / UI / 문서
4. 수정 → `npm test` → 필요하면 `npm start` 로 화면 확인(헤드리스 브라우저로 스크린샷을 찍어 보는 것도 좋다)
5. 문서 동기화 + `changelog.md` 한 줄

## 흔한 요청별 레시피

### "AI 말투/지시를 바꿔 줘"
`server/lib/prompt.js` 의 `APP_PERSONA` 수정 후 서버 재시작. 테스트: 채팅 한 번.

### "빠른 작업 버튼 추가"
1. `server/lib/prompt.js QUICK_ACTIONS` 에 `key: { label: '🧾 버튼 이름', prompt: 'AI 에게 보낼 문구', needsAnswer: true|false }` 추가 (순서 = 버튼 순서). 끝.
   - `needsAnswer: true` 면 서버가 답안을 컨텍스트에 넣고, 클라이언트도 현재 답안 텍스트를 보낸다(둘 다 이 플래그를 읽음).
2. 문서: `docs/guide/05-AI-채팅.md` 버튼 표, `docs/dev/api.md` 의 quickAction 설명.
3. 테스트: `tests/api.test.mjs` 의 빠른 작업 테스트를 복사해 새 key 로 한 건 추가. 모의 서버는 시스템 프롬프트에 `현재 답안 초안` 이 포함되면 `답안포함 | true` 를 돌려준다.

### "프로바이더/모델 추가"
`providers.md` 의 절차. OpenAI 호환이면 `config.js PROVIDERS` 한 항목으로 **동작**하고, 나머지(credentials.example.json, 가이드 02 의 두 표, FAQ 프록시 호스트 목록)는 마무리 체크리스트다. 키가 필요 없는 서버라면 `keyOptional: true` 를 꼭 넣는다.

### "기본 모델을 바꿔 줘"
`config.js PROVIDERS[*].defaultModel` (새 설치 기본값). 기존 사용자는 설정 > 기본 모델에서 저장하면 상단바의 브라우저 기억값(localStorage `pandanix:provider`, `pandanix:models`)도 초기화되어 바로 반영된다. 모델 ID 는 `/api/providers/:name/models` 로 검증. 예시 ID 가 적힌 문서: guide/02 표, data-model.md settings 예시, providers.md.

### "문제에 새 항목(예: 난이도별 배점) 추가"
1. `store.js PROBLEM_FIELDS` 에 키 추가, `createProblem` 기본값
2. `workbookForms.js problemForm` 에 입력란, `sidebar.js renderTab` 에 표시
3. 프롬프트에 포함시키려면 `prompt.js buildSystemPrompt`
4. AI 생성에도 넣으려면 `buildWorkbookGenerationPrompt` 스키마 + `generate.js saveGenerated`
5. `data-model.md` 갱신

### "참고자료 PDF/xlsx 본문도 AI 가 읽게 해 줘"
현재 `TEXT_EXTS` 만 본문 전달. 추가하려면 `store.js readReferencesAsText()` 에 확장자별 추출기를 붙인다(예: `pdf-parse`, `xlsx` 패키지). 의존성 추가는 `decisions.md ADR-2` 에 따라 기록. doctor 의 의존성 검사는 package.json 을 읽으므로 자동 반영.

### "에디터에 기능 추가 (예: 글자 색)"
`editor.js` 툴바에 버튼 + `document.execCommand('styleWithCSS', false, true)` 후 `exec('foreColor', color)` (안 켜면 `<font>` 태그가 생겨 `sanitize()` 에서 지워진다). `ALLOWED_ATTRS` 에 `SPAN: ['style']` 을 추가해야 저장 후에도 유지된다. md/txt 내보내기(`html2md.js`)는 색을 버린다는 점을 가이드에 적는다.

### "UI 색/레이아웃"
`app.css :root` 변수. 패널 기본 폭 `--left-w/--right-w`.

### "다른 PC 에서 접속"
`HOST=0.0.0.0` 으로 실행(인증 없음 경고). 진짜 다중 사용자가 필요하면 설계 변경(사용자별 data 폴더, 인증) — `decisions.md ADR-1` 참고.

### "답안 저장 위치/구조 변경"
`store.js` 상단의 경로 도우미(`answerDir`, `attachmentsDir`, `chatFile`)가 기준이지만 숨은 결합이 있다:
- 답안 HTML 안에 첨부 URL `/api/answers/:wb/:p/attachments/<file>` 이 **절대 경로로 저장**된다 → 라우트 형태를 바꾸면 기존 답안의 이미지가 깨진다(마이그레이션 필요).
- `deleteWorkbook`, `answerStatusMap`, `seed.js` 는 `DIRS.answers` 를 직접 쓴다.
- `exportWorkbookToDir` 는 문제집 폴더를 통째로 복사하므로 답안을 문제집 폴더 안으로 옮기면 개인 답안·채팅이 함께 내보내진다.
- 경로 문구가 적힌 곳: `settings.js renderInfo`, README, guide 04, data-model.md, `.gitignore`.
데이터 폴더 전체를 옮기는 요구라면 코드 수정 없이 `PANDANIX_DATA_DIR` 로 해결한다.

### "새 API 엔드포인트 추가"
`server/routes/<영역>.js` 에 핸들러 → (새 파일이면) `app.js` 에 `app.use('/api', …)` → `public/js/api.js` 에 함수 → `docs/dev/api.md` 한 줄 → `tests/api.test.mjs` 한 건. 사용자 경로를 받으면 `resolveAllowed`, 파일명은 `safeName`.

### "설정 항목 추가"
`config.js DEFAULT_SETTINGS` 에 기본값 → `validateSettingsPatch` 에 검증 → `settings.js` 의 해당 `renderXxx()` 입력란과 저장 payload → 사용처 → `data-model.md` settings 예시.

### "내장 문제집 추가/수정"
`server/seed/library/<slug>/` 폴더를 만들면 자동 등록된다(가져오기 폴더 형식, `workbook.json` 의 `id` = slug). `npm run validate:library` 로 검사. 규칙: 문제마다 참고자료 1개 이상, 지문 150자 이상, 루브릭 2개 이상, CSV 는 헤더와 열 수 일치(`※` 로 시작하는 각주 줄은 허용). `lib-basics` 는 테스트가 문제 3개·참고자료 순서를 고정하고 있으니 바꾸면 테스트도 수정. 기존 사용자는 자동 설치되지 않고 "📚 내장 문제집" 에서 설치한다.

## 용어집 (UI ↔ 코드)
| UI 용어 | 코드 식별자 | 위치 |
|---|---|---|
| 문제집 | workbook, `wb` | `store.js`, `routes/workbooks.js` |
| 문제 | problem, `p` | 〃 |
| 지문 / 제출 형식 / 평가 기준 | `prompt` / `submission.format`+`charLimit` / `rubric` | `problem.json` |
| 참고자료 | reference | `references/`, `TEXT_EXTS` |
| 답안 / 저장본 / 첨부 | answer / history / attachments | `routes/answers.js` |
| 빠른 작업 | quickAction | `prompt.js QUICK_ACTIONS` |
| 내장 문제집 | library, slug, `libraryId` | `seed.js` |
| 파일 접근 허용 폴더(허용 루트) | `allowedRoots`, `getAllowedRoots()` | `config.js`, `paths.js resolveAllowed` |
| 프로바이더 | provider, `kind`(어댑터 종류) | `config.js PROVIDERS`, `providers/` |
| 일반 채팅 | `general/general` 스코프 | `routes/chat.js` |

## 튜닝 상수 표
| 조절값 | 기본 | 위치 |
|---|---|---|
| AI 페르소나·빠른 작업 문구·생성 프롬프트 | — | `server/lib/prompt.js` |
| 답안 컨텍스트 자르기 | 60,000자 | `prompt.js buildSystemPrompt` |
| 참고자료 컨텍스트 자르기 | 120,000자 (설정) | `settings.chat.maxReferenceChars` |
| 최대 출력 토큰 | 32,000 (설정) | `settings.chat.maxOutputTokens` |
| 대화 이력 개수 | 30 (요청 `maxHistory`, 최대 200) | `routes/chat.js` |
| 메시지 길이 상한 | 200,000자 | `routes/chat.js` |
| 문제집 생성 출력 토큰 / 진행 보고 간격 | 32,000 / 200자 | `routes/generate.js` |
| 무응답 감시 | 5분 (`PANDANIX_STALL_TIMEOUT_MS`) | `lib/watchdog.js` |
| SDK 타임아웃 / 재시도 | 20분 / 2회 | `providers/*.js` |
| SSE 하트비트 / 클라이언트 유휴 한계 | 15초 / 90초 | `lib/sse.js`, `public/js/api.js` |
| 저장본 개수 / 최소 간격 | 20 / 2분 | `store.js HISTORY_KEEP`, `HISTORY_MIN_GAP_MS` |
| 자동 저장 디바운스 | 1,500ms (설정) | `settings.editor.autosaveMs` |
| 텍스트로 읽는 확장자 | md, txt, csv, json, … | `store.js TEXT_EXTS` |
| 파일 미리보기 상한 / 업로드 상한 / 본문 상한 | 2MB / 50MB / 80MB | `routes/fs.js`, `public/js/api.js MAX_UPLOAD_BYTES`, `app.js` |
| 채팅 재렌더 간격 / 포커스 동기화 간격 | 120ms / 3초 | `chat.js`, `sidebar.js syncFromServer` |
| doctor live 테스트 제한 | 20초/프로바이더 | `doctor.js` |
| 가운데 패널 최소 폭 | 420px | `app.js CENTER_MIN`, `app.css` |

## 문서 작성 규칙
- `docs/**/*.md` 는 앱의 /docs 뷰어에 자동 등록된다: 첫 `# ` 줄이 제목, 폴더가 그룹(`guide`=사용 가이드, `dev`=개발/유지보수), 파일명 순 정렬.
- 뷰어 렌더러가 지원하는 문법만 쓴다(`frontend.md` 참고): HTML 태그·체크박스·각주·2단계 중첩 금지. 표 셀 안의 `|` 는 `\|` 또는 "또는/" 로.
- UI 문구를 바꾸면 `grep -r "<옛 문구>" docs` 로 가이드를 함께 고친다.
- 사용자 가이드에 소스 경로를 적을 때는 "(관리자)" 표시를 붙인다.

## 테스트 가이드
- 전체: `npm test` (`node --test`, `tests/*.test.mjs` 자동 탐색). 단일 파일: `node --test tests/api.test.mjs`.
- `tests/api.test.mjs` 는 임시 `PANDANIX_DATA_DIR` 에 앱을 띄우고 `tests/mock-openai-server.mjs` 를 `custom` 프로바이더로 연결한다. 모의 서버: 메시지를 `ECHO:` 로 되돌리고 시스템 프롬프트 길이/참고자료 포함/답안 포함 여부를 표로 알려준다. `JSON 스키마` 가 시스템 프롬프트에 있으면 가짜 문제집 JSON, 메시지에 `STALL` 이 있으면 무응답, 키가 `bad` 면 401.
- 실제 키가 필요한 검증은 `npm run doctor:live` 와 설정 화면의 연결 테스트로 수동 수행.

## 알려진 기술 부채
- 에디터는 `execCommand` 기반(표준에서 제외된 API). 대안 도입 시 ADR-2(의존성 최소화)와 저울질.
- 답안 HTML 에 첨부 절대 URL 이 저장됨(위 "저장 위치 변경" 참고).
- PDF/Office 참고자료 본문 미추출(ADR-7).
- 다중 사용자/인증 없음(ADR-1).

## 버그 추적 순서
1. 브라우저 콘솔(F12) 오류 → 프런트 모듈 확인
2. 서버 콘솔 `[pandanix] 오류:` 로그 → 라우트/스토어
3. `npm run doctor:live` 로 환경 문제 배제
4. 재현 테스트를 `tests/` 에 추가한 뒤 수정 (모의 서버 `tests/mock-openai-server.mjs` 로 AI 응답을 흉내낼 수 있다)

## 릴리스/배포
빌드 없음. 사용자는 폴더를 받아 `start.bat`. 버전은 `package.json version` 과 `changelog.md`.

## 백로그 (아이디어)
- 답안 첨부 URL 을 상대 참조로 바꾸는 마이그레이션
- PDF/DOCX/XLSX 참고자료 본문 추출
- 참고자료를 Anthropic/OpenAI 의 파일 입력(문서 블록)으로 직접 전달
- 답안 DOCX 내보내기
- 다크 모드, 글꼴 크기 설정
- 문제집 공유용 zip 내보내기
- 채팅에서 로컬 파일을 첨부해 질문
- 사용량(토큰/비용) 통계 화면
