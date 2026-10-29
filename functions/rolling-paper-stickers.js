'use strict';

const { randomUUID } = require('node:crypto');

const ROLLING_PAPER_STICKER_SET = Object.freeze(['✨', '💖', '🌸', '🐰', '🎉', '⭐', '💙', '🍀', '🎀', '☁️']);
const ROLLING_PAPER_STICKER_MAX_ITEMS = 250;
const STICKER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stickerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeStickerCoordinate(value) {
  if (typeof value !== 'number') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(96, Math.max(4, number)) * 100) / 100 : null;
}

function normalizeRollingPaperSticker(id, value) {
  if (!STICKER_ID_PATTERN.test(String(id || '')) || !value || typeof value !== 'object' || Array.isArray(value)
    || !ROLLING_PAPER_STICKER_SET.includes(value.emoji)) return null;
  const x = safeStickerCoordinate(value.x);
  const y = safeStickerCoordinate(value.y);
  const createdAt = Number(value.createdAt);
  if (x === null || y === null || !Number.isFinite(createdAt) || createdAt < 1) return null;
  return { id, emoji: value.emoji, x, y, createdAt, updatedAt: Number(value.updatedAt) || createdAt };
}

function normalizeRollingPaperStickers(value) {
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.entries(entries)
    .map(([id, sticker]) => normalizeRollingPaperSticker(id, sticker))
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function validateStickerInput(emoji, x, y) {
  if (!ROLLING_PAPER_STICKER_SET.includes(emoji)) throw stickerError('invalid-argument', '스티커를 선택해 주세요.');
  const safeX = safeStickerCoordinate(x);
  const safeY = safeStickerCoordinate(y);
  if (safeX === null || safeY === null) throw stickerError('invalid-argument', '스티커 위치를 확인해 주세요.');
  return { x: safeX, y: safeY };
}

async function addRollingPaperSticker(rootRef, ownerKey, emoji, x, y, now = Date.now()) {
  const position = validateStickerInput(emoji, x, y);
  const ownersRef = rootRef.child('owners');
  const ownerRef = ownersRef.child(ownerKey);
  const stickersRef = rootRef.child('stickers');
  const previousOwnerId = (await ownerRef.get()).val();
  if (typeof previousOwnerId === 'string' && (await stickersRef.child(previousOwnerId).get()).exists()) {
    throw stickerError('already-exists', '이 팬페이지에는 이미 스티커를 붙였어요. 기존 스티커를 떼고 다시 붙여 주세요.');
  }

  const id = randomUUID();
  const claim = await ownerRef.transaction((current) => {
    if (current && current !== previousOwnerId) return undefined;
    return id;
  });
  if (!claim.committed) throw stickerError('already-exists', '계정당 스티커는 한 개만 붙일 수 있어요.');

  const countRef = rootRef.child('count');
  const countReservation = await countRef.transaction((current) => {
    const count = Math.max(0, Math.floor(Number(current) || 0));
    return count >= ROLLING_PAPER_STICKER_MAX_ITEMS ? undefined : count + 1;
  });
  if (!countReservation.committed) {
    await ownerRef.transaction((current) => current === id ? (previousOwnerId || null) : undefined);
    throw stickerError('resource-exhausted', `스티커는 팬페이지마다 ${ROLLING_PAPER_STICKER_MAX_ITEMS}개까지 붙일 수 있어요.`);
  }

  try {
    await stickersRef.child(id).set({
      ownerKey, emoji, ...position, createdAt: now, updatedAt: now,
    });
  } catch (error) {
    await Promise.all([
      ownerRef.transaction((current) => current === id ? (previousOwnerId || null) : undefined),
      countRef.transaction((current) => Math.max(0, Math.floor(Number(current) || 0) - 1)),
    ]);
    throw error;
  }
  return id;
}

async function moveRollingPaperSticker(rootRef, id, x, y, now = Date.now()) {
  if (!STICKER_ID_PATTERN.test(String(id || ''))) throw stickerError('invalid-argument', '이동할 스티커를 확인해 주세요.');
  const position = validateStickerInput('✨', x, y);
  const stickerRef = rootRef.child('stickers').child(id);
  const transaction = await stickerRef.transaction((current) => {
    // A server transaction can start from an empty local cache even when the
    // sticker exists remotely. Returning null lets RTDB compare with the server
    // value and rerun this callback with the current sticker if needed.
    if (current === null) return null;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    return { ...current, ...position, updatedAt: now };
  });
  const moved = transaction.committed ? normalizeRollingPaperSticker(id, transaction.snapshot.val()) : null;
  if (!moved) throw stickerError('not-found', '이동할 스티커를 찾을 수 없습니다.');
  return moved;
}

async function deleteRollingPaperSticker(rootRef, id, ownerKey, canManage) {
  if (!STICKER_ID_PATTERN.test(String(id || ''))) throw stickerError('invalid-argument', '삭제할 스티커를 확인해 주세요.');
  const stickersRef = rootRef.child('stickers');
  const stickerRef = stickersRef.child(id);
  const initial = (await stickerRef.get()).val();
  if (!initial || typeof initial !== 'object') throw stickerError('not-found', '삭제할 스티커를 찾을 수 없습니다.');
  if (!canManage && initial.ownerKey !== ownerKey) throw stickerError('permission-denied', '본인이 붙인 스티커만 뗄 수 있어요.');
  let foundStickerInTransaction = false;
  const deletion = await stickerRef.transaction((current) => {
    // A transaction may start with an empty local cache even when the prior
    // get() found the sticker remotely. Returning null asks RTDB to compare
    // with the server value and rerun this callback with the current sticker.
    if (current === null) return null;
    if (!current || typeof current !== 'object' || (!canManage && current.ownerKey !== ownerKey)) return undefined;
    foundStickerInTransaction = true;
    return null;
  });
  if (!deletion.committed || !foundStickerInTransaction) throw stickerError('not-found', '삭제할 스티커를 찾을 수 없습니다.');
  const ownerRef = rootRef.child('owners').child(String(initial.ownerKey || ''));
  const countRef = rootRef.child('count');
  await Promise.all([
    ownerRef.transaction((current) => current === id ? null : undefined),
    countRef.transaction((current) => Math.max(0, Math.floor(Number(current) || 0) - 1)),
  ]);
  return true;
}

module.exports = {
  ROLLING_PAPER_STICKER_MAX_ITEMS,
  ROLLING_PAPER_STICKER_SET,
  addRollingPaperSticker,
  deleteRollingPaperSticker,
  moveRollingPaperSticker,
  normalizeRollingPaperSticker,
  normalizeRollingPaperStickers,
  safeStickerCoordinate,
};
