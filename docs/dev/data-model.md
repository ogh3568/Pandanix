# 데이터 모델

모든 데이터는 `DATA_DIR`(기본 `<프로젝트>/data`, 환경변수 `PANDANIX_DATA_DIR`) 아래 파일입니다.

```
data/
  config/
    settings.json              앱 설정 (DEFAULT_SETTINGS 와 deep-merge)
    credentials.json           API 키 (git 제외)
    credentials.example.json   템플릿
  workbooks/<wbId>/
    workbook.json
    problems/<pId>/
      problem.json
      references/<file>       참고자료 원본 파일
  answers/<wbId>/<pId>/
    answer.json                { html, status, updatedAt }
    history/<timestamp>.html   저장본 (2분 간격으로 1개, 최근 20개 - store.js HISTORY_KEEP/HISTORY_MIN_GAP_MS)
    attachments/<file>         이미지/첨부
    chat.json                  { messages:[...], updatedAt }
  answers/general/general/chat.json   "일반 채팅" 기록
  tmp/                         doctor 쓰기 테스트 등
```

ID 규칙: `wb_` / `p_` + 8자리 hex (`server/lib/ids.js`). 정규식 `^[A-Za-z0-9_-]{1,64}$` 를 통과해야 경로에 쓰인다. 내장 문제집 설치/가져오기 시에는 새 ID 가 발급된다.

그 밖의 파일: `data/.seeded`(첫 실행 시드 완료 마커), `data/logs/pandanix.log`(서버 로그, 5MB 회전).

## settings.json
```jsonc
{
  "port": 3210,
  "defaultProvider": "anthropic",
  "models": { "anthropic": "claude-opus-5-5", "openai": "gpt-5", "gemini": "gemini-2.5-pro", "opencode": "", "custom": "" },
  "allowedRoots": ["C:\\Users\\me\\Documents"],   // DATA_DIR 는 자동 포함
  "chat": { "maxOutputTokens": 32000, "includeProblem": true, "includeReferences": true, "includeAnswer": false, "maxReferenceChars": 120000 },  // include* 는 채팅 체크박스 초기값이자 API 직접 호출 시 기본값
  "anthropic": { "fallbacks": true },             // Claude 5 세대 서버측 대체 모델
  "editor": { "autosaveMs": 1500 }
}
```
누락 키는 `DEFAULT_SETTINGS`(`server/config.js`)로 채워진다. 새 설정을 추가할 때는 기본값을 거기에 넣으면 기존 사용자 파일과 호환된다.

## credentials.json
```jsonc
{
  "anthropic": { "apiKey": "" },
  "openai":    { "apiKey": "", "baseUrl": "", "organization": "" },
  "gemini":    { "apiKey": "" },
  "opencode":  { "apiKey": "", "baseUrl": "https://opencode.ai/zen/v1" },
  "custom":    { "apiKey": "", "baseUrl": "http://localhost:11434/v1" }
}
```
`loadCredentials()` 는 환경변수(`PROVIDERS[name].envKey`, Gemini 는 `GOOGLE_API_KEY` 도)를 덮어쓰고 `_source: 'env'|'file'` 을 표시한다.

## workbook.json
```jsonc
{
  "id": "wb_8ac942b3",
  "title": "AI 활용 기초: 업무 보고서와 의사결정",
  "description": "…",
  "category": "업무 일반",
  "difficulty": "초급",          // 초급|중급|고급|""
  "source": "manual | ai | import | library",
  "libraryId": "lib-basics",      // 내장 문제집에서 설치한 경우만. 라이브러리 화면의 "설치됨" 판정에 사용
  "createdAt": "ISO", "updatedAt": "ISO",
  "problemOrder": ["p_a2ab51a1", "p_…"]   // 표시 순서. 실제 문제는 problems/ 폴더
}
```
API 응답(`summarizeWorkbook`)에는 `problems: [{id, title, tags}]` 가 덧붙는다.

## problem.json
```jsonc
{
  "id": "p_a2ab51a1",
  "title": "설비 교체 검토 보고서 작성",
  "prompt": "마크다운 지문",
  "submission": { "format": "제출 형식 설명(마크다운)", "charLimit": 1200, "deliverables": ["보고서 본문", "대안 비교표"] },
  "references": [ { "file": "설비정보.md", "name": "표시 이름", "description": "한 줄 설명" } ],  // 순서 = 표시 순서
  "hints": ["…"],
  "rubric": ["평가 기준 …"],      // 문자열 배열 (객체 {criterion} 도 허용)
  "tags": ["보고서"],
  "difficulty": "초급",
  "estimatedMinutes": 40,
  "createdAt": "ISO", "updatedAt": "ISO"
}
```
API 응답의 `references[]` 에는 파일 시스템에서 계산한 `size, ext, isText` 가 추가된다. `isText` 는 `TEXT_EXTS`(`store.js`)에 있는 확장자이며, 이 파일만 AI 프롬프트에 본문이 들어간다.

## answer.json / chat.json
```jsonc
// answer.json
{ "html": "<p>…</p>", "status": "draft|done", "updatedAt": "ISO" }

// chat.json
{ "messages": [
    { "role": "user", "content": "…", "quickAction": "feedback|null", "ts": "ISO" },
    { "role": "assistant", "content": "…", "provider": "anthropic", "model": "claude-opus-5-5",
      "usage": { "input": 1200, "output": 300 }, "stopReason": "end_turn", "ts": "ISO",
      "error": true /*선택*/, "aborted": true /*선택*/ }
  ], "updatedAt": "ISO" }
```
채팅 요청 시 서버는 `role` 이 user/assistant 이고 `error`/`aborted` 가 아닌, 내용이 있는 최근 30개만 모델에 보낸다. 중단된 응답은 받은 부분 + "(사용자가 중단함)" 으로 `aborted:true` 저장.

## 가져오기/내보내기 형식
문제집 폴더 그대로(`workbook.json` + `problems/<id>/problem.json` + `references/`). 가져올 때 ID 는 새로 발급되고 `references[]` 순서를 유지한다. 예시: `server/seed/library/lib-basics/`. 설치된 내장 문제집은 `workbook.json` 에 `libraryId` 가 기록되어 라이브러리 화면에서 "설치됨" 으로 표시된다.
