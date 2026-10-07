'use strict';

const MAX_ROULETTE_GROUPS = 50;
const MAX_ROULETTE_ITEMS = 500;
const MAX_ITEM_LABEL_LENGTH = 180;

function readAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    const normalized = name.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos' || normalized === '#39') return "'";
    if (normalized === 'nbsp') return ' ';
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    } catch (_) {
      return entity;
    }
  });
}

function htmlText(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractDivBlocks(html, predicate) {
  const blocks = [];
  const stack = [];
  const tokens = /<div\b[^>]*>|<\/div\s*>/gi;
  let match;
  while ((match = tokens.exec(html))) {
    if (/^<\/div/i.test(match[0])) {
      const node = stack.pop();
      if (node && node.matches) blocks.push(html.slice(node.start, tokens.lastIndex));
      continue;
    }
    const attributes = {
      id: readAttribute(match[0], 'id'),
      className: readAttribute(match[0], 'class').split(/\s+/).filter(Boolean),
      dataIndex: readAttribute(match[0], 'data-idx'),
      dataType: readAttribute(match[0], 'type'),
    };
    stack.push({ start: match.index, matches: predicate(attributes) });
  }
  return blocks.reverse();
}

function valueForClass(html, tagName, className) {
  const expression = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let match;
  while ((match = expression.exec(html))) {
    const classes = readAttribute(match[0], 'class').split(/\s+/);
    if (!classes.includes(className)) continue;
    const close = new RegExp(`<\\/${tagName}\\s*>`, 'ig');
    close.lastIndex = expression.lastIndex;
    const end = close.exec(html);
    if (end) return htmlText(html.slice(expression.lastIndex, end.index));
  }
  return '';
}

function parseRouletteCountBlocks(groupHtml) {
  const counts = [];
  const blocks = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  let match;
  while ((match = blocks.exec(groupHtml))) {
    const opening = /^<p\b[^>]*>/i.exec(match[0]);
    const classes = opening ? readAttribute(opening[0], 'class').split(/\s+/) : [];
    if (!classes.includes('count')) continue;
    const minText = valueForClass(match[0], 'span', 'min');
    const maxText = valueForClass(match[0], 'span', 'max');
    const min = Number.parseInt(minText.replace(/[^\d]/g, ''), 10);
    const max = Number.parseInt(maxText.replace(/[^\d]/g, ''), 10);
    if (!Number.isSafeInteger(min) || min < 0) continue;
    const platformClass = classes.find((name) => /^platform_[a-z0-9]+$/i.test(name) && name !== 'platform_area');
    counts.push({
      platform: platformClass ? platformClass.slice('platform_'.length) : '',
      min,
      max: Number.isSafeInteger(max) && max >= min ? max : min,
    });
  }
  return counts;
}

function parseRouletteItems(groupHtml, remainingLimit) {
  const blocks = extractDivBlocks(groupHtml, ({ className }) => className.includes('roulette_box'));
  const items = [];
  for (const block of blocks) {
    if (items.length >= remainingLimit) break;
    const inputTags = [...block.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
    const inputValue = (className) => {
      const tag = inputTags.find((input) => readAttribute(input, 'class').split(/\s+/).includes(className));
      return tag ? htmlText(readAttribute(tag, 'value')).slice(0, MAX_ITEM_LABEL_LENGTH) : '';
    };
    const type = inputValue('select_roulette_type');
    const value = inputValue('input_roulette_name');
    const probabilityText = inputValue('input_roulette_percent');
    if (!type && !value && !probabilityText) continue;
    const parsedProbability = probabilityText ? Number(probabilityText) : NaN;
    items.push({
      type: type || '룰렛',
      value: value || '이름 없음',
      probability: Number.isFinite(parsedProbability) && parsedProbability >= 0 && parsedProbability <= 100
        ? parsedProbability
        : null,
    });
  }
  return items;
}

function parseWeFlabRouletteUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !['weflab.com', 'www.weflab.com'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.port) return null;
    const match = /^\/user\/([A-Za-z0-9_-]{4,128})\/?$/.exec(parsed.pathname);
    if (!match) return null;
    return `https://weflab.com/user/${match[1]}`;
  } catch (_) {
    return null;
  }
}

function parseWeFlabRouletteHtml(html) {
  if (typeof html !== 'string' || !html) return null;
  const main = extractDivBlocks(html, ({ id }) => id === 'user_main')[0];
  if (!main) return null;
  const groupBlocks = extractDivBlocks(main, ({ className }) => className.includes('setup_alert_list'))
    .slice(0, MAX_ROULETTE_GROUPS);
  if (!groupBlocks.length) return null;

  let remainingLimit = MAX_ROULETTE_ITEMS;
  const groups = [];
  for (const groupHtml of groupBlocks) {
    const alertBlocks = extractDivBlocks(groupHtml, ({ className }) => className.includes('alert_box'));
    const sourceBlocks = alertBlocks.length ? alertBlocks : [groupHtml];
    for (const sourceBlock of sourceBlocks) {
      if (groups.length >= MAX_ROULETTE_GROUPS || remainingLimit <= 0) break;
      const items = parseRouletteItems(sourceBlock, remainingLimit);
      remainingLimit -= items.length;
      if (!items.length) continue;
      groups.push({
        index: groups.length,
        counts: parseRouletteCountBlocks(sourceBlock),
        items,
      });
    }
    if (groups.length >= MAX_ROULETTE_GROUPS || remainingLimit <= 0) break;
  }
  if (!groups.length) return null;

  const nameMatch = /<span\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(main);
  const updateMatch = /룰렛의\s*마지막\s*수정시간은[\s\S]*?<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(main);
  return {
    streamerName: nameMatch ? htmlText(nameMatch[1]).slice(0, 60) : '',
    sourceUpdatedAt: updateMatch ? htmlText(updateMatch[1]).slice(0, 80) : '',
    groups,
    itemCount: groups.reduce((total, group) => total + group.items.length, 0),
  };
}

module.exports = { parseWeFlabRouletteHtml, parseWeFlabRouletteUrl };
