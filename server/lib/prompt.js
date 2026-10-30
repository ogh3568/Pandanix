// AI 채팅/생성에 쓰는 프롬프트 템플릿. 문구 튜닝은 이 파일에서만 하면 된다.
import { getProblem, readReferencesAsText } from './store.js';
import { loadSettings } from '../config.js';

export const APP_PERSONA = `당신은 "Pandanix" 라는 AI 활용 연습 앱 안의 학습 도우미입니다.
사용자는 업무 문제(보고서 작성, 의사결정, 분석 등)를 AI 를 활용해 해결하는 연습을 하고 있습니다.
원칙:
- 한국어로 답합니다(사용자가 다른 언어로 물으면 그 언어로).
- 참고자료가 주어지면 그 안의 수치·사실을 근거로 삼고, 자료에 없는 내용은 추정임을 밝힙니다.
- 답을 통째로 대신 써 주기보다, 사용자가 요청한 범위만 도와줍니다. 사용자가 "초안을 써줘" 라고 하면 써 줍니다.
- 표가 유용하면 Markdown 표를 사용합니다.
- 제출 형식(글자 수 제한 등)이 있으면 그것을 지키도록 안내합니다.`;

/**
 * 문제 컨텍스트를 포함한 시스템 프롬프트를 만든다.
 * @param {object} opts
 * @param {string} [opts.workbookId]
 * @param {string} [opts.problemId]
 * @param {{problem?:boolean, references?:boolean, answer?:boolean}} [opts.context]
 * @param {string} [opts.answerText]  현재 답안(일반 텍스트/마크다운)
 */
export function buildSystemPrompt({ workbookId, problemId, context = {}, answerText = '' }) {
  const settings = loadSettings();
  const parts = [APP_PERSONA];
  const hasProblem = workbookId && problemId && workbookId !== 'general';
  if (hasProblem && context.problem !== false) {
    const p = getProblem(workbookId, problemId);
    parts.push(`## 현재 문제: ${p.title}\n\n### 지문\n${p.prompt}\n\n### 제출 형식\n${p.submission?.format || '(지정 없음)'}${
      p.submission?.charLimit ? `\n글자 수 제한: ${p.submission.charLimit}자 이내` : ''
    }${p.submission?.deliverables?.length ? `\n산출물: ${p.submission.deliverables.join(', ')}` : ''}`);
    if (p.rubric?.length) parts.push(`### 평가 기준(루브릭)\n${p.rubric.map((r) => `- ${typeof r === 'string' ? r : r.criterion || JSON.stringify(r)}`).join('\n')}`);
    if (context.references !== false) {
      const refs = readReferencesAsText(workbookId, problemId, settings.chat.maxReferenceChars);
      if (refs) parts.push(`## 참고자료\n\n${refs}`);
    }
  }
  if (context.answer && answerText?.trim()) {
    parts.push(`## 사용자의 현재 답안 초안\n\n${answerText.slice(0, 60000)}`);
  }
  return parts.join('\n\n');
}

/**
 * 빠른 작업 버튼 (단일 소스). 순서 = 버튼 순서.
 *  label: 버튼 문구, prompt: AI 에게 보내는 사용자 메시지, needsAnswer: 현재 답안을 자동으로 포함할지
 * 추가하려면 여기에만 항목을 넣으면 된다 (클라이언트는 /api/chat-quick-actions 로 받아 렌더).
 */
export const QUICK_ACTIONS = {
  outline: { label: '📝 개요 제안', needsAnswer: false, prompt: '이 문제에 대한 답안의 개요(목차)를 제안해 주세요. 각 항목에 어떤 내용을 담아야 할지 한 줄씩 설명해 주세요.' },
  summarize_refs: { label: '📊 자료 요약', needsAnswer: false, prompt: '참고자료의 핵심 내용을 항목별로 요약해 주세요. 수치가 있으면 표로 정리해 주세요.' },
  feedback: { label: '✅ 답안 피드백', needsAnswer: true, prompt: '내 현재 답안 초안을 제출 형식과 평가 기준에 비추어 평가해 주세요. 잘한 점, 부족한 점, 구체적인 개선 제안을 순서대로 주세요. 글자 수 제한이 있으면 준수 여부도 알려 주세요.' },
  proofread: { label: '✍️ 문장 다듬기', needsAnswer: true, prompt: '내 현재 답안 초안의 문장을 다듬어 주세요. 의미는 유지하고, 수정한 부분과 이유를 간단히 표로 정리해 주세요.' },
  questions: { label: '❓ 질문 거리', needsAnswer: false, prompt: '이 문제를 더 잘 풀기 위해 내가 스스로 던져봐야 할 질문 5개를 제안해 주세요.' },
};

/** AI 문제집 생성 프롬프트 */
export function buildWorkbookGenerationPrompt({ topic, count = 3, difficulty = '중급', audience = '', extra = '' }) {
  const system = `당신은 기업 실무 교육용 "AI 활용 문제집" 을 설계하는 전문가입니다.
반드시 아래 JSON 스키마에 맞는 JSON 하나만 출력하세요. 설명 문장, 마크다운 코드펜스 없이 JSON 만 출력합니다.

{
  "title": "문제집 제목",
  "description": "문제집 소개 (2~3문장)",
  "category": "분야",
  "difficulty": "초급|중급|고급",
  "problems": [
    {
      "title": "문제 제목",
      "prompt": "문제 지문 (마크다운, 상황 설명 + 요구사항. 300~800자)",
      "submission": { "format": "제출 형식 설명 (예: 의사결정 보고서, 개요-본문-결론 구조)", "charLimit": 1000, "deliverables": ["보고서 본문", "핵심 수치 표"] },
      "references": [
        { "name": "자료 이름", "file": "파일명.md 또는 .csv", "description": "자료 설명 한 줄", "content": "자료 본문. md 는 마크다운, csv 는 헤더 포함 CSV. 실제 업무 자료처럼 구체적 수치와 세부사항 포함. 800~2500자" }
      ],
      "hints": ["AI 에게 이렇게 물어보면 좋다는 힌트 2~3개"],
      "rubric": ["평가 기준 3~5개"],
      "tags": ["태그"],
      "estimatedMinutes": 30
    }
  ]
}

규칙:
- 문제마다 참고자료 2~4개. 자료끼리 수치가 서로 모순되지 않게 하고, 문제를 풀려면 자료를 실제로 읽어야 하도록 만드세요.
- 참고자료 안에는 일부러 "의사결정에 필요한 정보" 와 "관련 없어 보이는 정보" 를 섞으세요.
- 가상의 회사/제품명을 사용하세요. 실존 인물·기업의 실제 데이터처럼 보이게 쓰지 마세요.
- JSON 문자열 안의 줄바꿈은 \\n 으로 이스케이프하세요.`;

  const user = `주제/분야: ${topic}
문제 수: ${count}
난이도: ${difficulty}
${audience ? `대상 학습자: ${audience}\n` : ''}${extra ? `추가 요구사항: ${extra}\n` : ''}
위 조건으로 문제집 JSON 을 생성하세요.`;
  return { system, user };
}

/** 모델 출력에서 JSON 객체를 최대한 안전하게 뽑아낸다. */
export function extractJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('응답에서 JSON 을 찾지 못했습니다.');
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // 흔한 오류 보정: 후행 콤마
    const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  }
}
