'use strict';

// 다마고치 공개 단계: closed(기본, 비관리자에게 "분양소 준비 중"만) / admin(관리자 개발·검수) / public(판매 개시)
const TAMAGOTCHI_STAGE_PATH = 'streamerFanPageTamagotchi/config/stage';
const TAMAGOTCHI_STAGES = new Set(['closed', 'admin', 'public']);

function normalizeTamagotchiStage(value) {
  const stage = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TAMAGOTCHI_STAGES.has(stage) ? stage : 'closed';
}

async function readTamagotchiStage(db) {
  try {
    const snapshot = await db.ref(TAMAGOTCHI_STAGE_PATH).get();
    return normalizeTamagotchiStage(snapshot.val());
  } catch (_) {
    return 'closed'; // 읽기 실패 시 안전하게 닫힌 상태
  }
}

// 비관리자는 public 단계에서만 다마고치 기능(신청·조회)을 쓸 수 있다.
function tamagotchiOpenFor(stage, isAdmin) {
  return isAdmin === true || normalizeTamagotchiStage(stage) === 'public';
}

module.exports = { TAMAGOTCHI_STAGE_PATH, normalizeTamagotchiStage, readTamagotchiStage, tamagotchiOpenFor };
