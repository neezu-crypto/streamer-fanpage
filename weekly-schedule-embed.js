const params = new URLSearchParams(location.search);
const streamer = (params.get('streamer') || '').trim().toLowerCase();
const week = params.get('week') || '';
const status = document.getElementById('status');
const stage = document.getElementById('stage');
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const days = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
const rectangles = [
  ...Array.from({length: 4}, (_, i) => ({x: 585 + i * 262, y: 171, w: 242, h: 323, time: [.08,.17,.82,.18], content: [.10,.40,.80,.34], weekdayY: .90})),
  ...Array.from({length: 3}, (_, i) => ({x: 588 + i * 347, y: 525, w: 317, h: 331, time: [.08,.16,.82,.17], content: [.10,.39,.80,.34], weekdayY: .90})),
];
function dateAt(offset) { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d; }
function dateKey(d) { return d.toISOString().slice(0, 10); }
function dateLabel(d) { return dateKey(d).replace(/-/g, '.'); }
function region(r, a) { return {x:r.x+r.w*a[0],y:r.y+r.h*a[1],w:r.w*a[2],h:r.h*a[3]}; }
function linesFor(text, width, maxLines) {
  const result = []; let line = ''; let truncated = false;
  for (const ch of Array.from(String(text || '').replace(/\r/g, ''))) {
    if (ch === '\n' || (line && ctx.measureText(line + ch).width > width)) {
      result.push(line.trimEnd()); line = ch === '\n' ? '' : ch;
      if (result.length === maxLines) { truncated = true; break; }
    } else line += ch;
  }
  if (line && result.length < maxLines) result.push(line.trimEnd());
  if (truncated && result.length) { let last = result[result.length - 1]; while (last && ctx.measureText(last + '…').width > width) last = Array.from(last).slice(0,-1).join(''); result[result.length - 1] = last + '…'; }
  return result;
}
function centeredText(text, x, y, maxWidth, size, minSize, color) {
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  do { ctx.font = `800 ${size}px Jua, sans-serif`; if (ctx.measureText(text).width <= maxWidth) break; size--; } while (size >= minSize);
  ctx.fillText(text, x, y, maxWidth);
}
async function render(data) {
  await Promise.all([document.fonts.load('30px Jua'), document.fonts.load('30px Gowun')]);
  const image = new Image();
  image.src = data.templateId === 'starlight' ? 'assets/weekly-schedule-starlight.png' : 'assets/weekly-schedule-template.png';
  await image.decode(); ctx.drawImage(image, 0, 0, 1672, 941);
  const starlight = data.templateId === 'starlight';
  stage.classList.toggle('starlight', starlight); stage.classList.toggle('motion', data.animationEnabled !== false);
  const thursday = dateAt(3); const first = new Date(Date.UTC(thursday.getUTCFullYear(), thursday.getUTCMonth(), 1));
  const weekNumber = Math.floor((thursday.getUTCDate() - 1 + (first.getUTCDay()+6)%7) / 7) + 1;
  const color = starlight ? '#493365' : '#a74464';
  centeredText(`${data.nickname}의 ${thursday.getUTCMonth()+1}월 ${weekNumber}주차 일정`,1120,99,660,50,25,color);
  centeredText(data.footerText || `${dateLabel(dateAt(0))} – ${dateLabel(dateAt(6))}`,301,850,408,30,18,color);
  const eventMap = new Map((data.linkedDays || []).map(d => [d.date,d.events || []]));
  rectangles.forEach((r,i) => {
    const entry = data.entries?.[i] || {}; const linked = eventMap.get(dateKey(dateAt(i))) || [];
    const time = entry.offline || linked.some(e => e.typeName === '휴방') ? '휴방' : (entry.time || linked.find(e=>e.time)?.time || '');
    const t = region(r,r.time); const c = region(r,r.content);
    centeredText(time,t.x+t.w/2,t.y+t.h/2,t.w,r.w<260?36:38,25,color);
    ctx.font = `700 ${r.w<260?29:31}px Gowun, sans-serif`; ctx.fillStyle = starlight ? '#594578' : '#a94d6b'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const lineHeight=r.w<260?34:36; const limit=Math.floor(c.h/lineHeight);
    const content=[...(!entry.offline && entry.content?[entry.content]:[]),...linked.map(e=>`${e.time?e.time+' ':''}${e.title||e.typeName||'방송 일정'}`)].flatMap(v=>linesFor(v,c.w,limit)).slice(0,limit);
    content.forEach((line,j)=>ctx.fillText(line,c.x+c.w/2,c.y+c.h/2+(j-(content.length-1)/2)*lineHeight,c.w));
    centeredText(days[i],r.x+r.w/2,r.y+r.h*r.weekdayY,r.w-24,30,25,color);
  });
  const avatar = document.getElementById('avatar'); const url = data.avatar?.thumbUrl || data.avatar?.imageUrl;
  if (url) { avatar.src=url; avatar.hidden=false; avatar.onerror=()=>{avatar.hidden=true;}; }
  stage.hidden=false; status.hidden=true;
}
async function load() {
  if (!/^[a-z0-9_]{1,40}$/.test(streamer) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('일정표 주소를 확인해 주세요.');
  const response=await fetch('https://us-central1-soop-stock-market.cloudfunctions.net/streamerFanPageWeeklySchedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{action:'embed',streamerId:streamer,weekStart:week}})});
  const payload=await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.status === 'NOT_FOUND' ? '저장된 주간 일정표를 찾을 수 없어요.' : '일정표를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  await render(payload.result);
}
load().catch(error=>{status.textContent=error.message || '일정표를 불러오지 못했어요.';});
