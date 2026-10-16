// This entry point never reads, migrates or writes game storage. Loading the
// unchanged test-03 runtime requires the player's explicit current-save choice.
const button = document.querySelector('#release-current');
const status = document.querySelector('#release-entry-status');
let starting = false;
async function startCurrent() {
  if (starting || window.location.hash !== '#current') return;
  starting = true;
  button.disabled = true;
  status.textContent = '선택한 기준판의 저장을 확인하고 있습니다.';
  try {
    // The preserved versioned path avoids mixing cached older root modules.
    await import('../test/life-2026-10-16-scene-variety-test-03/web/app.mjs');
  } catch {
    status.textContent = '기준판을 열지 못했습니다. 저장을 지우지 말고 새로고침해 주세요. 이전 기본판 링크도 그대로 이용할 수 있습니다.';
  }
}
button.addEventListener('click', () => {
  window.location.hash = 'current';
  void startCurrent();
});
window.addEventListener('hashchange', () => { void startCurrent(); });
void startCurrent();
