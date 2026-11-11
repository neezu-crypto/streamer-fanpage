'use strict';

// 기본 템플릿만 무료이고, 그 밖의 모든 템플릿은 "고급 템플릿"으로 유료 디자인 이용권이 필요하다.
// 특정 디자인(레이아웃)에 묶이지 않으므로 디자인 1·2에서도 이용권이 있으면 쓸 수 있다.
const FREE_TEMPLATES = ['default'];
const PREMIUM_TEMPLATES = [
  'starlight', 'cafe-menu', 'constellation-diary', 'forest-camping', 'kpop-backstage',
  'minimal-mono', 'quest-board', 'retro-arcade', 'seaside-postcard'
];

function resolveTemplate(requested, existing) {
  const template = requested == null ? (existing || 'default') : String(requested);
  return [...FREE_TEMPLATES, ...PREMIUM_TEMPLATES].includes(template) ? template : null;
}

function isPremiumTemplate(template) {
  return PREMIUM_TEMPLATES.includes(template);
}

// hasPaidDesign: 해당 팬페이지가 유료 디자인 이용권을 가졌는지(서버가 확인한 값).
function mayUseTemplate(template, { isAdmin = false, isVerifiedStreamer = false, hasPaidDesign = false } = {}) {
  if (FREE_TEMPLATES.includes(template)) return true;
  if (!isPremiumTemplate(template)) return false;
  return isAdmin === true || (isVerifiedStreamer === true && hasPaidDesign === true);
}

module.exports = { resolveTemplate, mayUseTemplate, isPremiumTemplate, PREMIUM_TEMPLATES };
