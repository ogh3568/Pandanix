// 프로바이더 무응답 감시: 일정 시간 동안 토큰이 하나도 오지 않으면 요청을 끊어 화면이 영원히 "응답 중" 으로 남지 않게 한다.
export const STALL_TIMEOUT_MS = Number(process.env.PANDANIX_STALL_TIMEOUT_MS || 5 * 60 * 1000);

/**
 * @param {AbortController} abort  끊을 때 abort() 할 컨트롤러
 * @param {(msg:string)=>void} onStall  끊은 뒤 호출 (오류 메시지 전달)
 * @returns {{ touch():void, stop():void, stalled:boolean }}
 */
export function createStallWatchdog(abort, onStall, ms = STALL_TIMEOUT_MS) {
  const state = { stalled: false };
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.stalled = true;
      abort.abort();
      onStall(`AI 서버에서 ${Math.round(ms / 60000)}분 동안 응답이 없어 요청을 중단했습니다. 네트워크나 프로바이더 상태를 확인하고 다시 시도하세요.`);
    }, ms);
  };
  arm();
  return {
    get stalled() { return state.stalled; },
    touch: arm,
    stop: () => clearTimeout(timer),
  };
}
