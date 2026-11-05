/*
 * WebNote — 共享数据模型
 * 纯函数 + 无 DOM 依赖，content script / service worker / 扩展页面通用。
 */
(function (root) {
  'use strict';

  const WN = (root.WN = root.WN || {});

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'webnote:v1';
  const MAX_QUOTE_LEN = 2000;
  const MAX_SNAPSHOT_LEN = 120000;

  /** 标注配色。id 会写进 CSS 的 ::highlight(wn-xxx) 选择器，勿随意改动。 */
  const COLORS = [
    { id: 'yellow', label: '黄色', hex: '#f2c33d' },
    { id: 'green', label: '绿色', hex: '#3fb950' },
    { id: 'blue', label: '蓝色', hex: '#4b93f7' },
    { id: 'pink', label: '粉色', hex: '#ec6a9c' },
    { id: 'purple', label: '紫色', hex: '#9b7bf0' }
  ];
  const COLOR_IDS = COLORS.map((c) => c.id);
  /** 新建标签时按这个顺序轮换默认色 */
  const TAG_PALETTE = ['blue', 'green', 'purple', 'pink', 'yellow'];

  const DEFAULT_SETTINGS = {
    /** 全局总开关（相当于沉浸式翻译那个一键开关） */
    enabled: true,
    /** 在这些域名上暂停使用 */
    disabledHosts: [],
    defaultColor: 'yellow',
    /** 选中文字后是否浮出小工具条 */
    showToolbar: true,
    /** 点击颜色后是否顺带打开批注编辑框 */
    autoOpenNote: false,
    /** 保存页面时顺带存一份正文纯文本快照 */
    saveSnapshot: true,
    theme: 'auto'
  };

  // ---------------------------------------------------------------- 基础工具

  function nowTs() {
    return Date.now();
  }

  function uid(prefix) {
    return (
      (prefix || '') +
      nowTs().toString(36) +
      Math.random().toString(36).slice(2, 9)
    );
  }

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function str(v, fallback) {
    return typeof v === 'string' ? v : fallback === undefined ? '' : fallback;
  }

  /** 把任意 URL 规范成稳定形式，作为页面唯一标识。 */
  function normalizeUrl(url) {
    const raw = str(url).trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return u.href;
    } catch (e) {
      return raw;
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return '';
    }
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------- 规范化

  function normalizeSettings(input) {
    const s = Object.assign({}, DEFAULT_SETTINGS, isObject(input) ? input : {});
    if (!Array.isArray(s.disabledHosts)) s.disabledHosts = [];
    s.disabledHosts = s.disabledHosts.filter((h) => typeof h === 'string' && h);
    if (COLOR_IDS.indexOf(s.defaultColor) < 0) s.defaultColor = 'yellow';
    if (['auto', 'light', 'dark'].indexOf(s.theme) < 0) s.theme = 'auto';
    s.enabled = s.enabled !== false;
    s.showToolbar = s.showToolbar !== false;
    s.autoOpenNote = s.autoOpenNote === true;
    s.saveSnapshot = s.saveSnapshot !== false;
    return s;
  }

  function normalizeAnnotation(input) {
    if (!isObject(input)) return null;
    const quote = str(input.quote).slice(0, MAX_QUOTE_LEN);
    if (!quote || !quote.trim()) return null;
    const start = Number.isFinite(input.start) ? Math.max(0, Math.floor(input.start)) : 0;
    const end = Number.isFinite(input.end) ? Math.max(start, Math.floor(input.end)) : start + quote.length;
    const created = Number.isFinite(input.createdAt) ? input.createdAt : nowTs();
    return {
      id: str(input.id) || uid('a_'),
      start: start,
      end: end,
      quote: quote,
      prefix: str(input.prefix).slice(-120),
      suffix: str(input.suffix).slice(0, 120),
      color: COLOR_IDS.indexOf(input.color) >= 0 ? input.color : 'yellow',
      note: str(input.note),
      createdAt: created,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : created
    };
  }

  function normalizePage(input) {
    if (!isObject(input)) return null;
    const url = normalizeUrl(input.url);
    if (!url) return null;
    const created = Number.isFinite(input.createdAt) ? input.createdAt : nowTs();
    const annotations = Array.isArray(input.annotations)
      ? input.annotations.map(normalizeAnnotation).filter(Boolean)
      : [];
    const seen = new Set();
    const tagIds = Array.isArray(input.tagIds) ? input.tagIds.filter((t) => typeof t === 'string') : [];
    return {
      url: url,
      title: str(input.title) || url,
      favicon: str(input.favicon),
      host: hostOf(url),
      createdAt: created,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : created,
      tagIds: tagIds.filter((t) => (seen.has(t) ? false : (seen.add(t), true))),
      annotations: annotations,
      snapshot: str(input.snapshot).slice(0, MAX_SNAPSHOT_LEN)
    };
  }

  function normalizeTag(input) {
    if (!isObject(input)) return null;
    const name = str(input.name).trim();
    if (!name) return null;
    return {
      id: str(input.id) || uid('t_'),
      name: name.slice(0, 60),
      parentId: typeof input.parentId === 'string' && input.parentId ? input.parentId : null,
      color: COLOR_IDS.indexOf(input.color) >= 0 ? input.color : 'blue',
      order: Number.isFinite(input.order) ? input.order : 0,
      createdAt: Number.isFinite(input.createdAt) ? input.createdAt : nowTs()
    };
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      pages: {},
      tags: [],
      settings: normalizeSettings(null)
    };
  }

  function normalizeState(input) {
    const base = emptyState();
    if (!isObject(input)) return base;

    const pages = {};
    if (isObject(input.pages)) {
      Object.keys(input.pages).forEach((key) => {
        const page = normalizePage(input.pages[key]);
        if (page) pages[page.url] = page;
      });
    }

    const tags = [];
    const tagIds = new Set();
    if (Array.isArray(input.tags)) {
      input.tags.forEach((raw) => {
        const tag = normalizeTag(raw);
        if (tag && !tagIds.has(tag.id)) {
          tagIds.add(tag.id);
          tags.push(tag);
        }
      });
    }
    // 断开指向不存在父级的引用，避免树渲染出孤儿
    tags.forEach((tag) => {
      if (tag.parentId && !tagIds.has(tag.parentId)) tag.parentId = null;
    });
    // 防御循环引用
    tags.forEach((tag) => {
      let cursor = tag.parentId;
      let guard = 0;
      while (cursor && guard++ < 64) {
        const parent = tags.find((t) => t.id === cursor);
        if (!parent) break;
        if (parent.id === tag.id || parent.parentId === tag.id) {
          tag.parentId = null;
          break;
        }
        cursor = parent.parentId;
      }
    });

    const validTags = new Set(tags.map((t) => t.id));
    Object.keys(pages).forEach((url) => {
      pages[url].tagIds = pages[url].tagIds.filter((id) => validTags.has(id));
    });

    return {
      version: SCHEMA_VERSION,
      pages: pages,
      tags: tags,
      settings: normalizeSettings(input.settings)
    };
  }

  // ---------------------------------------------------------------- 标签工具

  function getTag(tags, id) {
    return tags.find((t) => t.id === id) || null;
  }

  function childrenOf(tags, parentId) {
    return tags
      .filter((t) => (t.parentId || null) === (parentId || null))
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  function tagPath(tags, id) {
    const out = [];
    let cursor = getTag(tags, id);
    let guard = 0;
    while (cursor && guard++ < 64) {
      out.unshift(cursor);
      cursor = cursor.parentId ? getTag(tags, cursor.parentId) : null;
    }
    return out;
  }

  /** 返回 id 自身 + 全部后代 id */
  function tagSubtreeIds(tags, id) {
    const out = [id];
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      childrenOf(tags, cur).forEach((child) => {
        out.push(child.id);
        queue.push(child.id);
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- 变更操作

  function ensurePage(state, info) {
    const url = normalizeUrl(info && info.url);
    if (!url) throw new Error('无效的页面地址');
    let page = state.pages[url];
    if (!page) {
      page = normalizePage({
        url: url,
        title: (info && info.title) || url,
        favicon: (info && info.favicon) || '',
        createdAt: nowTs(),
        updatedAt: nowTs()
      });
      state.pages[url] = page;
    }
    if (info && typeof info.title === 'string' && info.title.trim()) page.title = info.title.trim().slice(0, 300);
    if (info && typeof info.favicon === 'string' && info.favicon) page.favicon = info.favicon;
    // 正文快照只保留首次抓到的那份，避免每次标注都覆盖
    if (info && typeof info.snapshot === 'string' && info.snapshot && !page.snapshot) {
      page.snapshot = info.snapshot.slice(0, MAX_SNAPSHOT_LEN);
    }
    return page;
  }

  function findPage(state, url) {
    return state.pages[normalizeUrl(url)] || null;
  }

  /**
   * 核心 reducer。直接修改传入的 state 并返回补充信息。
   * 调用方负责保证 state 是独占的可变副本（background 里串行执行）。
   */
  function mutate(state, op, payload) {
    const p = isObject(payload) ? payload : {};
    switch (op) {
      case 'savePage': {
        const page = ensurePage(state, p);
        page.updatedAt = nowTs();
        return { page: page };
      }

      case 'deletePage': {
        const url = normalizeUrl(p.url);
        const existed = !!state.pages[url];
        delete state.pages[url];
        return { removed: existed };
      }

      case 'addAnnotation': {
        const page = ensurePage(state, p);
        const ann = normalizeAnnotation(p.annotation);
        if (!ann) throw new Error('选区内容为空，无法标注');
        const twin = page.annotations.find((a) => a.start === ann.start && a.end === ann.end);
        if (twin) {
          twin.color = ann.color;
          if (ann.note) twin.note = ann.note;
          twin.updatedAt = nowTs();
          page.updatedAt = twin.updatedAt;
          return { page: page, annotation: twin, merged: true };
        }
        page.annotations.push(ann);
        page.updatedAt = nowTs();
        return { page: page, annotation: ann, merged: false };
      }

      case 'updateAnnotation': {
        const page = findPage(state, p.url);
        if (!page) throw new Error('页面尚未保存');
        const ann = page.annotations.find((a) => a.id === p.id);
        if (!ann) throw new Error('标注不存在');
        const patch = isObject(p.patch) ? p.patch : {};
        if (typeof patch.note === 'string') ann.note = patch.note.slice(0, 8000);
        if (COLOR_IDS.indexOf(patch.color) >= 0) ann.color = patch.color;
        ann.updatedAt = nowTs();
        page.updatedAt = ann.updatedAt;
        return { page: page, annotation: ann };
      }

      case 'deleteAnnotation': {
        const page = findPage(state, p.url);
        if (!page) return { removed: false };
        const before = page.annotations.length;
        page.annotations = page.annotations.filter((a) => a.id !== p.id);
        if (page.annotations.length !== before) page.updatedAt = nowTs();
        return { removed: page.annotations.length !== before };
      }

      case 'setPageTags': {
        const page = ensurePage(state, p);
        const ids = Array.isArray(p.tagIds) ? p.tagIds.filter((t) => getTag(state.tags, t)) : [];
        page.tagIds = ids.filter((t, i) => ids.indexOf(t) === i);
        page.updatedAt = nowTs();
        return { page: page };
      }

      case 'addTag': {
        const name = str(p.name).trim();
        if (!name) throw new Error('标签名不能为空');
        let parentId = p.parentId || null;
        if (parentId && !getTag(state.tags, parentId)) parentId = null;
        const sameLevel = state.tags.find((t) => (t.parentId || null) === parentId && t.name === name);
        if (sameLevel) throw new Error('同一层已经有叫「' + name + '」的标签了');
        const siblings = childrenOf(state.tags, parentId);
        // 没指定颜色时按调色板轮换，让标签树自带层次感
        const color = COLOR_IDS.indexOf(p.color) >= 0 ? p.color : TAG_PALETTE[state.tags.length % TAG_PALETTE.length];
        const tag = normalizeTag({
          name: name,
          parentId: parentId,
          color: color,
          order: siblings.length ? siblings[siblings.length - 1].order + 1 : 0
        });
        state.tags.push(tag);
        return { tag: tag };
      }

      case 'renameTag': {
        const tag = getTag(state.tags, p.id);
        if (!tag) throw new Error('标签不存在');
        const name = str(p.name).trim();
        if (!name) throw new Error('标签名不能为空');
        tag.name = name.slice(0, 60);
        return { tag: tag };
      }

      case 'moveTag': {
        const tag = getTag(state.tags, p.id);
        if (!tag) throw new Error('标签不存在');
        const target = p.parentId || null;
        if (target && !getTag(state.tags, target)) throw new Error('目标标签不存在');
        if (target) {
          const banned = tagSubtreeIds(state.tags, tag.id);
          if (banned.indexOf(target) >= 0) throw new Error('不能把标签移动到它自己或它的子标签下');
        }
        tag.parentId = target;
        const siblings = childrenOf(state.tags, target).filter((t) => t.id !== tag.id);
        tag.order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
        return { tag: tag };
      }

      case 'updateTag': {
        const tag = getTag(state.tags, p.id);
        if (!tag) throw new Error('标签不存在');
        if (typeof p.name === 'string') {
          const name = p.name.trim();
          if (!name) throw new Error('标签名不能为空');
          const targetParent = p.parentId !== undefined ? p.parentId || null : tag.parentId || null;
          const dup = state.tags.find(
            (t) => t.id !== tag.id && (t.parentId || null) === targetParent && t.name === name
          );
          if (dup) throw new Error('同一层已经有叫「' + name + '」的标签了');
          tag.name = name.slice(0, 60);
        }
        if (COLOR_IDS.indexOf(p.color) >= 0) tag.color = p.color;
        if (p.parentId !== undefined) {
          const target = p.parentId || null;
          if (target && !getTag(state.tags, target)) throw new Error('目标标签不存在');
          if (target && tagSubtreeIds(state.tags, tag.id).indexOf(target) >= 0) {
            throw new Error('不能把标签移动到它自己或它的子标签下');
          }
          if ((tag.parentId || null) !== target) {
            tag.parentId = target;
            const siblings = childrenOf(state.tags, target).filter((t) => t.id !== tag.id);
            tag.order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
          }
        }
        return { tag: tag };
      }

      case 'deleteTag': {
        const tag = getTag(state.tags, p.id);
        if (!tag) return { removed: false };
        const doomed = new Set(tagSubtreeIds(state.tags, tag.id));
        state.tags = state.tags.filter((t) => !doomed.has(t.id));
        Object.keys(state.pages).forEach((url) => {
          const page = state.pages[url];
          const next = page.tagIds.filter((id) => !doomed.has(id));
          if (next.length !== page.tagIds.length) {
            page.tagIds = next;
            page.updatedAt = nowTs();
          }
        });
        return { removed: true, count: doomed.size };
      }

      case 'updateSettings': {
        state.settings = normalizeSettings(Object.assign({}, state.settings, isObject(p.patch) ? p.patch : {}));
        return { settings: state.settings };
      }

      case 'replaceState': {
        const next = normalizeState(p.state);
        state.pages = next.pages;
        state.tags = next.tags;
        state.settings = next.settings;
        return { ok: true };
      }

      case 'clearAll': {
        state.pages = {};
        state.tags = [];
        return { ok: true };
      }

      default:
        throw new Error('未知操作: ' + op);
    }
  }

  /** 合并导入的数据（按 url 合并页面，按 id 去重标注） */
  function mergeState(target, incoming) {
    const src = normalizeState(incoming);
    const tagIdMap = new Map();

    src.tags.forEach((tag) => {
      const sameName = target.tags.find((t) => t.id === tag.id);
      if (sameName) {
        tagIdMap.set(tag.id, sameName.id);
        return;
      }
      let cloned = normalizeTag(Object.assign({}, tag, { id: uid('t_') }));
      target.tags.push(cloned);
      tagIdMap.set(tag.id, cloned.id);
    });

    target.tags.forEach((tag) => {
      if (tag.parentId && tagIdMap.has(tag.parentId)) tag.parentId = tagIdMap.get(tag.parentId);
    });

    Object.keys(src.pages).forEach((url) => {
      const srcPage = src.pages[url];
      const page = ensurePage(target, { url: url, title: srcPage.title, favicon: srcPage.favicon });
      page.createdAt = Math.min(page.createdAt, srcPage.createdAt);
      const existing = new Set(page.annotations.map((a) => a.id));
      srcPage.annotations.forEach((ann) => {
        if (existing.has(ann.id)) return;
        page.annotations.push(ann);
        existing.add(ann.id);
      });
      srcPage.tagIds.forEach((oldId) => {
        const newId = tagIdMap.get(oldId);
        if (newId && page.tagIds.indexOf(newId) < 0) page.tagIds.push(newId);
      });
      page.annotations.sort((a, b) => a.start - b.start);
      page.updatedAt = Math.max(page.updatedAt, srcPage.updatedAt);
    });

    return {
      pages: Object.keys(src.pages).length,
      tags: src.tags.length
    };
  }

  WN.model = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    COLORS,
    COLOR_IDS,
    TAG_PALETTE,
    DEFAULT_SETTINGS,
    nowTs,
    uid,
    normalizeUrl,
    hostOf,
    originOf,
    normalizeSettings,
    normalizeAnnotation,
    normalizePage,
    normalizeTag,
    normalizeState,
    emptyState,
    getTag,
    childrenOf,
    tagPath,
    tagSubtreeIds,
    ensurePage,
    findPage,
    mutate,
    mergeState
  };
})(typeof self !== 'undefined' ? self : globalThis);
