'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ROLLING_PAPER_STICKER_MAX_ITEMS,
  addRollingPaperSticker,
  deleteRollingPaperSticker,
  moveRollingPaperSticker,
  normalizeRollingPaperStickers,
  safeStickerCoordinate,
} = require('../rolling-paper-stickers');

function createDatabase(initial = {}) {
  const root = structuredClone(initial);

  function readAt(path) {
    return path.reduce((node, key) => node && typeof node === 'object' ? node[key] : undefined, root);
  }

  function writeAt(path, value) {
    if (!path.length) throw new Error('The test root cannot be replaced.');
    let parent = root;
    for (const key of path.slice(0, -1)) {
      if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
      parent = parent[key];
    }
    if (value === null) delete parent[path[path.length - 1]];
    else parent[path[path.length - 1]] = structuredClone(value);
  }

  class Ref {
    constructor(path = []) { this.path = path; }
    child(key) { return new Ref([...this.path, String(key)]); }
    async get() {
      const value = readAt(this.path);
      return { val: () => value === undefined ? null : structuredClone(value), exists: () => value !== undefined && value !== null };
    }
    async set(value) { writeAt(this.path, value); }
    async transaction(update) {
      const current = readAt(this.path);
      const next = update(current === undefined ? null : structuredClone(current));
      if (next === undefined) {
        return { committed: false, snapshot: { val: () => current === undefined ? null : structuredClone(current) } };
      }
      writeAt(this.path, next);
      return { committed: true, snapshot: { val: () => next === null ? null : structuredClone(next) } };
    }
  }

  return { ref: new Ref(), data: root };
}

test('signed-in account can place one sticker, then move and remove it', async () => {
  const database = createDatabase();
  const ownerKey = 'uid-hash-a';
  const createdAt = 1_800_000_000_000;
  const id = await addRollingPaperSticker(database.ref, ownerKey, '💖', 32.5, 71.25, createdAt);
  const publicStickers = normalizeRollingPaperStickers(database.data.stickers);

  assert.equal(publicStickers.length, 1);
  assert.deepEqual(publicStickers[0], { id, emoji: '💖', x: 32.5, y: 71.25, createdAt, updatedAt: createdAt });
  assert.equal(Object.hasOwn(publicStickers[0], 'ownerKey'), false);
  assert.equal(database.data.owners[ownerKey], id);

  const moved = await moveRollingPaperSticker(database.ref, id, 49, 53, createdAt + 10);
  assert.equal(moved.x, 49);
  assert.equal(moved.y, 53);
  assert.equal(moved.updatedAt, createdAt + 10);

  await assert.rejects(addRollingPaperSticker(database.ref, ownerKey, '✨', 50, 50), { code: 'already-exists' });
  await assert.rejects(deleteRollingPaperSticker(database.ref, id, 'uid-hash-b', false), { code: 'permission-denied' });
  assert.equal(await deleteRollingPaperSticker(database.ref, id, ownerKey, false), true);
  assert.equal(database.data.count, 0);
  assert.equal(database.data.owners[ownerKey], undefined);
  assert.deepEqual(normalizeRollingPaperStickers(database.data.stickers), []);

  const replacementId = await addRollingPaperSticker(database.ref, ownerKey, '🌸', 12, 88, createdAt + 20);
  assert.ok(replacementId);
});

test('move retries against the server value when the local transaction cache starts empty', async () => {
  const database = createDatabase();
  const id = await addRollingPaperSticker(database.ref, 'fan-hash', '✨', 20, 30, 1_800_000_000_000);
  const baseRootChild = database.ref.child.bind(database.ref);
  const stickersRef = baseRootChild('stickers');
  const baseStickersChild = stickersRef.child.bind(stickersRef);
  const stickerRef = baseStickersChild(id);
  let updateCalls = 0;
  stickerRef.transaction = async (update) => {
    const runUpdate = (value) => { updateCalls += 1; return update(value); };
    assert.equal(runUpdate(null), null);
    const serverValueUpdate = runUpdate((await stickerRef.get()).val());
    await stickerRef.set(serverValueUpdate);
    return { committed: true, snapshot: { val: () => serverValueUpdate } };
  };
  stickersRef.child = (childId) => childId === id ? stickerRef : baseStickersChild(childId);
  database.ref.child = (key) => key === 'stickers' ? stickersRef : baseRootChild(key);

  const moved = await moveRollingPaperSticker(database.ref, id, 74, 81, 1_800_000_000_100);

  assert.equal(updateCalls, 2);
  assert.equal(moved.x, 74);
  assert.equal(moved.y, 81);
  assert.equal((await stickerRef.get()).val().updatedAt, 1_800_000_000_100);
});

test('move reports not found when both the local cache and server have no sticker', async () => {
  const database = createDatabase();
  const missingId = '123e4567-e89b-42d3-a456-426614174000';

  await assert.rejects(
    moveRollingPaperSticker(database.ref, missingId, 74, 81),
    { code: 'not-found' },
  );
  assert.deepEqual(normalizeRollingPaperStickers(database.data.stickers), []);
});

test('streamer or admin manager can remove another account\'s sticker', async () => {
  const database = createDatabase();
  const id = await addRollingPaperSticker(database.ref, 'fan-hash', '🐰', 50, 50, 1_800_000_000_000);

  assert.equal(await deleteRollingPaperSticker(database.ref, id, 'manager-hash', true), true);
  assert.equal(database.data.count, 0);
  assert.equal(database.data.owners['fan-hash'], undefined);
});

test('the per-page cap rejects excess stickers without leaving an owner reservation', async () => {
  const database = createDatabase({ count: ROLLING_PAPER_STICKER_MAX_ITEMS });

  await assert.rejects(addRollingPaperSticker(database.ref, 'fan-hash', '🎉', 50, 50), { code: 'resource-exhausted' });
  assert.equal(database.data.count, ROLLING_PAPER_STICKER_MAX_ITEMS);
  assert.equal(database.data.owners['fan-hash'], undefined);
});

test('simultaneous placement attempts from one account still create only one sticker', async () => {
  const database = createDatabase();
  const attempts = await Promise.allSettled([
    addRollingPaperSticker(database.ref, 'same-fan-hash', '✨', 20, 30, 1_800_000_000_000),
    addRollingPaperSticker(database.ref, 'same-fan-hash', '🎉', 70, 80, 1_800_000_000_001),
  ]);

  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((result) => result.status === 'rejected' && result.reason.code === 'already-exists').length, 1);
  assert.equal(normalizeRollingPaperStickers(database.data.stickers).length, 1);
  assert.equal(database.data.count, 1);
});

test('invalid stickers and coordinates are rejected while valid coordinates stay within the board', async () => {
  const database = createDatabase();

  assert.equal(safeStickerCoordinate(null), null);
  assert.equal(safeStickerCoordinate(1), 4);
  assert.equal(safeStickerCoordinate(99), 96);
  await assert.rejects(addRollingPaperSticker(database.ref, 'fan-hash', 'not-a-sticker', 50, 50), { code: 'invalid-argument' });
  await assert.rejects(addRollingPaperSticker(database.ref, 'fan-hash', '✨', null, 50), { code: 'invalid-argument' });
  assert.equal(database.data.count, undefined);
});
