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
        const text = /JSON 스키마/.test(sys) ? JSON.stringify(WORKBOOK_JSON) : `ECHO: ${last}\n\n| 항목 | 값 |\n|---|---|\n| 시스템길이 | ${sys.length} |\n| 참고자료포함 | ${/## 참고자료/.test(sys)} |\n| 답안포함 | ${/현재 답안 초안/.test(sys)} |`;
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
