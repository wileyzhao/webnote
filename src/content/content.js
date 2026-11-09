/*
 * WebNote — 页面侧主控
 */
(function (root) {
  'use strict';

  if (root.__WN_CONTENT_BOOTED__) return;
  root.__WN_CONTENT_BOOTED__ = true;

  const WN = root.WN;
  const M = WN.model;

  function t(key, params) {
    try {
      return WN.i18n ? WN.i18n.t(key, params) : key;
    } catch (err) {
      return key;
    }
  }
  const A = WN.anchor;
  const H = WN.highlight;
  const U = WN.ui;

  const state = {
    settings: null,
    page: null,
    url: '',
    annotations: [],
    active: false,
    pending: null,
    lastHref: location.href,
    cardAnnotationId: null,
    warned: false,
    booted: false
  };

  // ------------------------------------------------------------ 工具

  function hostname() {
    return location.hostname || location.host || '';
  }

  function isEnabledHere() {
    if (!state.settings) return false;
    if (!state.settings.enabled) return false;
    return state.settings.disabledHosts.indexOf(hostname()) < 0;
  }

  function faviconUrl() {
    try {
      const link = document.querySelector(
        'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'
      );
      if (link && link.href) return link.href;
    } catch (err) {
      /* 忽略 */
    }
    try {
      return location.origin + '/favicon.ico';
    } catch (err) {
      return '';
    }
  }

  function captureSnapshot() {
    if (state.settings && state.settings.saveSnapshot === false) return '';
    try {
      const source = document.body;
      if (!source || typeof source.innerText !== 'string') return '';
      const text = source.innerText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      return text.slice(0, 120000);
    } catch (err) {
      return '';
    }
  }

  function pageInfo(withSnapshot) {
    const info = {
      url: state.url,
      title: (document.title || '').trim() || state.url,
      favicon: faviconUrl()
    };
    // 只在页面还没有快照时抓一次正文，避免每次标注都重复采集
    if (withSnapshot && (!state.page || !state.page.snapshot)) {
      const snap = captureSnapshot();
      if (snap) info.snapshot = snap;
    }
    return info;
  }

  function reportBadge() {
    try {
      chrome.runtime.sendMessage({ type: 'WN_BADGE', count: state.active ? state.annotations.length : 0 });
    } catch (err) {
      /* 忽略 */
    }
  }

  // ------------------------------------------------------------ 渲染

  function renderAll() {
    if (!state.active) return;
    const result = H.render(state.annotations);
    if (!result.supported) {
      if (!state.warned) {
        state.warned = true;
        U.toast(t('content.unsupported'));
      }
      return;
    }
    if (result.lost.length && !state.retried) {
      state.retried = true;
      setTimeout(() => {
        if (!state.active) return;
        A.invalidate();
        renderAll();
      }, 2500);
    }
    reportBadge();
  }

  async function reload() {
    const snapshot = await WN.store.readState();
    state.settings = snapshot.settings;
    WN.i18n.setLocale(state.settings.locale);
    state.page = snapshot.pages[state.url] || null;
    state.annotations = state.page ? state.page.annotations.slice() : [];

    if (isEnabledHere()) {
      if (!state.active) activate();
      U.setTheme(state.settings.theme);
      renderAll();
    } else if (state.active) {
      deactivate();
    }
    reportBadge();
  }

  function activate() {
    state.active = true;
    try {
      U.mount();
      U.setTheme(state.settings ? state.settings.theme : 'auto');
      U.setBlankClickHandler(() => {
        state.pending = null;
      });
    } catch (err) {
      console.warn('[WebNote] 初始化界面失败', err);
    }
  }

  function deactivate() {
    state.active = false;
    H.clear();
    try {
      U.unmount();
    } catch (err) {
      /* 忽略 */
    }
    state.pending = null;
    reportBadge();
  }

  // ------------------------------------------------------------ 选区

  function onSelectionChange() {
    if (!state.active) return;
    if (U.isCardOpen()) return;

    const range = A.getSelectionRange();
    if (!range) {
      U.hideToolbar();
      return;
    }

    const selector = A.selectorFromRange(range);
    if (!selector) {
      U.hideToolbar();
      return;
    }

    const bounds = A.rangeBounds(range);
    state.pending = { selector: selector, bounds: bounds };

    if (!state.settings.showToolbar) {
      U.hideToolbar();
      return;
    }
    if (!bounds) return;

    U.showToolbar(bounds, {
      onColor: (color) => {
        createAnnotation(selector, color, '').catch((err) => {
          U.toast((err && err.message) || t('error.saveFailed'), true);
        });
        clearSelection();
      },
      onCompose: () => openComposer(selector, bounds)
    });
  }

  function clearSelection() {
    U.hideToolbar();
    try {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    } catch (err) {
      /* 忽略 */
    }
    state.pending = null;
  }

  function openComposer(selector, bounds) {
    const color = (state.settings && state.settings.defaultColor) || 'yellow';
    U.openCard({
      quote: selector.quote,
      color: color,
      bounds: bounds,
      mode: 'edit',
      onSave: async (payload) => {
        await createAnnotation(selector, payload.color, payload.note);
        clearSelection();
      },
      onCancel: () => {
        clearSelection();
      }
    });
  }

  // ------------------------------------------------------------ 增删改

  async function createAnnotation(selector, color, note) {
    const info = pageInfo(true);
    const res = await WN.store.mutate('addAnnotation', {
      url: info.url,
      title: info.title,
      favicon: info.favicon,
      snapshot: info.snapshot || '',
      annotation: {
        start: selector.start,
        end: selector.end,
        quote: selector.quote,
        prefix: selector.prefix,
        suffix: selector.suffix,
        color: color,
        note: note || ''
      }
    });
    await reload();
    if (!res.merged) U.toast(note ? t('content.savedNote') : t('content.savedHighlight'));
    return res;
  }

  function openAnnotationCard(id) {
    const ann = state.annotations.find((a) => a.id === id);
    if (!ann) return;

    clearSelection();
    state.cardAnnotationId = id;

    U.openCard({
      id: ann.id,
      quote: ann.quote,
      note: ann.note,
      color: ann.color,
      createdAt: ann.createdAt,
      bounds: H.getRect(id),
      mode: 'view',
      onSave: async (payload) => {
        await WN.store.mutate('updateAnnotation', {
          url: state.url,
          id: id,
          patch: { note: payload.note, color: payload.color }
        });
        await reload();
      },
      onChangeColor: async (color) => {
        await WN.store.mutate('updateAnnotation', { url: state.url, id: id, patch: { color: color } });
        await reload();
      },
      onDelete: async () => {
        await WN.store.mutate('deleteAnnotation', { url: state.url, id: id });
        state.cardAnnotationId = null;
        await reload();
      }
    });
  }

  async function focusAnnotation(id) {
    await reload();
    if (!H.has(id)) {
      U.toast(t('content.annotationLost'));
      return;
    }
    H.scrollIntoView(id);
    setTimeout(() => openAnnotationCard(id), 480);
  }

  // ------------------------------------------------------------ 事件绑定

  function bindSelection() {
    let timer = null;
    document.addEventListener('selectionchange', () => {
      if (!state.active) return;
      clearTimeout(timer);
      timer = setTimeout(onSelectionChange, 170);
    });
  }

  function bindClickOnHighlight() {
    document.addEventListener(
      'click',
      (e) => {
        if (!state.active) return;
        if (U.isCardOpen()) return;

        const path = e.composedPath ? e.composedPath() : [];
        for (let i = 0; i < path.length; i++) {
          const node = path[i];
          if (node && node.id === '__webnote_host__') return;
        }

        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;

        const id = H.hitTest(e.clientX, e.clientY);
        if (!id) return;

        e.preventDefault();
        e.stopPropagation();
        openAnnotationCard(id);
      },
      true
    );
  }

  function bindHover() {
    const onMove = WN.util.throttle((e) => {
      if (!state.active || U.isCardOpen()) return;
      if (e.buttons !== 0) return;
      const id = H.hitTest(e.clientX, e.clientY);
      H.setHover(id);
    }, 90);
    document.addEventListener('mousemove', onMove, { passive: true });

    document.addEventListener('mouseleave', () => H.clearHover());
  }

  function bindStorage() {
    WN.store.watch((snapshot) => {
      const wasEnabled = state.active;
      const prevLocale = WN.i18n.getLocale();
      state.settings = snapshot.settings;
      WN.i18n.setLocale(state.settings.locale);
      const localeChanged = prevLocale !== WN.i18n.getLocale();
      state.page = snapshot.pages[state.url] || null;
      state.annotations = state.page ? state.page.annotations.slice() : [];

      if (isEnabledHere()) {
        if (!wasEnabled) activate();
        U.setTheme(state.settings.theme);
        if (localeChanged) U.refreshI18n();
        renderAll();
      } else if (wasEnabled) {
        deactivate();
      }
      reportBadge();
    });
  }

  function bindMutations() {
    const target = document.body;
    if (!target || typeof MutationObserver !== 'function') return;

    const rerender = WN.util.debounce(() => {
      if (!state.active) return;
      A.invalidate();
      renderAll();
    }, 1400);

    const observer = new MutationObserver(() => {
      A.invalidate();
      rerender();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return false;

      switch (message.type) {
        case 'WN_PING':
          sendResponse({ ok: true });
          return false;

        case 'WN_SAVE_PAGE':
          (async () => {
            if (!isEnabledHere()) {
              U.toast(t('content.disabledHere'));
              sendResponse({ ok: false });
              return;
            }
            try {
              await WN.store.mutate('savePage', pageInfo(true));
              await reload();
              U.toast(t('content.savedToLibrary'));
              sendResponse({ ok: true });
            } catch (err) {
              U.toast((err && err.message) || t('error.saveFailed'), true);
              sendResponse({ ok: false, error: err && err.message });
            }
          })();
          return true;

        case 'WN_ANNOTATE_SELECTION':
          (async () => {
            try {
              const ok = await annotateSelection(message);
              sendResponse({ ok: ok });
            } catch (err) {
              sendResponse({ ok: false, error: err && err.message });
            }
          })();
          return true;

        case 'WN_FOCUS_ANNOTATION':
          (async () => {
            await focusAnnotation(message.id);
            sendResponse({ ok: true });
          })();
          return true;

        case 'WN_OPEN_SETTINGS':
          (async () => {
            await reload();
            sendResponse({ ok: true });
          })();
          return true;

        default:
          return false;
      }
    });
  }

  async function annotateSelection(message) {
    if (!isEnabledHere()) {
      U.toast(t('content.disabledHere'));
      return false;
    }

    const range = A.getSelectionRange();
    if (!range) {
      U.toast(t('content.selectFirst'));
      return false;
    }

    const selector = A.selectorFromRange(range);
    if (!selector) {
      U.toast(t('content.cannotAnnotate'));
      return false;
    }

    const bounds = A.rangeBounds(range);
    const color = message.color || (state.settings && state.settings.defaultColor) || 'yellow';
    state.pending = { selector: selector, bounds: bounds };

    if (message.withNote) {
      U.openCard({
        quote: selector.quote,
        color: color,
        bounds: bounds,
        mode: 'edit',
        onSave: async (payload) => {
          await createAnnotation(selector, payload.color, payload.note);
          clearSelection();
        },
        onCancel: () => clearSelection()
      });
      return true;
    }

    await createAnnotation(selector, color, '');
    clearSelection();
    return true;
  }

  // ------------------------------------------------------------ SPA 路由

  function watchRoute() {
    setInterval(() => {
      if (location.href === state.lastHref) return;
      state.lastHref = location.href;
      state.url = M.normalizeUrl(location.href);
      state.retried = false;
      A.invalidate();
      try {
        U.closeCard();
        U.hideToolbar();
      } catch (err) {
        /* 忽略 */
      }
      state.pending = null;
      reload();
    }, 900);
  }

  // ------------------------------------------------------------ 启动

  async function boot() {
    if (state.booted) return;
    state.booted = true;

    state.url = M.normalizeUrl(location.href);
    const snapshot = await WN.store.readState();
    state.settings = snapshot.settings;
    WN.i18n.setLocale(state.settings.locale);
    state.page = snapshot.pages[state.url] || null;
    state.annotations = state.page ? state.page.annotations.slice() : [];

    if (isEnabledHere()) activate();

    bindSelection();
    bindClickOnHighlight();
    bindHover();
    bindStorage();
    bindMutations();
    bindMessages();
    watchRoute();

    if (state.active) renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  WN.content = {
    reload: reload,
    getState: () => state,
    savePage: () => WN.store.mutate('savePage', pageInfo(true))
  };
})(typeof self !== 'undefined' ? self : globalThis);
