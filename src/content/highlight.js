/*
 * WebNote — 高亮渲染
 * 使用 CSS Custom Highlight API（Chrome 105+），不修改页面 DOM，
 * 因此不会触发站点的 MutationObserver，也不会打乱 React/Vue 的渲染。
 */
(function (root) {
  'use strict';

  const WN = (root.WN = root.WN || {});
  const A = WN.anchor;

  const PREFIX = 'wn-';
  const HOVER_KEY = PREFIX + 'hover';

  const SUPPORTED =
    typeof CSS !== 'undefined' &&
    !!CSS.highlights &&
    typeof Highlight === 'function' &&
    typeof CSS.highlights.set === 'function';

  /** id -> { annotation, range, start, end } */
  let entries = new Map();
  let hoverId = null;

  function clearRegistry() {
    if (!SUPPORTED) return;
    try {
      Array.from(CSS.highlights.keys()).forEach((key) => {
        if (key.indexOf(PREFIX) === 0) CSS.highlights.delete(key);
      });
    } catch (err) {
      /* 忽略 */
    }
  }

  function clear() {
    entries = new Map();
    hoverId = null;
    clearRegistry();
  }

  /**
   * 用给定标注列表重绘全部高亮。
   * @returns {{ supported: boolean, lost: Array, rendered: number }}
   */
  function render(annotations) {
    const groups = new Map();
    const lost = [];
    entries = new Map();
    hoverId = null;

    (annotations || []).forEach((ann) => {
      if (!ann || !ann.id) return;
      let hit = null;
      try {
        hit = A.rangeFromAnnotation(ann);
      } catch (err) {
        hit = null;
      }
      if (!hit) {
        lost.push(ann);
        return;
      }
      entries.set(ann.id, {
        annotation: ann,
        range: hit.range,
        start: hit.start,
        end: hit.end
      });
      const color = ann.color || 'yellow';
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push(hit.range);
    });

    if (!SUPPORTED) {
      return { supported: false, lost: lost, rendered: entries.size };
    }

    clearRegistry();
    groups.forEach((ranges, color) => {
      try {
        CSS.highlights.set(PREFIX + color, new Highlight(...ranges));
      } catch (err) {
        /* 单个颜色失败不影响其它 */
      }
    });

    return { supported: true, lost: lost, rendered: entries.size };
  }

  function applyHover() {
    if (!SUPPORTED) return;
    try {
      CSS.highlights.delete(HOVER_KEY);
    } catch (err) {
      /* 忽略 */
    }
    if (!hoverId) return;
    const entry = entries.get(hoverId);
    if (!entry) return;
    try {
      CSS.highlights.set(HOVER_KEY, new Highlight(entry.range));
    } catch (err) {
      /* 忽略 */
    }
  }

  function setHover(id) {
    const next = id || null;
    if (next === hoverId) return;
    hoverId = next;
    applyHover();
  }

  function clearHover() {
    setHover(null);
  }

  /** 判断屏幕坐标是否落在某条高亮上，返回标注 id */
  function hitTest(x, y) {
    let found = null;
    entries.forEach((entry, id) => {
      if (found) return;
      let rects;
      try {
        rects = entry.range.getClientRects();
      } catch (err) {
        return;
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          found = id;
          return;
        }
      }
    });
    return found;
  }

  function getEntry(id) {
    return entries.get(id) || null;
  }

  function has(id) {
    return entries.has(id);
  }

  function getRect(id) {
    const entry = entries.get(id);
    if (!entry) return null;
    try {
      const rect = entry.range.getBoundingClientRect();
      return rect && (rect.width || rect.height) ? rect : null;
    } catch (err) {
      return null;
    }
  }

  /** 把某条高亮滚动到视野中间，并短暂高亮提示 */
  function scrollIntoView(id, smooth) {
    const entry = entries.get(id);
    if (!entry) return false;
    let rect = null;
    try {
      rect = entry.range.getBoundingClientRect();
    } catch (err) {
      return false;
    }
    if (!rect || !(rect.width || rect.height)) return false;

    const target = rect.top + window.scrollY - window.innerHeight / 2;
    window.scrollTo({
      top: Math.max(0, target),
      behavior: smooth === false ? 'auto' : 'smooth'
    });

    setHover(id);
    setTimeout(() => {
      if (hoverId === id) setHover(null);
    }, 1600);
    return true;
  }

  function count() {
    return entries.size;
  }

  WN.highlight = {
    SUPPORTED: SUPPORTED,
    render: render,
    clear: clear,
    setHover: setHover,
    clearHover: clearHover,
    hitTest: hitTest,
    getEntry: getEntry,
    getRect: getRect,
    has: has,
    count: count,
    scrollIntoView: scrollIntoView
  };
})(typeof self !== 'undefined' ? self : globalThis);
