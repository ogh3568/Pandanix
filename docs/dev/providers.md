# AI 프로바이더

## 등록 (`server/config.js` → `PROVIDERS`)
```js
anthropic: { label, kind: 'anthropic', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-opus-5-5', keyUrl, fields: ['apiKey'] }
openai:    { kind: 'openai', ... fields: ['apiKey','baseUrl','organization'] }
gemini:    { kind: 'gemini', ... }
opencode:  { kind: 'openai', defaultBaseUrl: 'https://opencode.ai/zen/v1', ... }   // OpenAI 호환
custom:    { kind: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', ... }    // Ollama 등, 키 선택
```
`kind` 가 어댑터를 결정한다(`providers/index.js getProvider`). 같은 `kind` 를 공유하는 항목은 설정(키/BaseURL)만 다르다.

## 어댑터 규약 (`providers/*.js`)
- `streamChat()` 은 텍스트 델타를 `onDelta` 로 흘리고 최종 `{ text, stopReason, usage, model }` 반환. 오류는 **한국어 메시지 + `status`** 로 정규화(`normalizeError`). 상태 코드별 문구(401/403/404/429/5xx)를 유지할 것.
- `abortSignal` 을 SDK 요청 옵션으로 전달해 사용자의 ■ 중지가 실제 요청 취소로 이어지게 한다.
- `listModels()` 는 설정 UI 의 "목록" 과 doctor `--live`, 연결 테스트에 쓰인다.

### Anthropic (`anthropic.js`)
- 공식 `@anthropic-ai/sdk`, `client.messages.stream()` + `finalMessage()`. timeout 20분, maxRetries 2.
- **thinking 파라미터를 보내지 않는다.** Claude 5 세대는 adaptive 가 기본이고 `budget_tokens` 는 400 을 낸다.
- **샘플링 파라미터(temperature 등)도 보내지 않는다.**
- 모델 ID 는 날짜 접미사 없이(`claude-opus-5-5`). 사용 가능한 ID 는 `listModels()` 로 확인.
- 서버측 대체(fallbacks): `settings.anthropic.fallbacks`(기본 true) 이고 모델이 `claude-opus-5*`, `claude-sonnet-5-5`, `claude-fable-5*` 중 하나면 `client.beta.messages.stream({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`. 400 으로 거부되면 일반 호출로 1회 재시도.
- `stop_reason === 'refusal'` 은 `routes/chat.js` 에서 사용자 안내 문구로 바꾼다. `max_tokens` 는 "계속" 안내.
- 최신 API 규약 변경은 Anthropic 공식 문서(https://platform.claude.com/docs)를 확인한다.

### OpenAI 호환 (`openai.js`)
- `chat.completions.create({ stream:true, max_completion_tokens, stream_options:{include_usage:true} })`.
- 일부 호환 서버가 `max_completion_tokens`/`stream_options` 를 거부하면 `max_tokens` 만으로 재시도.
- `baseUrl` 이 있으면 `baseURL` 로. OpenCode Zen 은 모델에 따라 `/responses` 만 지원하기도 하므로 chat/completions 에서 404 가 나는 모델은 다른 모델을 고르게 안내한다(guide/05 오류 표, guide/02).
- finish_reason 매핑: `stop`→`end_turn`, `length`→`max_tokens`, `content_filter`→`refusal`. 연결 오류는 `OpenAI.APIConnectionError` 로 판별해 한국어 안내.

### Gemini (`gemini.js`)
- `@google/genai` `ai.models.generateContentStream({ model, contents, config:{ systemInstruction, maxOutputTokens, abortSignal } })`.
- 역할 매핑: assistant → `model`. 모델 목록은 `supportedActions` 에 `generateContent` 가 있는 것만.
- finishReason 매핑: `MAX_TOKENS`→`max_tokens`, `SAFETY`/`PROHIBITED_CONTENT`/`BLOCKLIST`/`SPII`/`RECITATION` 또는 `promptFeedback.blockReason`→`refusal`.

## 새 프로바이더 추가 절차
1. `config.js PROVIDERS` 에 항목 추가. 필수 키: `label, kind, envKey, defaultModel, keyUrl, fields`. 선택: `defaultBaseUrl, note, keyOptional`(키 없이 동작하는 로컬 서버면 반드시 true). OpenAI 호환이면 `kind: 'openai'` + `defaultBaseUrl` 만으로 **동작한다** — 설정 화면·상단바·doctor·기본 모델 목록은 `PROVIDERS` 를 순회한다.
2. 새 SDK 가 필요하면 `providers/<name>.js` 에 어댑터 작성, `providers/index.js` 의 switch 에 `kind` 추가, `package.json` 의존성 추가(ADR-2 기록).
3. 마무리 체크리스트: `DEFAULT_CREDENTIALS`(config.js) 와 `data/config/credentials.example.json` 에 빈 항목, `docs/guide/02-API-키-설정.md` 의 프로바이더 표와 환경변수 표, FAQ 의 프록시 허용 호스트 목록, README 의 프로바이더 나열, `changelog.md`.
4. `npm test` (모의 서버는 OpenAI 호환만 흉내 내므로 다른 kind 는 `ping()` 을 수동 확인).

## 프롬프트 (`server/lib/prompt.js`)
- `APP_PERSONA`: 모든 채팅의 시스템 프롬프트 머리말.
- `buildSystemPrompt()`: 문제 컨텍스트 조립. 참고자료는 `settings.chat.maxReferenceChars` 로 자른다.
- `QUICK_ACTIONS`: 빠른 작업 키 → 사용자 메시지. 키를 추가하면 `public/js/ui/chat.js` 의 `QUICK_LABELS` 에 라벨도 추가.
- `buildWorkbookGenerationPrompt()` + `extractJson()`: 생성 스키마. 스키마 변경 시 `routes/generate.js saveGenerated` 동기화.
