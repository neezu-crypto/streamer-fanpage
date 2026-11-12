'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { lookupPost, parsePostUrl } = require('../comment-up-check');

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('SOOP 게시글 주소에서 방송국과 게시글 번호를 안전하게 추출한다', () => {
  assert.deepEqual(parsePostUrl('https://www.sooplive.com/station/banta251201/post/211890793'), {
    stationId: 'banta251201', postId: '211890793',
  });
  assert.equal(parsePostUrl('https://example.com/station/a/post/1'), null);
});

test('일반 공개 게시글은 제목과 공개 구분을 반환한다', async () => {
  const result = await lookupPost({ stationId: 'streamer', postId: '1' }, async () => response(200, { titleName: '  방송 공지  ' }));
  assert.deepEqual(result, { available: true, visibility: 'public', title: '방송 공지' });
});

test('CHA0020 애청자 공개 게시글은 등록과 댓글 확인을 허용한다', async () => {
  const result = await lookupPost({ stationId: 'fan', postId: '2' }, async () => response(403, {
    code: 'CHA0020', message: '이 게시판은 애청자 공개입니다.', warning: true,
  }));
  assert.deepEqual(result, { available: true, visibility: 'fan', title: '' });
});

test('다른 실패 응답은 비공개 또는 삭제된 게시글로 유지한다', async () => {
  const result = await lookupPost({ stationId: 'fan', postId: '3' }, async () => response(403, { code: 'CHA0010' }));
  assert.deepEqual(result, { available: false, visibility: '', title: '' });
});

test('목표 입력: 등수 1~500, UP 1~100000, 빈 값은 생략', () => {
  const { parseGoals } = require('../comment-up-check');
  assert.deepEqual(parseGoals({}), {});
  assert.deepEqual(parseGoals({ goalRank: '', goalUp: null }), {});
  assert.deepEqual(parseGoals({ goalRank: 500, goalUp: '100000' }), { goalRank: 500, goalUp: 100000 });
  assert.equal(parseGoals({ goalRank: 501 }), null);
  assert.equal(parseGoals({ goalRank: 0 }), null);
  assert.equal(parseGoals({ goalUp: 1.5 }), null);
  assert.equal(parseGoals({ goalUp: 100001 }), null);
});
