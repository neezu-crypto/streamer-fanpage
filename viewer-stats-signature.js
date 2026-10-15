/* 스트리머 고점체크 시그니처 오프닝 — 브라우저당 24시간 1회. */
(function () {
  var LAST_SHOWN_KEY = 'ojmSigSplashLastShown_streamerViewerStats_v1';
  var SHOW_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var DURATION_MS = 3400;

  function play() {
    var stage = document.getElementById('sig-opening-stage');
    if (!stage) return;
    var series = stage.querySelector('.sig-series');
    var seriesTag = stage.querySelector('.sig-series-tag');
    var reelTrack = stage.querySelector('.sig-reel-track');
    var underline = stage.querySelector('.sig-series-under');
    var titleFrame = stage.querySelector('.sig-title-frame');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var now = function () {
      return window.performance && typeof window.performance.now === 'function'
        ? window.performance.now() : Date.now();
    };
    var requestFrame = window.requestAnimationFrame || function (callback) {
      return window.setTimeout(function () { callback(now()); }, 16);
    };
    var cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
    var startedAt = now();
    var rafId = null;
    var finished = false;

    function clamp01(value) { return Math.max(0, Math.min(1, value)); }
    function easeOutCubic(value) {
      value = clamp01(value);
      return 1 - Math.pow(1 - value, 3);
    }
    function progress(elapsed, start, duration) {
      if (elapsed < start) return 0;
      return reduceMotion ? 1 : clamp01((elapsed - start) / duration);
    }
    function applyTimeline(timestamp) {
      var elapsed = Math.max(0, timestamp - startedAt);
      var seriesIn = progress(elapsed, 0, 700);
      var seriesOut = progress(elapsed, 2300, 500);
      series.style.opacity = String(elapsed < 2300 ? seriesIn : 1 - seriesOut);
      series.style.transform = 'translateY(' + (elapsed < 2300
        ? 18 * (1 - easeOutCubic(seriesIn)) : -14 * seriesOut) + 'px)';

      var tagProgress = progress(elapsed, 0, 450);
      seriesTag.style.opacity = String(tagProgress);
      seriesTag.style.transform = 'translateY(' + (18 * (1 - easeOutCubic(tagProgress))) + 'px)';

      var reelProgress = progress(elapsed, 500, 1000);
      var reelStep = Math.min(5, Math.floor(reelProgress * 5 + 0.000001));
      reelTrack.style.transform = 'translateY(' + (-44 * reelStep) + 'px)';

      var underlineProgress = progress(elapsed, 1500, 500);
      underline.style.width = (180 * (underlineProgress * underlineProgress * (3 - 2 * underlineProgress))) + 'px';

      var titleProgress = progress(elapsed, 2600, 600);
      titleFrame.style.opacity = String(titleProgress);
      titleFrame.style.transform = 'translateY(' + (18 * (1 - easeOutCubic(titleProgress))) + 'px)';
      if (!finished) rafId = requestFrame(applyTimeline);
    }
    function resetInlineStyles() {
      [series, seriesTag, reelTrack, underline, titleFrame].forEach(function (element) {
        element.removeAttribute('style');
      });
    }
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (rafId !== null) cancelFrame(rafId);
      stage.removeEventListener('click', finish);
      stage.removeEventListener('keydown', onKeydown);
      stage.classList.add('is-leaving');
      window.setTimeout(function () {
        stage.classList.remove('is-js-timeline', 'is-playing', 'is-leaving');
        resetInlineStyles();
        try { localStorage.setItem(LAST_SHOWN_KEY, String(Date.now())); } catch (e) { /* 저장 불가 환경에서도 페이지 이용은 가능 */ }
      }, reduceMotion ? 0 : 400);
    }
    function onKeydown(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        finish();
      }
    }

    stage.classList.remove('is-leaving');
    stage.classList.add('is-js-timeline', 'is-playing');
    rafId = requestFrame(applyTimeline);
    var timer = window.setTimeout(finish, DURATION_MS);
    stage.addEventListener('click', finish);
    stage.addEventListener('keydown', onKeydown);
  }

  var now = Date.now();
  var lastShownAt = 0;
  try { lastShownAt = Number(localStorage.getItem(LAST_SHOWN_KEY)) || 0; } catch (e) { /* 접근 불가 시에는 오프닝을 표시 */ }
  if (!(lastShownAt > 0 && now >= lastShownAt && now - lastShownAt < SHOW_INTERVAL_MS)) play();
}());
