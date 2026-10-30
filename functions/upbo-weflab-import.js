'use strict';

function normalizeUpboItemNameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ko-KR');
}

function planWeFlabUpboImport(rouletteItems, storedItems, maxItems = 100) {
  const sourceItems = Array.isArray(rouletteItems) ? rouletteItems : [];
  const stored = storedItems && typeof storedItems === 'object' && !Array.isArray(storedItems) ? storedItems : {};
  const seenSource = new Set();
  const existingNames = new Set(Object.values(stored)
    .map((item) => item && typeof item.name === 'string' ? normalizeUpboItemNameKey(item.name) : '')
    .filter(Boolean));
  const uniqueNames = [];
  let invalidNameCount = 0;
  let sourceDuplicateCount = 0;

  sourceItems.forEach((item) => {
    const name = item && typeof item.value === 'string' ? item.value.trim() : '';
    const key = normalizeUpboItemNameKey(name);
    if (!name || name.length > 60 || key === normalizeUpboItemNameKey('이름 없음')) {
      invalidNameCount += 1;
      return;
    }
    if (seenSource.has(key)) {
      sourceDuplicateCount += 1;
      return;
    }
    seenSource.add(key);
    uniqueNames.push({ name, key });
  });

  let existingDuplicateCount = 0;
  const newNames = [];
  uniqueNames.forEach(({ name, key }) => {
    if (existingNames.has(key)) {
      existingDuplicateCount += 1;
      return;
    }
    newNames.push(name);
  });

  const slots = Math.max(0, Math.floor(Number(maxItems) || 0) - Object.keys(stored).length);
  const addedNames = newNames.slice(0, slots);
  return {
    addedNames,
    sourceCount: sourceItems.length,
    sourceDuplicateCount,
    existingDuplicateCount,
    duplicateCount: sourceDuplicateCount + existingDuplicateCount,
    invalidNameCount,
    limitSkippedCount: newNames.length - addedNames.length,
  };
}

module.exports = { normalizeUpboItemNameKey, planWeFlabUpboImport };
