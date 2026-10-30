// Server-Sent Events 도우미. 채팅 스트리밍과 AI 생성 진행 표시에 사용.
export function openSse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15000);
  const close = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };
  return { send, close };
}
