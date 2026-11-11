// 주간 방송표 템플릿 설정. 이미지마다 칸 위치·글자색·글자 크기가 달라서 템플릿별로 모두 따로 둔다.
// 웹 화면(app.js)과 임베드(weekly-schedule-embed.js)가 같은 값을 쓴다.
// 좌표는 모두 원본 이미지 1672×941px 기준이다. 서버(functions/weekly-schedule-template.js)의
// 템플릿 id 목록과 `premium` 값이 같아야 한다(기본 템플릿만 무료).

export const WEEKLY_WIDTH = 1672;
export const WEEKLY_HEIGHT = 941;

const frozen = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(frozen);
  return Object.freeze(value);
};

// 기존(기본·별빛 방송국) 글자 크기 규칙: 폭 260 미만이면 한 단계 작게.
function legacyFonts(w) {
  const narrow = w < 260;
  return { time: narrow ? 36 : 38, content: narrow ? 29 : 31, line: narrow ? 34 : 36, weekday: 30, offline: narrow ? 42 : 44, offlineLine: narrow ? 50 : 52, linked: 16 };
}
// 새 템플릿의 글자 크기는 카드 크기에 비례해 줄이되 읽을 수 있는 하한(0.72)을 둔다.
function scaledFonts(w, h) {
  const scale = Math.min(1, Math.max(0.72, Math.min(w / 242, h / 310)));
  const r = (value) => Math.round(value * scale);
  return { time: r(38), content: r(31), line: r(36), weekday: r(30), offline: r(44), offlineLine: r(52), linked: Math.max(13, r(16)) };
}

const LEGACY_REGIONS = {
  row1: { time: { left: 0.08, top: 0.17, width: 0.82, height: 0.18 }, content: { left: 0.10, top: 0.40, width: 0.80, height: 0.34 }, linked: { left: 0.08, top: 0.75, width: 0.84, height: 0.09 }, offline: { top: 0.065 }, weekdayY: 0.90 },
  row2: { time: { left: 0.08, top: 0.16, width: 0.82, height: 0.17 }, content: { left: 0.10, top: 0.39, width: 0.80, height: 0.34 }, linked: { left: 0.08, top: 0.74, width: 0.84, height: 0.09 }, offline: { top: 0.065 }, weekdayY: 0.90 },
};
// 새 템플릿은 "보이는 종이 칸" 자체를 기준으로 잡는다(장식 테두리 제외).
const PAPER_REGIONS = {
  row1: { time: { left: 0.08, top: 0.07, width: 0.84, height: 0.17 }, content: { left: 0.08, top: 0.27, width: 0.84, height: 0.42 }, linked: { left: 0.08, top: 0.72, width: 0.84, height: 0.09 }, offline: { top: -0.075 }, weekdayY: 0.90 },
  row2: { time: { left: 0.08, top: 0.06, width: 0.84, height: 0.19 }, content: { left: 0.08, top: 0.28, width: 0.84, height: 0.38 }, linked: { left: 0.08, top: 0.68, width: 0.84, height: 0.10 }, offline: { top: -0.075 }, weekdayY: 0.88 },
};

function days(cards, regions, fontsFor) {
  return cards.map(([x, y, w, h], index) => {
    const base = index < 4 ? regions.row1 : regions.row2;
    return { x, y, w, h, ...base, font: fontsFor(w, h, index) };
  });
}
const paperDays = (cards, overrides = {}) => days(cards, PAPER_REGIONS, (w, h, i) => overrides[i] || scaledFonts(w, h));

const baseLayout = {
  title: { centerX: 1120, centerY: 99, maxWidth: 660, previousX: 722, nextX: 1515 },
  avatar: { x: 94, y: 176, w: 390, h: 565 },
  footer: { centerX: 301, centerY: 850, maxWidth: 408, field: { x: 81, y: 822, w: 440, h: 56 } },
  days: days([
    ...Array.from({ length: 4 }, (_, i) => [585 + i * 262, 171, 242, 323]),
    ...Array.from({ length: 3 }, (_, i) => [588 + i * 347, 525, 317, 331]),
  ], LEGACY_REGIONS, (w) => legacyFonts(w)),
};

// 글자색: title(제목), footer(하단 문구), time(시작 시간), weekday(요일), content(콘텐츠), offlineDisplay(휴방 표시)
const LEGACY_INK = (title, footer, time, content) => ({ title, footer, time, weekday: time, content, offlineDisplay: time });


// 고급 템플릿 특수효과(화면 표시 전용, PNG 저장·임베드에는 들어가지 않음).
// ambient: 자동 효과 이름(.weekly-fx-<ambient>), pointer: PC 마우스 효과, hover: 칸 hover 효과.
// spots: 장식 위치에 얹는 효과 조각 [종류, x, y, w, h, 지연(초)] — 원본 1672×941 기준.
const EFFECTS = {
  starlight: { ambient: 'starlight', pointer: 'stardust', hover: null, spots: [] },
  'constellation-diary': {
    ambient: 'constellation', pointer: 'stardust', hover: null,
    spots: [
      ['twinkle', 605, 48, 24, 24, 0], ['twinkle', 1035, 17, 24, 24, 1.1], ['twinkle', 1412, 44, 24, 24, 2.3],
      ['twinkle', 1508, 8, 24, 24, 0.6], ['twinkle', 1617, 148, 24, 24, 1.8], ['twinkle', 351, 91, 24, 24, 2.9],
      ['twinkle', 1441, 841, 24, 24, 1.4], ['twinkle', 21, 575, 24, 24, 3.4],
      ['meteor', 1250, 30, 120, 3, 0],
    ],
  },
  'kpop-backstage': {
    ambient: 'stage', pointer: null, hover: 'glow',
    spots: [
      ['beam', 263, 30, 100, 330, 0], ['beam', 423, 10, 100, 330, 1.6], ['beam', 1157, 10, 100, 330, 0.8], ['beam', 1317, 30, 100, 330, 2.4],
      ['bulb', 1621, 275, 24, 24, 0], ['bulb', 1621, 337, 24, 24, 0.4], ['bulb', 1617, 395, 24, 24, 0.8], ['bulb', 1617, 448, 24, 24, 1.2],
    ],
  },
  'retro-arcade': {
    ambient: 'arcade', pointer: 'pixel', hover: 'neon',
    spots: [
      ['scan', 93, 193, 413, 527, 0], ['neon', 6, 6, 1660, 929, 0],
      ['coin', 1400, 815, 56, 50, 0], ['star', 120, 35, 50, 50, 0.7], ['star', 1520, 35, 50, 50, 1.9],
    ],
  },
  'seaside-postcard': {
    ambient: 'seaside', pointer: 'ripple', hover: null,
    spots: [
      ['wave', 300, 820, 1040, 70, 0], ['glint', 1480, 95, 30, 30, 0.3], ['glint', 1590, 125, 30, 30, 1.7],
      ['glint', 10, 470, 30, 30, 2.4], ['glint', 1390, 125, 30, 30, 3.1],
    ],
  },
  'forest-camping': {
    ambient: 'forest', pointer: 'firefly', hover: null,
    spots: [
      ['lantern', 60, 85, 80, 90, 0], ['lantern', 1577, 190, 80, 90, 1.3],
      ['firefly', 40, 450, 14, 14, 0], ['firefly', 30, 700, 14, 14, 1.5], ['firefly', 560, 885, 14, 14, 3],
      ['firefly', 1120, 900, 14, 14, 0.8], ['firefly', 1625, 470, 14, 14, 2.2], ['firefly', 450, 150, 14, 14, 3.6],
    ],
  },
  'cafe-menu': {
    ambient: 'cafe', pointer: null, hover: 'lift',
    spots: [
      ['steam', 625, 40, 34, 90, 0], ['steam', 655, 40, 34, 90, 1.4], ['steam', 1495, 790, 34, 90, 0.7],
      ['shine', 1520, 105, 30, 30, 1.2],
    ],
  },
  'quest-board': {
    ambient: 'quest', pointer: null, hover: 'lift',
    spots: [
      ['pin', 657, 192, 24, 24, 0], ['pin', 917, 192, 24, 24, 1.3], ['pin', 1177, 192, 24, 24, 2.6], ['pin', 1440, 192, 24, 24, 3.9],
      ['pin', 697, 572, 24, 24, 0.7], ['pin', 1045, 572, 24, 24, 2], ['pin', 1400, 572, 24, 24, 3.3],
      ['ember', 330, 880, 8, 8, 0], ['ember', 860, 900, 8, 8, 1.6], ['ember', 1300, 890, 8, 8, 3.2],
    ],
  },
};

export const WEEKLY_TEMPLATES = frozen({
  default: {
    id: 'default', label: '기본 템플릿', premium: false, motion: false, effects: null,
    image: './assets/weekly-schedule-template.png?v=20261031-weekly-board-v2',
    embedImage: 'assets/weekly-schedule-template.png',
    ink: { title: '#a74464', footer: '#9b365c', time: '#a63d61', weekday: '#a63d61', content: '#a94d6b', offlineDisplay: '#a63d61' },
    layout: baseLayout,
  },
  starlight: {
    id: 'starlight', label: '별빛 방송국', premium: true, motion: true, effects: EFFECTS['starlight'],
    image: './assets/weekly-schedule-starlight.png',
    embedImage: 'assets/weekly-schedule-starlight.png',
    ink: LEGACY_INK('#493365', '#493365', '#493365', '#594578'),
    layout: baseLayout,
  },
  'minimal-mono': {
    id: 'minimal-mono', label: '미니멀 모노', premium: true, motion: false, effects: null,
    image: './assets/weekly-schedule-templates/weekly-schedule-minimal-mono-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-minimal-mono-v1.webp',
    ink: { title: '#2b2b2b', footer: '#2b2b2b', time: '#bf4b3a', weekday: '#bf4b3a', content: '#383838', offlineDisplay: '#bf4b3a' },
    layout: {
      title: { centerX: 1244, centerY: 118, maxWidth: 520, previousX: 944, nextX: 1546 },
      avatar: { x: 78, y: 186, w: 424, h: 560, radius: 36 },
      footer: { centerX: 292, centerY: 854, maxWidth: 360, field: { x: 92, y: 830, w: 400, h: 50 } },
      days: paperDays([[548, 220, 256, 304], [828, 216, 252, 308], [1104, 220, 252, 304], [1380, 220, 248, 304], [572, 572, 328, 304], [928, 572, 328, 304], [1284, 572, 336, 304]]),
    },
  },
  'seaside-postcard': {
    id: 'seaside-postcard', label: '바닷가 엽서', premium: true, motion: true, effects: EFFECTS['seaside-postcard'],
    image: './assets/weekly-schedule-templates/weekly-schedule-seaside-postcard-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-seaside-postcard-v1.webp',
    ink: { title: '#2b6786', footer: '#7a4f33', time: '#c0473f', weekday: '#2b6786', content: '#5a4636', offlineDisplay: '#c0473f' },
    layout: {
      title: { centerX: 1088, centerY: 98, maxWidth: 470, previousX: 832, nextX: 1346 },
      avatar: { x: 86, y: 178, w: 384, h: 494 },
      footer: { centerX: 336, centerY: 846, maxWidth: 290, field: { x: 202, y: 820, w: 288, h: 54 } },
      days: paperDays([[520, 188, 260, 356], [800, 188, 260, 356], [1080, 188, 260, 356], [1360, 188, 264, 356], [520, 568, 348, 224], [892, 568, 344, 224], [1260, 568, 364, 224]]),
    },
  },
  'cafe-menu': {
    id: 'cafe-menu', label: '카페 메뉴판', premium: true, motion: true, effects: EFFECTS['cafe-menu'],
    image: './assets/weekly-schedule-templates/weekly-schedule-cafe-menu-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-cafe-menu-v1.webp',
    ink: { title: '#6b3f27', footer: '#7d5320', time: '#b0394f', weekday: '#566f2b', content: '#5b4331', offlineDisplay: '#b0394f' },
    layout: {
      title: { centerX: 1118, centerY: 108, maxWidth: 500, previousX: 852, nextX: 1388 },
      avatar: { x: 102, y: 206, w: 392, h: 460 },
      footer: { centerX: 302, centerY: 838, maxWidth: 330, field: { x: 124, y: 812, w: 356, h: 52 } },
      // 카드 위쪽 리본 장식(약 45px)을 피해 그 아래부터 글자 영역을 잡는다.
      days: paperDays([[568, 266, 236, 300], [848, 266, 236, 300], [1124, 266, 236, 300], [1400, 266, 236, 300], [572, 648, 328, 190], [940, 648, 324, 190], [1304, 648, 332, 190]]),
    },
  },
  'constellation-diary': {
    id: 'constellation-diary', label: '별자리 일기', premium: true, motion: true, effects: EFFECTS['constellation-diary'],
    image: './assets/weekly-schedule-templates/weekly-schedule-constellation-diary-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-constellation-diary-v1.webp',
    ink: { title: '#46366f', footer: '#46366f', time: '#8f5f12', weekday: '#46366f', content: '#4a4166', offlineDisplay: '#8f5f12' },
    layout: {
      // 제목 리본이 좁다(약 464px). 화살표는 리본 양 끝 꼬리 위에 둔다.
      title: { centerX: 1044, centerY: 94, maxWidth: 420, previousX: 736, nextX: 1352 },
      avatar: { x: 98, y: 170, w: 392, h: 564 },
      footer: { centerX: 302, centerY: 814, maxWidth: 320, field: { x: 132, y: 790, w: 340, h: 48 } },
      days: paperDays([[536, 172, 236, 316], [804, 172, 236, 316], [1072, 172, 240, 316], [1340, 172, 248, 316], [532, 520, 332, 248], [896, 520, 336, 248], [1264, 520, 336, 248]]),
    },
  },
  'forest-camping': {
    id: 'forest-camping', label: '숲속 캠핑', premium: true, motion: true, effects: EFFECTS['forest-camping'],
    image: './assets/weekly-schedule-templates/weekly-schedule-forest-camping-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-forest-camping-v1.webp',
    ink: { title: '#3d2610', footer: '#5a3a1e', time: '#2f5d2a', weekday: '#8a3b25', content: '#3f4a2c', offlineDisplay: '#8a3b25' },
    layout: {
      title: { centerX: 1034, centerY: 126, maxWidth: 560, previousX: 704, nextX: 1366 },
      // 텐트(집) 모양 칸: 위쪽 모서리가 천 밖으로 나가지 않도록 다각형으로 자른다.
      avatar: { x: 132, y: 150, w: 398, h: 586, clip: [[0, 0.27], [0.5, 0], [1, 0.27], [1, 1], [0, 1]] },
      footer: { centerX: 372, centerY: 836, maxWidth: 330, field: { x: 200, y: 810, w: 344, h: 52 } },
      days: paperDays([[600, 254, 208, 290], [852, 254, 204, 290], [1100, 254, 204, 290], [1348, 254, 208, 290], [600, 626, 296, 202], [940, 626, 292, 202], [1276, 626, 296, 202]]),
    },
  },
  'kpop-backstage': {
    id: 'kpop-backstage', label: 'K-pop 백스테이지', premium: true, motion: true, effects: EFFECTS['kpop-backstage'],
    image: './assets/weekly-schedule-templates/weekly-schedule-kpop-backstage-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-kpop-backstage-v1.webp',
    ink: { title: '#c2307a', footer: '#6f3aa8', time: '#c2307a', weekday: '#6f3aa8', content: '#463259', offlineDisplay: '#c2307a' },
    layout: {
      title: { centerX: 996, centerY: 124, maxWidth: 740, previousX: 596, nextX: 1398 },
      avatar: { x: 72, y: 156, w: 364, h: 564, radius: 44 },
      footer: { centerX: 262, centerY: 792, maxWidth: 330, field: { x: 92, y: 766, w: 340, h: 52 } },
      days: paperDays([[480, 224, 244, 260], [752, 224, 244, 260], [1024, 224, 244, 260], [1296, 224, 244, 260], [480, 524, 332, 260], [840, 524, 328, 260], [1200, 524, 324, 264]]),
    },
  },
  'quest-board': {
    id: 'quest-board', label: '퀘스트 게시판', premium: true, motion: true, effects: EFFECTS['quest-board'],
    image: './assets/weekly-schedule-templates/weekly-schedule-quest-board-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-quest-board-v1.webp',
    // 제목판은 어두운 나무라 밝은 글자를 쓴다.
    ink: { title: '#fff3d0', footer: '#6b3d1c', time: '#8c2f1f', weekday: '#4f6224', content: '#4b3320', offlineDisplay: '#8c2f1f', titleShadow: '#3a1f0acc' },
    layout: {
      title: { centerX: 1072, centerY: 114, maxWidth: 400, previousX: 812, nextX: 1334 },
      avatar: { x: 102, y: 178, w: 398, h: 550 },
      footer: { centerX: 304, centerY: 816, maxWidth: 280, field: { x: 150, y: 788, w: 308, h: 56 } },
      days: paperDays([[552, 234, 240, 314], [812, 234, 240, 314], [1076, 234, 236, 314], [1336, 234, 240, 314], [548, 614, 328, 202], [900, 610, 320, 206], [1244, 610, 332, 206]]),
    },
  },
  'retro-arcade': {
    id: 'retro-arcade', label: '레트로 아케이드', premium: true, motion: true, effects: EFFECTS['retro-arcade'],
    image: './assets/weekly-schedule-templates/weekly-schedule-retro-arcade-v1.webp',
    embedImage: 'assets/weekly-schedule-templates/weekly-schedule-retro-arcade-v1.webp',
    ink: { title: '#7a1fa2', footer: '#c01f7a', time: '#c01f7a', weekday: '#6a20a8', content: '#3d2a5a', offlineDisplay: '#c01f7a' },
    layout: {
      title: { centerX: 1086, centerY: 94, maxWidth: 540, previousX: 780, nextX: 1392 },
      avatar: { x: 94, y: 198, w: 400, h: 516, radius: 46 },
      footer: { centerX: 302, centerY: 822, maxWidth: 360, field: { x: 104, y: 798, w: 396, h: 48 } },
      // 아래 3칸은 낮아서(약 152px) 글자 크기와 영역을 따로 잡는다.
      days: (() => {
        const row2 = { time: { left: 0.08, top: 0.03, width: 0.84, height: 0.24 }, content: { left: 0.08, top: 0.29, width: 0.84, height: 0.46 }, linked: { left: 0.08, top: 0.74, width: 0.84, height: 0.12 }, offline: { top: -0.17 }, weekdayY: 0.89 };
        const short = { time: 26, content: 22, line: 25, weekday: 22, offline: 30, offlineLine: 34, linked: 13 };
        return [
          ...[[564, 228, 224, 308], [832, 228, 224, 308], [1100, 228, 224, 308], [1368, 228, 220, 308]].map(([x, y, w, h]) => ({ x, y, w, h, ...PAPER_REGIONS.row1, font: scaledFonts(w, h) })),
          ...[[568, 608, 316, 152], [928, 608, 312, 152], [1284, 608, 316, 152]].map(([x, y, w, h]) => ({ x, y, w, h, ...row2, font: short })),
        ];
      })(),
    },
  },
});

export const WEEKLY_TEMPLATE_IDS = Object.freeze(Object.keys(WEEKLY_TEMPLATES));
export const WEEKLY_PREMIUM_TEMPLATE_IDS = Object.freeze(WEEKLY_TEMPLATE_IDS.filter((id) => WEEKLY_TEMPLATES[id].premium));

export function weeklyTemplate(id) {
  return WEEKLY_TEMPLATES[id] || WEEKLY_TEMPLATES.default;
}
export function isWeeklyTemplateId(id) {
  return Object.prototype.hasOwnProperty.call(WEEKLY_TEMPLATES, id);
}
export function isPremiumWeeklyTemplate(id) {
  return isWeeklyTemplateId(id) && WEEKLY_TEMPLATES[id].premium === true;
}
