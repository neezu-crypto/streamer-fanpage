"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLayoutDesign, attachLayoutDesigns } = require("./design-usage");

test("저장된 디자인은 그대로, 없거나 잘못된 값은 기본 1(saved=false)", () => {
  assert.deepEqual(normalizeLayoutDesign(3), { layoutDesign: 3, layoutDesignSaved: true });
  assert.deepEqual(normalizeLayoutDesign("2"), { layoutDesign: 2, layoutDesignSaved: true });
  assert.deepEqual(normalizeLayoutDesign(undefined), { layoutDesign: 1, layoutDesignSaved: false });
  assert.deepEqual(normalizeLayoutDesign(9), { layoutDesign: 1, layoutDesignSaved: false });
});

test("읽기 실패는 null 디자인, 나머지 필드는 보존", async () => {
  const result = await attachLayoutDesigns(
    [{ id: "a", nickname: "A" }, { id: "b", nickname: "B" }, { id: "c" }],
    async (id) => { if (id === "b") throw new Error("x"); return id === "a" ? 3 : null; },
  );
  assert.equal(result[0].layoutDesign, 3);
  assert.equal(result[0].nickname, "A");
  assert.equal(result[1].layoutDesign, null);
  assert.equal(result[2].layoutDesign, 1);
  assert.equal(result[2].layoutDesignSaved, false);
});

test("목록이 아니면 빈 배열", async () => {
  assert.deepEqual(await attachLayoutDesigns(null, async () => 1), []);
});
