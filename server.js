// 진입점: `npm start` 또는 start.bat 가 실행하는 파일.
// 실제 앱 구성은 server/app.js 에 있다.
import { startServer } from './server/app.js';

startServer().catch((err) => {
  console.error('[pandanix] 서버 시작 실패:', err);
  process.exit(1);
});
