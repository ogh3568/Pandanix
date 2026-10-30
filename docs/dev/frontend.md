# 프런트엔드 메모

- 빌드 도구 없음. `public/js/*.js` 는 브라우저 ES 모듈. 외부 라이브러리 없음 → 오프라인 동작, 보안 업데이트 부담 없음.
- 스타일은 `public/css/app.css` 하나. 색/간격/폰트는 `:root` 변수. 레이아웃은 CSS grid 3열(`--left-w`, `--right-w`), 스플리터로 조절(localStorage 저장).
- 상태: `state.js` 의 단일 객체 + `on/emit` 이벤트. 패널 간 직접 참조 대신 이벤트 사용(목록은 `architecture.md`).
- 모든 서버 호출은 `api.js`. 새 엔드포인트를 쓰려면 여기에 함수 추가.
- 팝업은 `ui/modal.js` 의 `openModal / confirmDialog / promptDialog / toast` 만 사용. 폼은 `field/input/textarea/formValues` 도우미.
- Markdown 렌더링은 `markdown.js renderMarkdown()`. 입력을 항상 escape 하므로 `innerHTML` 에 안전. 지원 문법이 부족하면 이 파일을 확장(표·중첩 목록·코드블록·인용·링크 지원).
- 에디터(`ui/editor.js`)는 `contenteditable` + `document.execCommand`. 저장 전·삽입 전 `sanitize()` 로 허용 태그만 남긴다. 표 도구는 캐럿 위치 기반 팝오버. 블록 요소를 표 셀 안에 삽입하면 중첩되므로 `insertHtml` 이 캐럿을 표 뒤로 옮긴다.
- 채팅(`ui/chat.js`)은 `streamPost` 로 SSE 를 받고 120ms 간격으로 재렌더. `_raw` 에 원문 Markdown 을 보관해 "답안에 삽입/복사" 에 사용.
- 파일 선택기(`ui/filepicker.js`)는 `pickPath({mode:'file'|'dir'|'save'})` 하나로 참고자료 가져오기, 내보내기 위치, 문제집 가져오기를 모두 처리.
- 문서 뷰어 `public/docs-viewer.html` 은 `/api/docs` 목록과 `/docs/*.md` 를 같은 렌더러로 표시. 문서의 상대 `.md` 링크는 해시 링크로 변환된다.

## 자주 하는 UI 작업
| 작업 | 위치 |
|---|---|
| 상단바 버튼 추가 | `index.html .topbar-actions` + `app.js boot()` 에 핸들러 |
| 문제 탭 추가 | `sidebar.js renderProblem()` 의 `tabs` 배열 + `renderTab()` 분기 |
| 에디터 툴바 버튼 | `editor.js initEditor()` 의 툴바 HTML + 핸들러 |
| 빠른 작업 라벨 | `chat.js QUICK_LABELS` (문구는 서버 `prompt.js`) |
| 설정 섹션 추가 | `settings.js sections` 배열 + `renderXxx()` |
| 색상 테마 | `app.css :root` |
