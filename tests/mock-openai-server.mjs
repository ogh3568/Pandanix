// 테스트용 OpenAI 호환 모의 서버. 실제 API 키 없이 스트리밍/생성 경로를 검증한다.
// 사용: node tests/mock-openai-server.mjs [port]
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2] || process.env.MOCK_PORT || 3999);

const WORKBOOK_JSON = {
  title: '모의 문제집',
  description: '모의 서버가 만든 문제집',
  category: '테스트',
  difficulty: '초급',
  problems: [
    {
      title: '모의 문제 1',
      prompt: '모의 지문입니다.',
      submission: { format: '메모', charLimit: 300, deliverables: ['메모'] },
      references: [{ name: '모의 자료', file: '자료.md', description: '설명', content: '# 자료\n\n내용' }, { name: 'CSV', file: 'data.csv', description: 'csv', content: 'a,b\n1,2' }],
      hints: ['힌트'],
      rubric: ['기준'],
      tags: ['t'],
      estimatedMinutes: 5,
    },
  ],
};

/** 문서 스크린샷용 그럴듯한 요약 응답 */
const CANNED_SUMMARY = `참고자료 3건을 요약했습니다.

### 1. 설비 현황
- 2013년 도입한 200톤 프레스, 장부가 0원(상각 완료), 설계 수명 12~15년
- 2026년부터 순정 부품 공급 종료 예정

### 2. 2025년 고장 이력 (1~10월)
| 구분 | 값 |
|---|---|
| 고장 건수 | 19건 |
| 총 정지 시간 | 92시간 |
| 수리비 합계 | 1,655만 원 |
| 주요 원인 | 클러치 마모, 크랭크 베어링 |

### 3. 신규 설비 견적
| 항목 | A사 서보 SP-220 | B사 기계식 MP-200X |
|---|---|---|
| 가격 | 2억 6,000만 원 | 1억 9,500만 원 + 설치 1,500만 원 |
| 납기 | 4개월 | 6개월(통관 지연 가능) |
| 보증 | 3년 | 1년 |

다음 단계로 "유지보수 지속 시 연간 비용을 계산해 줘" 라고 요청해 보세요.`;

export function startMock(p = port) {
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }, { id: 'mock-model-2', object: 'model' }] }));
    }
    if (req.url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body);
        if (!req.headers.authorization || req.headers.authorization === 'Bearer bad') {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }));
        }
        const sys = j.messages.find((m) => m.role === 'system')?.content || '';
        const last = j.messages[j.messages.length - 1].content;
        if (/STALL/.test(last)) {
          // 무응답 시뮬레이션: 헤더만 보내고 아무것도 보내지 않는다 (클라이언트가 끊을 때까지)
          res.setHeader('content-type', 'text/event-stream');
          res.write(': open\n\n');
          res.on('close', () => res.end()); // req 'close' 는 본문 수신 직후 발생하므로 res 쪽을 본다
          return;
        }
        const text = /JSON 스키마/.test(sys)
          ? JSON.stringify(WORKBOOK_JSON)
          : /요약/.test(last)
            ? CANNED_SUMMARY
            : `ECHO: ${last}\n\n| 항목 | 값 |\n|---|---|\n| 시스템길이 | ${sys.length} |\n| 참고자료포함 | ${/## 참고자료/.test(sys)} |\n| 답안포함 | ${/현재 답안 초안/.test(sys)} |`;
        res.setHeader('content-type', 'text/event-stream');
        const chunks = text.match(/[\s\S]{1,40}/g) || [];
        let i = 0;
        const tick = () => {
          if (i < chunks.length) {
            res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: chunks[i++] }, finish_reason: null }] })}\n\n`);
            setTimeout(tick, 5);
          } else {
            res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }
        };
        tick();
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(p, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMock().then(() => console.log(`mock openai server on http://127.0.0.1:${port}/v1`));
}
