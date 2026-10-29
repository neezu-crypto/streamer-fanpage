export async function drainRollingPaperStickerMoveQueue(queue, sendMove) {
  let latestResult = null;
  while (queue.size) {
    const [stickerId, position] = queue.entries().next().value;
    queue.delete(stickerId);
    latestResult = await sendMove(stickerId, position);
  }
  return latestResult;
}
