// 댓글 UP QR(2026-11-22): 하이라이트 링크를 브라우저에서 바로 QR로 그린다(서버·외부 QR 사이트 호출 없음).
import qrcode from './qrcode-generator.mjs';

// 흰 여백(quiet zone) 포함 SVG. 방송 화면에서도 잘 찍히도록 오류 정정 M.
export function qrSvg(text, { title = 'QR 코드' } = {}) {
  const qr = qrcode(0, 'M'); qr.addData(String(text), 'Byte'); qr.make();
  const n = qr.getModuleCount(); const pad = 4; const size = n + pad * 2;
  let d = '';
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (qr.isDark(y, x)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title);
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}

// PNG 저장용 캔버스(한 칸 scale px)
export function qrCanvas(text, scale = 10) {
  const qr = qrcode(0, 'M'); qr.addData(String(text), 'Byte'); qr.make();
  const n = qr.getModuleCount(); const pad = 4; const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (n + pad * 2) * scale;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (qr.isDark(y, x)) ctx.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
  return canvas;
}

// PNG 저장용 카드(2026-11-22): 위·아래 문구(선택)를 QR과 함께 그린다. 글자는 넘치면 줄여서 한 줄에 맞춘다.
export function qrCard(text, { top = '', bottom = '', font = 'sans-serif' } = {}) {
  const qr = qrCanvas(text, 10); const W = qr.width + 80; const pad = 40;
  const lines = [String(top).trim(), String(bottom).trim()];
  const topH = lines[0] ? 70 : 0; const bottomH = lines[1] ? 70 : 0;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = pad + topH + qr.height + bottomH + pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qr, 40, pad + topH);
  const write = (value, y, weight) => {
    if (!value) return;
    let size = 40; ctx.font = `${weight} ${size}px ${font}`;
    while (size > 16 && ctx.measureText(value).width > W - 60) { size -= 2; ctx.font = `${weight} ${size}px ${font}`; }
    ctx.fillStyle = '#1d1d1f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(value, W / 2, y);
  };
  write(lines[0], pad + topH / 2, 800);
  write(lines[1], pad + topH + qr.height + bottomH / 2, 700);
  return canvas;
}
