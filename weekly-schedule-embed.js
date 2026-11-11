import { weeklyTemplate, isWeeklyTemplateId, WEEKLY_WIDTH, WEEKLY_HEIGHT } from './weekly-schedule-templates.mjs?v=20261111-tpl1';
const params = new URLSearchParams(location.search);
const streamer = (params.get('streamer') || '').trim().toLowerCase();
const week = params.get('week') || '';
const status = document.getElementById('status');
const stage = document.getElementById('stage');
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const days = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
function dateAt(offset) { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d; }
function dateKey(d) { return d.toISOString().slice(0, 10); }
function dateLabel(d) { return dateKey(d).replace(/-/g, '.'); }
function region(r, a) { return {x:r.x+r.w*a.left,y:r.y+r.h*a.top,w:r.w*a.width,h:r.h*a.height}; }
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
  const tpl = weeklyTemplate(isWeeklyTemplateId(data.templateId) ? data.templateId : 'default');
  image.src = tpl.embedImage;
  await image.decode(); ctx.drawImage(image, 0, 0, WEEKLY_WIDTH, WEEKLY_HEIGHT);
  const starlight = tpl.motion;
  stage.classList.toggle('starlight', starlight); stage.classList.toggle('motion', data.animationEnabled !== false);
  const thursday = dateAt(3); const first = new Date(Date.UTC(thursday.getUTCFullYear(), thursday.getUTCMonth(), 1));
  const weekNumber = Math.floor((thursday.getUTCDate() - 1 + (first.getUTCDay()+6)%7) / 7) + 1;
  const ink = tpl.ink; const { title: tl, footer: fl } = tpl.layout;
  if (ink.titleShadow) { ctx.shadowColor = ink.titleShadow; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2; }
  centeredText(`${data.nickname}의 ${thursday.getUTCMonth()+1}월 ${weekNumber}주차 일정`,tl.centerX,tl.centerY,tl.maxWidth,50,25,ink.title);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  centeredText(data.footerText || `${dateLabel(dateAt(0))} – ${dateLabel(dateAt(6))}`,fl.centerX,fl.centerY,fl.maxWidth,30,18,ink.footer);
  const eventMap = new Map((data.linkedDays || []).map(d => [d.date,d.events || []]));
  tpl.layout.days.forEach((r,i) => {
    const f = r.font;
    const entry = data.entries?.[i] || {}; const linked = eventMap.get(dateKey(dateAt(i))) || [];
    const isOffline = entry.offline === true;
    const time = isOffline ? '' : linked.some(e => e.typeName === '휴방') ? '휴방' : (entry.time || linked.find(e=>e.time)?.time || '');
    const t = region(r,r.time); const c = region(r,r.content);
    centeredText(time,t.x+t.w/2,t.y+t.h/2,t.w,f.time,Math.min(25,f.time),ink.time);
    if (isOffline) {
      centeredText('휴방',c.x+c.w/2,c.y+c.h/2,c.w,f.offline,Math.min(25,f.offline),ink.offlineDisplay);
      centeredText(days[i],r.x+r.w/2,r.y+r.h*r.weekdayY,r.w-24,f.weekday,Math.min(25,f.weekday),ink.weekday);
      return;
    }
    ctx.font = `700 ${f.content}px Gowun, sans-serif`; ctx.fillStyle = ink.content; ctx.textAlign='center'; ctx.textBaseline='middle';
    const lineHeight=f.line; const limit=Math.floor(c.h/lineHeight);
    const content=[...(!entry.offline && entry.content?[entry.content]:[]),...linked.map(e=>`${e.time?e.time+' ':''}${e.title||e.typeName||'방송 일정'}`)].flatMap(v=>linesFor(v,c.w,limit)).slice(0,limit);
    content.forEach((line,j)=>ctx.fillText(line,c.x+c.w/2,c.y+c.h/2+(j-(content.length-1)/2)*lineHeight,c.w));
    centeredText(days[i],r.x+r.w/2,r.y+r.h*r.weekdayY,r.w-24,f.weekday,Math.min(25,f.weekday),ink.weekday);
  });
  const avatar = document.getElementById('avatar'); const url = data.avatar?.thumbUrl || data.avatar?.imageUrl;
  const al = tpl.layout.avatar;
  Object.assign(avatar.style, {left:`${al.x/WEEKLY_WIDTH*100}%`,top:`${al.y/WEEKLY_HEIGHT*100}%`,width:`${al.w/WEEKLY_WIDTH*100}%`,height:`${al.h/WEEKLY_HEIGHT*100}%`,
    borderRadius: al.radius ? `${al.radius/al.w*100}% / ${al.radius/al.h*100}%` : '',
    clipPath: al.clip ? `polygon(${al.clip.map(([x,y])=>`${x*100}% ${y*100}%`).join(',')})` : ''});
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
