"use strict";

// 관리자 통계 카드용: 인증 스트리머별 팬페이지 디자인(layoutDesign) 값을 정리한다.
// 저장된 값이 없으면 기본 디자인(1)로 보되 saved=false로 구분해 "직접 고른 디자인"과 섞이지 않게 한다.
const VALID_DESIGNS = [1, 2, 3];

function normalizeLayoutDesign(value) {
  const number = Number(value);
  if (VALID_DESIGNS.includes(number)) return { layoutDesign: number, layoutDesignSaved: true };
  return { layoutDesign: 1, layoutDesignSaved: false };
}

// streamers: 통계 스냅샷의 스트리머 목록, readDesign(id): 저장된 layoutDesign 값을 돌려주는 함수.
// 읽기에 실패한 스트리머는 null 디자인으로 두어 어느 디자인에도 집계하지 않는다.
async function attachLayoutDesigns(streamers, readDesign) {
  const list = Array.isArray(streamers) ? streamers : [];
  return Promise.all(list.map(async (streamer) => {
    try {
      return { ...streamer, ...normalizeLayoutDesign(await readDesign(streamer.id)) };
    } catch {
      return { ...streamer, layoutDesign: null, layoutDesignSaved: false };
    }
  }));
}

module.exports = { normalizeLayoutDesign, attachLayoutDesigns };
