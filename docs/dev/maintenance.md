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
1. `prompt.js QUICK_ACTIONS` 에 `key: '문구'`
2. `public/js/ui/chat.js QUICK_LABELS` 에 `key: '이모지 라벨'`
3. 답안이 필요한 작업이면 `routes/chat.js` 의 `if (body.quickAction === 'feedback' || …) context.answer = true` 에 추가
4. `docs/guide/05-AI-채팅.md` 표 갱신

### "프로바이더/모델 추가"
`providers.md` 의 절차. OpenAI 호환이면 `config.js` 한 항목이면 끝.

### "기본 모델을 바꿔 줘"
`config.js PROVIDERS[*].defaultModel` (새 설치 기본값) + 기존 사용자는 설정 화면에서 변경. 모델 ID 는 각 사의 모델 목록 API 로 검증(`/api/providers/:name/models`).

### "문제에 새 항목(예: 난이도별 배점) 추가"
1. `store.js PROBLEM_FIELDS` 에 키 추가, `createProblem` 기본값
2. `workbookForms.js problemForm` 에 입력란, `sidebar.js renderTab` 에 표시
3. 프롬프트에 포함시키려면 `prompt.js buildSystemPrompt`
4. AI 생성에도 넣으려면 `buildWorkbookGenerationPrompt` 스키마 + `generate.js saveGenerated`
5. `data-model.md` 갱신

### "참고자료 PDF/xlsx 본문도 AI 가 읽게 해 줘"
현재 `TEXT_EXTS` 만 본문 전달. 추가하려면 `store.js readReferencesAsText()` 에 확장자별 추출기를 붙인다(예: `pdf-parse`, `xlsx` 패키지). 의존성 추가는 `decisions.md ADR-2` 에 따라 기록. doctor 의 의존성 검사는 package.json 을 읽으므로 자동 반영.

### "에디터에 기능 추가 (예: 글자 색)"
`editor.js` 툴바에 버튼 + `exec('foreColor', color)`. `sanitize()` 의 허용 태그/속성(`ALLOWED_TAGS/ATTRS`)에 `SPAN style` 등을 추가해야 저장 후에도 유지된다.

### "UI 색/레이아웃"
`app.css :root` 변수. 패널 기본 폭 `--left-w/--right-w`.

### "다른 PC 에서 접속"
`HOST=0.0.0.0` 으로 실행(인증 없음 경고). 진짜 다중 사용자가 필요하면 설계 변경(사용자별 data 폴더, 인증) — `decisions.md ADR-1` 참고.

## 버그 추적 순서
1. 브라우저 콘솔(F12) 오류 → 프런트 모듈 확인
2. 서버 콘솔 `[pandanix] 오류:` 로그 → 라우트/스토어
3. `npm run doctor:live` 로 환경 문제 배제
4. 재현 테스트를 `tests/` 에 추가한 뒤 수정 (모의 서버 `tests/mock-openai-server.mjs` 로 AI 응답을 흉내낼 수 있다)

## 테스트
- `tests/unit.test.mjs`: html2md, extractJson, 경로 보호
- `tests/api.test.mjs`: 임시 데이터 폴더 + 모의 OpenAI 서버로 전체 API 흐름(시드, CRUD, 답안, SSE 채팅, 생성, fs, doctor, 마스킹)
- 실제 API 키가 필요한 검증은 `npm run doctor:live` 와 설정 화면의 연결 테스트로 수동 수행

## 릴리스/배포
빌드 없음. 사용자는 폴더를 받아 `start.bat`. 버전은 `package.json version` 과 `changelog.md`.

## 백로그 (아이디어)
- PDF/DOCX/XLSX 참고자료 본문 추출
- 참고자료를 Anthropic/OpenAI 의 파일 입력(문서 블록)으로 직접 전달
- 답안 DOCX 내보내기
- 다크 모드, 글꼴 크기 설정
- 문제집 공유용 zip 내보내기
- 채팅에서 로컬 파일을 첨부해 질문
- 사용량(토큰/비용) 통계 화면
