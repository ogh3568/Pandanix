// 테마(라이트/다크/시스템) 토글. 초기 적용은 index.html 의 인라인 스크립트가 먼저 한다(깜빡임 방지).
const KEY = 'pandanix:theme';
const ORDER = ['system', 'light', 'dark'];
const LABEL = { system: '시스템 설정 따름', light: '라이트 모드', dark: '다크 모드' };
const ICON = { system: '🌓', light: '☀️', dark: '🌙' };

export function getTheme() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  root.classList.toggle('system-dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {}
}

/** 버튼을 클릭할 때마다 시스템 → 라이트 → 다크 순으로 바꾼다 */
export function initThemeToggle(button) {
  if (!button) return;
  const render = () => {
    const t = getTheme();
    button.textContent = ICON[t];
    button.title = `테마: ${LABEL[t]} (클릭해 전환)`;
  };
  button.addEventListener('click', () => {
    const next = ORDER[(ORDER.indexOf(getTheme()) + 1) % ORDER.length];
    applyTheme(next);
    render();
    button.dispatchEvent(new CustomEvent('themechange', { detail: next, bubbles: true }));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getTheme()));
  render();
}
