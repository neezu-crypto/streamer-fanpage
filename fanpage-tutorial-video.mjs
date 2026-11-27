// 팬페이지 사용법 영상(2026-11-27): 탭마다 SOOP 다시보기(관리자 방송국에 올린 안내 영상)를 모달로 재생한다.
// 자동 재생 없음 · 음소거로 시작 · 본 기록은 이 브라우저(localStorage)에만 저장하고 서버에는 보내지 않는다.
const STORE_KEY = 'streamerFanPage.tutorialVideos.v1';

function readSeen() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}
export function videoSeen(id) { return Boolean(readSeen()[id]); }
function markSeen(id) {
  try { const seen = readSeen(); seen[id] = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify(seen)); } catch { /* 저장 불가 브라우저는 계속 강조 */ }
}

function embedUrl(vodId) {
  return `https://vod.sooplive.com/player/${encodeURIComponent(vodId)}/embed?showChat=false&autoPlay=true&mutePlay=true`;
}

let openDialog = null;
export function closeTutorialVideo() { openDialog?.close(); }

export function openTutorialVideo({ id, vodId, title }) {
  markSeen(id);
  closeTutorialVideo();
  const dialog = document.createElement('dialog');
  dialog.className = 'fp-video-dialog';
  dialog.setAttribute('aria-label', `${title} 사용법 영상`);
  const shell = document.createElement('div'); shell.className = 'fp-video-shell';
  const head = document.createElement('div'); head.className = 'fp-video-head';
  const label = document.createElement('strong'); label.textContent = `${title} 사용법`;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'fp-video-close'; close.textContent = '×';
  close.setAttribute('aria-label', '사용법 영상 닫기');
  head.append(label, close);
  const frame = document.createElement('div'); frame.className = 'fp-video-frame';
  //  누른 뒤에만 플레이어를 불러온다(외부 요청은 사용자가 열었을 때만).
  const iframe = document.createElement('iframe');
  iframe.src = embedUrl(vodId);
  iframe.title = `${title} 사용법 영상`;
  iframe.allow = 'autoplay; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.append(iframe);
  const foot = document.createElement('p'); foot.className = 'fp-video-foot';
  const link = document.createElement('a'); link.href = `https://vod.sooplive.com/player/${encodeURIComponent(vodId)}`;
  link.target = '_blank'; link.rel = 'noopener'; link.textContent = '재생이 안 되면 SOOP에서 보기 ↗';
  foot.append(link);
  shell.append(head, frame, foot);
  dialog.append(shell);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (openDialog === dialog) openDialog = null; });
  document.body.append(dialog);
  openDialog = dialog;
  dialog.showModal();
  close.focus({ preventScroll: true });
}

// 탭 머리말의 [사용법] 버튼. 아직 보지 않은 영상이면 눈에 띄는 테두리(is-unseen)를 붙인다.
export function createTutorialVideoButton(video) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button fp-tour-replay';
  button.textContent = '▶ 사용법'; button.setAttribute('aria-label', `${video.title} 사용법 영상 보기`);
  button.classList.toggle('is-unseen', !videoSeen(video.id));
  button.addEventListener('click', () => { button.classList.remove('is-unseen'); openTutorialVideo(video); });
  return button;
}
