# 🐼 Pandanix — AI 활용 연습 웹 앱

업무 문제(보고서 작성, 의사결정, 분석)를 **AI 와 함께 푸는 연습**을 위한 Windows 로컬 웹 애플리케이션입니다.
문제집을 열고 → 참고자료를 읽고 → 가운데에서 답안을 쓰고 → 오른쪽 AI 채팅에 도움을 받습니다.

![Pandanix 화면 구성: 상단바, 문제 패널, 답안 작성란, AI 채팅](docs/images/overview.png)
*① 상단바 ② 문제 패널 ③ 답안 작성란 ④ AI 채팅*

## 5분 시작

1. [Node.js LTS](https://nodejs.org) 설치 (**22 이상**)
2. `start.bat` 더블클릭 → 브라우저가 `http://localhost:3210` 을 엽니다
3. ⚙️ **설정 → API 키** 에 프로바이더(AI 회사: Claude / GPT / Gemini / OpenCode) 중 하나 이상의 키 입력
4. 내장 문제집(10종)에서 문제를 골라 바로 시작

문제가 있으면 🩺 **Doctor** 버튼(또는 `doctor.bat`)으로 환경을 점검하세요.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 문제집 | 문제집 추가·수정·가져오기·내보내기, 문제마다 지문 / 제출 형식 / 참고자료 / 힌트 / 평가 기준 |
| 내장 문제집 10종 | AI 활용 기초, 업무 보고서, 마케팅, 인사, 고객 서비스, 재무, 영업, 프로젝트 관리, 공공·행정, IT·데이터 (31문제, 참고자료 포함). 첫 실행 시 자동 설치 |
| AI 로 문제집 만들기 | 주제·난이도만 넣으면 문제와 참고자료(md/csv)까지 자동 생성 |
| 답안 작성 | 서식, 표, 이미지, 파일 첨부, 글자 수 제한 확인, 자동 저장, 버전 기록, md/html/txt 내보내기 |
| AI 채팅 | 문제별 대화 기록, 지문·참고자료·내 답안을 컨텍스트로 포함, 빠른 작업(개요/요약/피드백), 응답을 답안에 삽입 |
| 프로바이더 | Claude(Anthropic), GPT(OpenAI), Gemini(Google), OpenCode Zen, OpenAI 호환 서버(Ollama 등) |
| 파일 접근 | 허용한 Windows 폴더 안에서 파일 읽기·쓰기·생성, 참고자료 가져오기, 답안 저장 |
| Doctor | Node·의존성·데이터 폴더·API 키·포트 점검, 실시간 테스트 시 API 연결까지 확인 (UI 와 CLI) |

## 문서

| 읽을 사람 | 문서 |
|---|---|
| 처음 사용하는 분 | [docs/quick-start.md](docs/quick-start.md) |
| 기능별 사용법 (화면 캡처 포함) | [docs/guide/](docs/guide/) (설치 → API 키 → 문제집 → 답안 → 채팅 → AI 생성 → 파일 → Doctor → FAQ) |
| 오프라인 HTML 가이드 | `docs/html/index.html` 을 브라우저로 열기 (`npm run docs:build` 로 재생성) |
| 유지보수하는 사람/AI | [CLAUDE.md](CLAUDE.md) → [docs/dev/](docs/dev/) (아키텍처, 데이터 모델, API, 프로바이더, 유지보수 레시피) |

앱 안에서도 📖 **가이드** 버튼으로 같은 문서를 볼 수 있습니다. 가이드의 화면 캡처는 `npm run docs:shots` 로 다시 만들 수 있습니다(Playwright 필요).

## 명령어

```bat
start.bat               :: 서버 실행 + 브라우저 열기 (처음엔 npm install 자동)
doctor.bat              :: 환경 점검   (doctor.bat --live 는 API 연결까지 테스트)
npm start               :: 서버만 실행
npm run dev             :: 서버 파일 변경 시 자동 재시작 (개발용)
npm run doctor          :: 터미널 doctor   (npm run doctor:live 는 API 연결까지)
npm run validate:library:: 내장 문제집 폴더 무결성 검사
npm test                :: 자동 테스트 (API 키 불필요)
```

## 데이터 위치

모든 데이터는 `data/` 폴더에 평범한 파일로 저장됩니다. 백업은 폴더 복사로 충분합니다.

```
data/config/credentials.json   API 키 (git 제외)
data/config/settings.json      설정
data/workbooks/<id>/           문제집 (workbook.json + problems/<id>/problem.json + references/)
data/answers/<wb>/<p>/         답안(answer.json, history/, attachments/) + 채팅(chat.json)
```

라이선스: MIT
