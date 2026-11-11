'use strict';

// 다마고치 분양 카탈로그(서버 기준값). 가격·색·상호작용은 이 파일의 값만 믿는다.
// status: closed(미판매) / preview / on-sale / ended. 비관리자는 공개 단계 public 이고 on-sale 일 때만 분양할 수 있다.
const SPECIES = Object.freeze({
  mongsil: Object.freeze({
    id: 'mongsil',
    name: '몽실이',
    status: 'closed',
    adoptCash: 50,
    colors: Object.freeze(['cream', 'pink', 'mint', 'lavender']),
    baseInteractions: Object.freeze(['pet', 'feed', 'groom', 'gem']),
    trainable: Object.freeze({ play: 10, bath: 10, nap: 10, walk: 10, talk: 10, sing: 10, dance: 10, cheer: 10 }),
  }),
});

function getSpecies(id) {
  const key = typeof id === 'string' ? id : '';
  return Object.prototype.hasOwnProperty.call(SPECIES, key) ? SPECIES[key] : null;
}

function speciesOnSale(species) {
  return !!species && species.status === 'on-sale';
}

// 클라이언트에 보여 줄 카탈로그. 비관리자는 판매 중인 종만, 관리자는 전체.
function publicCatalog({ isAdmin }) {
  return Object.values(SPECIES)
    .filter((s) => isAdmin || speciesOnSale(s))
    .map((s) => ({
      id: s.id, name: s.name, status: s.status, adoptCash: s.adoptCash,
      colors: [...s.colors], baseInteractions: [...s.baseInteractions],
      trainable: Object.entries(s.trainable).map(([id, cash]) => ({ id, cash })),
    }));
}

module.exports = { SPECIES, getSpecies, speciesOnSale, publicCatalog };
