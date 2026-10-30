# 프런트엔드 메모

- 빌드 도구 없음. `public/js/*.js` 는 브라우저 ES 모듈. 외부 라이브러리 없음 → 오프라인 동작, 보안 업데이트 부담 없음.
- 스타일은 `public/css/app.css` 하나. 색/간격/폰트는 `:root` 변수. **다크 모드**는 같은 변수를 `:root[data-theme="dark"]`(수동)과 `.system-dark`(시스템 설정)에서 덮어쓴다. 새 색을 쓸 때는 hex 를 직접 쓰지 말고 토큰(`--panel`, `--input-bg`, `--ok-bg/--ok-fg`, `--danger-bg/--danger-fg` …)을 쓴다. 토글·저장은 `public/js/theme.js`, 깜빡임 방지 초기화는 각 HTML `<head>` 의 인라인 스크립트(index.html, docs-viewer.html, build-docs-html.mjs 템플릿). 레이아웃은 CSS grid 3열(`--left-w`, `--right-w`), 스플리터로 조절(localStorage 저장).
- 상태: `state.js` 의 단일 객체 + `on/emit` 이벤트. 패널 간 직접 참조 대신 이벤트 사용(목록은 `architecture.md`).
- 모든 서버 호출은 `api.js`. 새 엔드포인트를 쓰려면 여기에 함수 추가.
- 팝업은 `ui/modal.js` 의 `openModal / confirmDialog / promptDialog / toast` 만 사용. 폼은 `field/input/textarea/formValues` 도우미.
- Markdown 렌더링은 `markdown.js renderMarkdown()`. 입력을 항상 escape 하므로 `innerHTML` 에 안전. 지원: 제목(id 자동 부여), 굵게/기울임/취소선, 인라인 코드(안의 `*`/`_`/`|` 는 서식으로 보지 않음), 코드블록, 링크(절대 URL 은 새 탭, 상대 `.md`·`#앵커` 는 같은 창), 목록(중첩 1단계, 번호 시작값 유지), 표(셀 안 `\|`·코드 안 `|` 허용), 인용, 수평선. 미지원: HTML 태그, 체크박스 목록, 각주, 2단계 이상 중첩.
- 에디터(`ui/editor.js`)는 `contenteditable` + `document.execCommand`. 저장 전·삽입 전 `sanitize()` 로 허용 태그만 남긴다. 표 도구는 캐럿 위치 기반 팝오버. 블록 요소를 표 셀 안에 삽입하면 중첩되므로 `insertHtml` 이 캐럿을 표 뒤로 옮긴다.
- 채팅(`ui/chat.js`)은 `streamPost` 로 SSE 를 받고 120ms 간격으로 재렌더. `_raw` 에 원문 Markdown 을 보관해 "답안에 삽입/복사" 에 사용.
- 파일 선택기(`ui/filepicker.js`)는 `pickPath({mode:'file'|'dir'|'save'})` 하나로 참고자료 가져오기, 내보내기 위치, 문제집 가져오기를 모두 처리.
- 문서 뷰어 `public/docs-viewer.html` 은 `/api/docs` 목록과 `/docs/*.md` 를 같은 렌더러로 표시. 상대 `.md` 링크와 `#앵커` 는 뷰어 해시(`#경로#앵커`)로 변환되고, 개발 문서 그룹은 접혀 있다.
- 팝업: 모달은 `openModal`(스택 관리, Esc 는 최상위만, 포커스 트랩·복귀), 메뉴는 `openMenu`(Esc·방향키). 토스트는 오른쪽 아래, 같은 메시지는 합쳐진다.
- 오프라인: `api.js connection` 이 네트워크 오류를 감지하면 상단 배너가 뜨고, 에디터는 "저장 안 됨" 표시와 함께 localStorage(`pandanix:backup:<wb>/<p>`)에 백업한다. 서버가 돌아오면 자동 저장하고, 다음 로드 때 더 새로운 백업이 있으면 복구를 묻는다.
- 레이아웃: 가운데 최소 폭 420px 보장, 1440/1200px 이하에서 패널 기본 폭 축소, 1500px 이하에서 툴바 글자 숨김(아이콘만). 스플리터 더블클릭은 기본 폭 복원, 상단 `|◀` `▶|` 버튼(또는 Ctrl+\\ / Ctrl+/)으로 패널 접기.

## 자주 하는 UI 작업
| 작업 | 위치 |
|---|---|
| 상단바 버튼 추가 | `index.html .topbar-actions` + `app.js boot()` 에 핸들러 |
| 문제 탭 추가 | `sidebar.js renderProblem()` 의 `tabs` 배열 + `renderTab()` 분기 |
| 에디터 툴바 버튼 | `editor.js initEditor()` 의 툴바 HTML + 핸들러 |
| 빠른 작업 버튼 | 서버 `prompt.js QUICK_ACTIONS` 한 곳(label/prompt/needsAnswer). 프런트는 자동 렌더 |
| 설정 섹션 추가 | `settings.js sections` 배열 + `renderXxx()` + `show()` 의 디스패치 객체에 등록 |
| 색상 테마 | `app.css :root` |
