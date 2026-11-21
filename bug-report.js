//  공용 버그 제보 창 (2026-11-21). 팬페이지·갤러리·게임시리즈 상점이 같은 사본을 쓴다.
//  접수는 팬페이지 서버 함수 streamerFanPageViewerStatsBugReports가 맡고(로그인 계정만, 하루 5건·1분 간격·같은 내용 24시간 중복 금지),
//  보내는 값은 제목·내용·서비스 이름·화면 경로(쿼리 제외)뿐이다. 브라우저에는 미완료 요청 번호만 잠시 남긴다.
//  사용: setupBugReport({ service, call, getUid, openLogin, trigger })
//   - call: httpsCallable(functions, 'streamerFanPageViewerStatsBugReports')
//   - getUid: 현재 Firebase UID(없으면 '')
//   - openLogin: 로그인 창 열기(Google·카카오·스트리머 인증 3종)
//   - trigger: 창을 여는 버튼

const STYLE_ID = 'sbr-style';
const CSS = `
.sbr-dialog{width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid rgba(0,0,0,.15);border-radius:16px;background:#fff;color:#1d1d1f;box-shadow:0 18px 50px rgba(0,0,0,.25);font:15px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.sbr-dialog::backdrop{background:rgba(0,0,0,.45)}
.sbr-card{display:flex;flex-direction:column;gap:10px;padding:20px;overflow:auto;max-height:calc(100dvh - 26px);box-sizing:border-box}
.sbr-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sbr-head h2{margin:0;font-size:19px}
.sbr-intro{margin:0;color:#555;font-size:14px}
.sbr-card label{font-weight:600;font-size:14px}
.sbr-card input,.sbr-card textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c9c9cf;border-radius:10px;font:inherit;font-size:16px;color:inherit;background:#fff}
.sbr-card textarea{min-height:140px;resize:vertical}
.sbr-count{align-self:flex-end;color:#777;font-size:12px;margin-top:-6px}
.sbr-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.sbr-btn{min-height:44px;min-width:44px;padding:0 16px;border:1px solid #c9c9cf;border-radius:10px;background:#f4f4f6;color:#1d1d1f;font:inherit;font-weight:600;cursor:pointer}
.sbr-btn[disabled]{opacity:.55;cursor:default}
.sbr-btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
.sbr-footer-link{min-height:44px;padding:0 4px;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.sbr-close{padding:0;font-size:22px;line-height:1}
.sbr-status{margin:0;font-size:14px;min-height:1.5em}
.sbr-status[data-state="error"]{color:#c0262d}
.sbr-status[data-state="success"]{color:#167a3a}
@media (prefers-reduced-motion:no-preference){.sbr-dialog[open]{animation:sbr-in .16s ease-out}@keyframes sbr-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
`;

function randomRequestId() {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function isLoginError(error) {
  const code = String(error?.code || '');
  return error?.details?.loginRequired === true || code.endsWith('unauthenticated') || code.endsWith('permission-denied');
}

export function setupBugReport({ service, call, getUid, openLogin, trigger }) {
  if (!trigger || typeof call !== 'function') return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; document.head.append(style);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'sbr-dialog'; dialog.setAttribute('aria-labelledby', 'sbrTitle');
  dialog.innerHTML = `
    <form class="sbr-card" method="dialog" novalidate>
      <div class="sbr-head"><h2 id="sbrTitle">버그 제보</h2><button type="button" class="sbr-btn sbr-close" data-sbr="close" aria-label="버그 제보 창 닫기" title="닫기">×</button></div>
      <p class="sbr-intro">잘못 보이거나 작동하지 않는 부분을 알려 주세요. 로그인한 계정만 보낼 수 있고, 하루 5건까지 접수돼요. 제목·내용과 보고 있던 화면 주소(검색어 제외)만 관리자에게 전달돼요.</p>
      <label for="sbrTitleInput">제목 (선택)</label>
      <input id="sbrTitleInput" type="text" maxlength="80" autocomplete="off">
      <small class="sbr-count" data-sbr="title-count">0 / 80</small>
      <label for="sbrContentInput">오류 내용 (필수)</label>
      <textarea id="sbrContentInput" maxlength="2000" rows="6" placeholder="언제, 어떤 화면에서, 무엇을 눌렀더니 어떻게 됐는지 적어 주세요."></textarea>
      <small class="sbr-count" data-sbr="content-count">0 / 2000</small>
      <p class="sbr-status" role="status" aria-live="polite" data-sbr="status"></p>
      <div class="sbr-actions">
        <button type="button" class="sbr-btn" data-sbr="login" hidden title="로그인 창 열기">로그인하고 제보하기</button>
        <button type="submit" class="sbr-btn sbr-btn-primary" data-sbr="submit" title="관리자에게 제보 보내기">제보 보내기</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const q = (name) => dialog.querySelector(`[data-sbr="${name}"]`);
  const titleInput = dialog.querySelector('#sbrTitleInput');
  const contentInput = dialog.querySelector('#sbrContentInput');
  const statusEl = q('status'); const submitBtn = q('submit'); const loginBtn = q('login');
  const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.textContent = text; };
  const pendingKey = () => { const uid = getUid(); return uid ? `bugReportPending:${service}:${uid}` : ''; };
  const readPending = () => { try { return JSON.parse(localStorage.getItem(pendingKey()) || 'null'); } catch (_) { return null; } };
  const writePending = (value) => { const key = pendingKey(); if (!key) return; try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch (_) {} };
  const updateCounts = () => {
    q('title-count').textContent = `${titleInput.value.length} / 80`;
    q('content-count').textContent = `${contentInput.value.length} / 2000`;
  };
  titleInput.addEventListener('input', updateCounts);
  contentInput.addEventListener('input', () => { updateCounts(); if (statusEl.dataset.state === 'success') setStatus('idle', ''); });
  q('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  loginBtn.addEventListener('click', () => { dialog.close(); openLogin?.(); });

  trigger.addEventListener('click', async () => {
    loginBtn.hidden = true; setStatus('idle', ''); updateCounts();
    dialog.showModal();
    // 이전에 보내다 끊긴 제보가 있으면 결과를 확인한다.
    const pending = readPending();
    if (pending?.requestId) {
      try {
        const result = (await call({ action: 'status', requestId: pending.requestId })).data || {};
        if (result.status === 'submitted') { writePending(null); setStatus('success', '지난번에 보낸 제보가 접수돼 있어요.'); }
        else { titleInput.value = pending.title || ''; contentInput.value = pending.content || ''; updateCounts(); setStatus('idle', '지난번에 다 보내지 못한 제보를 불러왔어요. 다시 보내 주세요.'); }
      } catch (_) { /* 확인 실패는 무시하고 새로 쓸 수 있게 둔다 */ }
    }
  });

  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim(); const content = contentInput.value.trim();
    if (content.length < 5) { setStatus('error', '오류 내용을 5자 이상 적어 주세요.'); contentInput.focus(); return; }
    if (!getUid()) { setStatus('error', '로그인 후 제보할 수 있어요.'); loginBtn.hidden = false; return; }
    let pending = readPending();
    if (!pending || pending.title !== title || pending.content !== content) pending = { requestId: randomRequestId(), title, content };
    writePending(pending);
    submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); setStatus('idle', '제보를 보내는 중이에요…');
    try {
      await call({ action: 'submit', requestId: pending.requestId, title, content, service, page: location.pathname });
      writePending(null); titleInput.value = ''; contentInput.value = ''; updateCounts();
      setStatus('success', '제보가 접수됐어요. 확인 후 고칠게요. 감사합니다!');
    } catch (error) {
      if (isLoginError(error)) {
        writePending(null);
        setStatus('error', '버그 제보는 로그인한 계정(Google·카카오·스트리머 인증)만 보낼 수 있어요.');
        loginBtn.hidden = false;
      } else {
        if (String(error?.code || '').endsWith('resource-exhausted') || String(error?.code || '').endsWith('invalid-argument')) writePending(null);
        setStatus('error', error?.message || '제보를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    } finally { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
  });
}
