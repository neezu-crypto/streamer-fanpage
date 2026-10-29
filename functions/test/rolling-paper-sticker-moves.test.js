'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { drainRollingPaperStickerMoveQueue } = require('../../rolling-paper-sticker-moves.mjs');

test('sticker move queue keeps the newest coordinates while a previous save is pending', async () => {
  const queue = new Map([['sticker-a', { x: 20, y: 30 }]]);
  const calls = [];
  let releaseFirst;
  const firstSave = new Promise((resolve) => { releaseFirst = resolve; });

  const drain = drainRollingPaperStickerMoveQueue(queue, async (stickerId, position) => {
    calls.push({ stickerId, ...position });
    if (calls.length === 1) await firstSave;
    return { stickerId, ...position };
  });

  await new Promise((resolve) => setImmediate(resolve));
  queue.set('sticker-a', { x: 74, y: 81 });
  queue.set('sticker-b', { x: 42, y: 55 });
  queue.set('sticker-b', { x: 46, y: 59 });
  releaseFirst();

  const result = await drain;
  assert.deepEqual(calls, [
    { stickerId: 'sticker-a', x: 20, y: 30 },
    { stickerId: 'sticker-a', x: 74, y: 81 },
    { stickerId: 'sticker-b', x: 46, y: 59 },
  ]);
  assert.deepEqual(result, { stickerId: 'sticker-b', x: 46, y: 59 });
  assert.equal(queue.size, 0);
});
