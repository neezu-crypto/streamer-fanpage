'use strict';

function parsePostUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch (_) { return null; }
  if (url.protocol !== 'https:' || !['www.sooplive.com', 'sooplive.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
  const match = url.pathname.match(/^\/station\/([a-zA-Z0-9_-]{1,30})\/post\/(\d{1,20})\/?$/);
  return match ? { stationId: match[1].toLowerCase(), postId: match[2] } : null;
}

async function fetchComments(target, streamerId, fetchImpl = fetch) {
  const base = `https://api-channel.sooplive.com/v1.3/channel/${encodeURIComponent(target.stationId)}/post/${target.postId}/comment`;
  const rows = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const response = await fetchImpl(`${base}?page=${page}&orderBy=reg_date&cCommentNo=0`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('댓글을 불러오지 못했어요.');
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('댓글 응답을 확인하지 못했어요.');
    if (page === 1 && payload.data.length === 0 && Number(payload.commentCount) === 0) return [];
    for (const row of payload.data) {
      if (!/^\d+$/.test(String(row.pCommentNo || '')) || !Number.isFinite(Number(row.likeCnt))) throw new Error('댓글 정보가 불완전해요.');
      rows.set(String(row.pCommentNo), row);
    }
    const lastPage = Number(payload.meta?.lastPage);
    if (!Number.isInteger(lastPage) || lastPage < 1 || lastPage > 100) throw new Error('전체 댓글 페이지를 확인할 수 없어요.');
    if (page >= lastPage) {
      const all = [...rows.values()];
      return all.filter(row => String(row.userId || '').toLowerCase() === streamerId.toLowerCase()).map(row => ({
        id: String(row.pCommentNo), content: String(row.comment || '').slice(0, 2000), likes: Math.max(0, Number(row.likeCnt)),
        rank: 1 + all.filter(other => Number(other.likeCnt) > Number(row.likeCnt)).length,
        total: all.length,
      }));
    }
  }
  throw new Error('댓글이 너무 많아 전체 순위를 계산하지 못했어요.');
}

module.exports = { parsePostUrl, fetchComments };
