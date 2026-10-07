window.RT = window.RT || {};

// 이모지 한 개 검사.
// 규칙: 앞뒤 공백을 지운 뒤 "글자 한 덩어리(자소) 1개"이고, 그게 이모지(Extended_Pictographic 로 시작
// 또는 국기=지역 표시 문자 2개)일 때만 true. 'a'·'1'·'#' 은 덩어리가 1개여도 이모지가 아니라서 거부한다.
// Intl.Segmenter 가 있으면 그것으로 덩어리를 세고, 없으면(iOS 14.5 미만 등) 정규식 하나로 검사한다.
// 알려진 가장자리(허용): ©·™·☺·❤ 같은 글자는 Extended_Pictographic 라서 통과할 수 있다.
(function (RT) {
  var segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  } catch (e) {
    segmenter = null;
  }

  var startRe = null;     // Segmenter 길: 덩어리가 이모지로 시작하는가
  var fallbackRe = null;  // 폴백 길: 전체가 이모지 한 개인가
  try {
    startRe = new RegExp('^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|\\p{Extended_Pictographic})', 'u');
    fallbackRe = new RegExp(
      '^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|' +
      '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?' +
      '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)$', 'u');
  } catch (e) {
    startRe = null;
    fallbackRe = null;
  }

  var engine = segmenter && startRe ? 'segmenter' : 'regex';

  function isSingleEmoji(str) {
    if (typeof str !== 'string') return false;
    var s = str.trim();
    if (!s) return false;
    if (engine === 'segmenter') {
      var count = 0;
      var it = segmenter.segment(s)[Symbol.iterator]();
      var step = it.next();
      while (!step.done) {
        count++;
        if (count > 1) return false;
        step = it.next();
      }
      return count === 1 && startRe.test(s);
    }
    return !!fallbackRe && fallbackRe.test(s);
  }

  RT.emoji = { isSingleEmoji: isSingleEmoji, engine: engine };
  if (document.documentElement) document.documentElement.setAttribute('data-emoji-engine', engine);
})(window.RT);
