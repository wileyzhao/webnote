/*
 * WebNote — 文本锚定
 *
 * 思路：把整篇文档里所有「可见文本节点」按文档顺序拼成一条长字符串，
 * 标注记录 (start, end) 全局字符偏移 + quote + 前后文。
 * 恢复时按 偏移量 → 上下文 → 全文匹配 → 空白宽松匹配 四级兜底定位，
 * 因此页面结构微调（广告插入、懒加载）后依然能找回来。
 */
(function (root) {
  'use strict';

  const WN = (root.WN = root.WN || {});

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION',
    'IFRAME', 'CANVAS', 'SVG', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'HEAD', 'TITLE'
  ]);

  const CONTEXT_LEN = 48;

  let index = null;
  let dirty = true;
  let visibilityCache = new Map();

  // ------------------------------------------------------------ 可见性过滤

  function elVisible(el) {
    if (!el) return false;
    const cached = visibilityCache.get(el);
    if (cached !== undefined) return cached;
    let visible = true;
    try {
      if (typeof el.checkVisibility === 'function') {
        visible = el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
      }
    } catch (err) {
      visible = true;
    }
    visibilityCache.set(el, visible);
    return visible;
  }

  // ------------------------------------------------------------ 索引构建

  function build() {
    const rootEl = document.body || document.documentElement;
    const nodes = [];
    const map = new Map();
    const parts = [];
    let length = 0;

    if (rootEl) {
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = node.nodeValue;
          if (!value || !value.length) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (!elVisible(parent)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        const entry = { node: node, start: length, end: length + value.length };
        nodes.push(entry);
        map.set(node, entry);
        parts.push(value);
        length += value.length;
      }
    }

    index = { text: parts.join(''), nodes: nodes, map: map, builtAt: Date.now() };
    dirty = false;
    return index;
  }

  function getIndex() {
    if (!index || dirty) {
      visibilityCache = new Map();
      try {
        return build();
      } catch (err) {
        // 页面在遍历过程中被改动可能导致异常，退化为空索引而不是让调用方拿到 null
        console.warn('[WebNote] 构建文本索引失败', err);
        index = { text: '', nodes: [], map: new Map(), builtAt: Date.now() };
        dirty = false;
        return index;
      }
    }
    return index;
  }

  /** DOM 变动后调用，标记索引过期 */
  function invalidate() {
    dirty = true;
  }

  function isDirty() {
    return dirty;
  }

  // ------------------------------------------------------------ 偏移量 ↔ 节点

  function pointAt(offset) {
    const idx = getIndex();
    const nodes = idx.nodes;
    if (!nodes.length) return null;
    if (offset <= 0) return { node: nodes[0].node, offset: 0 };
    const last = nodes[nodes.length - 1];
    if (offset >= last.end) {
      return { node: last.node, offset: last.node.nodeValue.length };
    }

    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].end <= offset) lo = mid + 1;
      else hi = mid;
    }
    const entry = nodes[lo];
    const inNode = Math.max(0, Math.min(offset - entry.start, entry.node.nodeValue.length));
    return { node: entry.node, offset: inNode };
  }

  function firstIndexedText(node) {
    if (!node || !index) return null;
    // 文本节点必须真的在索引里：页面里存在大量空文本节点、
    // 以及位于隐藏区域的文本节点，它们不会被收录
    if (node.nodeType === 3) return index.map.has(node) ? node : null;
    if (node.nodeType !== 1) return null;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let found;
    while ((found = walker.nextNode())) {
      if (index.map.has(found)) return found;
    }
    return null;
  }

  function lastIndexedText(node) {
    if (!node || !index) return null;
    if (node.nodeType === 3) return index.map.has(node) ? node : null;
    if (node.nodeType !== 1) return null;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let found;
    let last = null;
    while ((found = walker.nextNode())) {
      if (index.map.has(found)) last = found;
    }
    return last;
  }

  function resolvePoint(container, offset) {
    if (!container || !index) return null;
    if (container.nodeType === 3) {
      const entry = index.map.get(container);
      if (!entry) return null;
      return entry.start + Math.max(0, Math.min(offset, container.nodeValue.length));
    }
    if (container.nodeType !== 1) return null;

    const children = container.childNodes;
    for (let i = offset; i < children.length; i++) {
      const textNode = firstIndexedText(children[i]);
      if (!textNode) continue;
      const entry = index.map.get(textNode);
      if (entry) return entry.start;
    }
    for (let i = Math.min(offset, children.length) - 1; i >= 0; i--) {
      const textNode = lastIndexedText(children[i]);
      if (!textNode) continue;
      const entry = index.map.get(textNode);
      if (entry) return entry.start + textNode.nodeValue.length;
    }
    return null;
  }

  function rangeFromOffsets(start, end) {
    const a = pointAt(start);
    const b = pointAt(end);
    if (!a || !b) return null;
    try {
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      return range.collapsed ? null : range;
    } catch (err) {
      return null;
    }
  }

  // ------------------------------------------------------------ 选区 → 选择器

  function selectorFromRange(range) {
    if (!range) return null;
    const idx = getIndex();
    if (!idx.text) return null;

    const start = resolvePoint(range.startContainer, range.startOffset);
    const end = resolvePoint(range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return null;

    // 去掉首尾纯空白：很多站点的段落首行有缩进换行，
    // 这些空白既不该进标注原文，也不该出现在批注卡片的引用里。
    const raw = idx.text.slice(start, end);
    const lead = raw.length - raw.replace(/^\s+/, '').length;
    const trail = raw.length - raw.replace(/\s+$/, '').length;
    const quoteStart = start + lead;
    const quoteEnd = end - trail;
    if (quoteEnd <= quoteStart) return null;

    const quote = idx.text.slice(quoteStart, quoteEnd);
    if (!quote.trim()) return null;

    return {
      start: quoteStart,
      end: quoteEnd,
      quote: quote,
      prefix: idx.text.slice(Math.max(0, quoteStart - CONTEXT_LEN), quoteStart),
      suffix: idx.text.slice(quoteEnd, Math.min(idx.text.length, quoteEnd + CONTEXT_LEN))
    };
  }

  // ------------------------------------------------------------ 选择器 → 位置

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function looseSearch(text, quote) {
    const tokens = quote.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.length > 160) return null;
    let re;
    try {
      re = new RegExp(tokens.map(escapeRegExp).join('[\\s\\u00a0]+'), 'g');
    } catch (err) {
      return null;
    }
    const m = re.exec(text);
    if (!m) return null;
    return { start: m.index, end: m.index + m[0].length };
  }

  /** 返回 {start, end} 或 null */
  function locate(annotation) {
    if (!annotation) return null;
    const idx = getIndex();
    const text = idx.text;
    const quote = annotation.quote || '';
    if (!text || !quote) return null;

    const len = quote.length;
    const originalStart = Number.isFinite(annotation.start) ? annotation.start : 0;

    // 1) 原偏移量仍然对得上（最快，也最常见）
    if (originalStart >= 0 && text.substr(originalStart, len) === quote) {
      return { start: originalStart, end: originalStart + len };
    }

    // 2) 前文 + 原文 + 后文 一起匹配，抗局部插入
    const prefix = annotation.prefix || '';
    const suffix = annotation.suffix || '';
    if (prefix || suffix) {
      const at = text.indexOf(prefix + quote + suffix);
      if (at >= 0) {
        const start = at + prefix.length;
        return { start: start, end: start + len };
      }
    }

    // 3) 只匹配原文，多处出现时取离原位置最近的一处
    let best = -1;
    let bestDist = Infinity;
    let from = 0;
    let guard = 0;
    while (guard++ < 240) {
      const at = text.indexOf(quote, from);
      if (at < 0) break;
      const dist = Math.abs(at - originalStart);
      if (dist < bestDist) {
        bestDist = dist;
        best = at;
      }
      from = at + 1;
    }
    if (best >= 0) {
      return { start: best, end: best + len };
    }

    // 4) 空白/换行差异的宽松匹配
    return looseSearch(text, quote);
  }

  function rangeFromAnnotation(annotation) {
    const found = locate(annotation);
    if (!found) return null;
    const range = rangeFromOffsets(found.start, found.end);
    if (!range) return null;
    return { range: range, start: found.start, end: found.end };
  }

  // ------------------------------------------------------------ 选区辅助

  /** 取当前可用选区；落在输入框里的选区忽略 */
  function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!range || range.collapsed) return null;

    const container = range.commonAncestorContainer;
    let el = container;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (el && el.closest) {
      if (el.closest('input, textarea')) return null;
    }
    return range;
  }

  /** 选区矩形（用于浮层定位），多行时返回包围盒 */
  function rangeRect(range) {
    if (!range) return null;
    try {
      const rects = range.getClientRects();
      if (rects && rects.length) {
        return rects[rects.length - 1];
      }
      const rect = range.getBoundingClientRect();
      return rect && (rect.width || rect.height) ? rect : null;
    } catch (err) {
      return null;
    }
  }

  function rangeBounds(range) {
    if (!range) return null;
    try {
      const rect = range.getBoundingClientRect();
      return rect && (rect.width || rect.height) ? rect : null;
    } catch (err) {
      return null;
    }
  }

  WN.anchor = {
    getIndex: getIndex,
    invalidate: invalidate,
    isDirty: isDirty,
    selectorFromRange: selectorFromRange,
    locate: locate,
    rangeFromAnnotation: rangeFromAnnotation,
    pointAt: pointAt,
    rangeFromOffsets: rangeFromOffsets,
    getSelectionRange: getSelectionRange,
    rangeRect: rangeRect,
    rangeBounds: rangeBounds
  };
})(typeof self !== 'undefined' ? self : globalThis);
