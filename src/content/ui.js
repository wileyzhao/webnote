/*
 * WebNote — 页面内交互层
 * 全部 UI 活在 Shadow DOM 里，与宿主页面样式完全隔离。
 */
(function (root) {
  'use strict';

  const WN = (root.WN = root.WN || {});
  const M = WN.model;

  function t(key, params) {
    try {
      return WN.i18n ? WN.i18n.t(key, params) : key;
    } catch (err) {
      return key;
    }
  }

  const HOST_ID = '__webnote_host__';

  const ICON = {
    note:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    edit:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  const STYLE = `
    :host {
      --wn-bg: #ffffff;
      --wn-bg-soft: #f6f7f9;
      --wn-fg: #1f2328;
      --wn-fg-soft: #6b7280;
      --wn-line: rgba(15, 23, 42, 0.10);
      --wn-shadow: 0 10px 34px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08);
      --wn-accent: #1f2328;
      all: initial;
    }
    :host(.wn-dark) {
      --wn-bg: #1c1f24;
      --wn-bg-soft: #262a31;
      --wn-fg: #e9ecef;
      --wn-fg-soft: #9aa3ad;
      --wn-line: rgba(255, 255, 255, 0.12);
      --wn-shadow: 0 12px 38px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
      --wn-accent: #e9ecef;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .layer {
      position: absolute;
      inset: 0;
      font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: var(--wn-fg);
      -webkit-font-smoothing: antialiased;
    }
    .surface {
      position: fixed;
      background: var(--wn-bg);
      border: 1px solid var(--wn-line);
      border-radius: 12px;
      box-shadow: var(--wn-shadow);
      pointer-events: auto;
      overflow: hidden;
    }

    /* ---------------- 划词工具条 ---------------- */
    .tb {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      border-radius: 999px;
      animation: wn-pop 120ms ease-out;
    }
    @keyframes wn-pop {
      from { opacity: 0; transform: translateY(4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .sw {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--sw);
      border: 2px solid transparent;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }
    .sw:hover { transform: scale(1.16); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sw) 26%, transparent); }
    .sep { width: 1px; height: 18px; background: var(--wn-line); margin: 0 4px; }
    .tb-act {
      gap: 5px;
      padding: 4px 9px;
      border-radius: 8px;
      color: var(--wn-fg-soft);
      font-size: 12.5px;
      white-space: nowrap;
    }
    .tb-act:hover { background: var(--wn-bg-soft); color: var(--wn-fg); }

    /* ---------------- 批注卡片 ---------------- */
    .card {
      width: 340px;
      max-width: calc(100vw - 24px);
      max-height: min(64vh, 520px);
      display: flex;
      flex-direction: column;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 10px 8px 12px;
      border-bottom: 1px solid var(--wn-line);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wn-color, #f2c33d); flex: none; }
    .meta { font-size: 11.5px; color: var(--wn-fg-soft); flex: 1; letter-spacing: 0.2px; }
    .tools { display: flex; gap: 2px; }
    .icon-btn {
      width: 26px; height: 26px; border-radius: 7px; color: var(--wn-fg-soft);
    }
    .icon-btn:hover { background: var(--wn-bg-soft); color: var(--wn-fg); }
    .icon-btn.danger:hover { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

    .card-scroll { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .quote {
      position: relative;
      padding: 2px 0 2px 11px;
      border-left: 3px solid var(--wn-color, #f2c33d);
      color: var(--wn-fg-soft);
      font-size: 12.5px;
      line-height: 1.6;
      max-height: 108px;
      overflow: auto;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .note {
      font-size: 13.5px;
      line-height: 1.7;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .note.empty { color: var(--wn-fg-soft); font-style: italic; }

    .editor {
      width: 100%;
      min-height: 90px;
      max-height: 220px;
      resize: vertical;
      padding: 10px;
      border-radius: 9px;
      border: 1px solid var(--wn-line);
      background: var(--wn-bg-soft);
      color: var(--wn-fg);
      font-family: inherit;
      font-size: 13.5px;
      line-height: 1.65;
      outline: none;
    }
    .editor:focus { border-color: color-mix(in srgb, var(--wn-accent) 40%, transparent); }

    .card-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-top: 1px solid var(--wn-line);
      background: color-mix(in srgb, var(--wn-bg-soft) 60%, var(--wn-bg));
    }
    .colors { display: flex; gap: 5px; }
    .colors .sw { width: 17px; height: 17px; }
    .colors .sw.active { box-shadow: 0 0 0 2px var(--wn-bg), 0 0 0 3.5px var(--wn-fg); }
    .foot-actions { margin-left: auto; display: flex; gap: 6px; }
    .btn {
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      color: var(--wn-fg-soft);
    }
    .btn:hover { background: var(--wn-line); color: var(--wn-fg); }
    .btn.primary { background: var(--wn-accent); color: var(--wn-bg); font-weight: 500; }
    .btn.primary:hover { opacity: 0.86; }

    /* ---------------- toast ---------------- */
    .toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%) translateY(8px);
      padding: 8px 16px;
      border-radius: 999px;
      background: rgba(24, 26, 30, 0.92);
      color: #fff;
      font-size: 12.5px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28);
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
      max-width: 76vw;
      text-align: center;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .toast.err { background: rgba(190, 30, 30, 0.94); }
  `;

  const HTML = `
    <div class="layer">
      <div class="surface tb" data-el="toolbar" hidden>
        <button class="sw" data-color="yellow"></button>
        <button class="sw" data-color="green"></button>
        <button class="sw" data-color="blue"></button>
        <button class="sw" data-color="pink"></button>
        <button class="sw" data-color="purple"></button>
        <span class="sep"></span>
        <button class="tb-act" data-act="compose" data-i18n-title="toolbar.composeTitle">${ICON.note}<span data-i18n="toolbar.compose"></span></button>
      </div>

      <div class="surface card" data-el="card" hidden>
        <div class="card-head">
          <span class="dot" data-el="dot"></span>
          <span class="meta" data-el="meta"></span>
          <div class="tools">
            <button class="icon-btn" data-act="edit" data-i18n-title="card.edit">${ICON.edit}</button>
            <button class="icon-btn danger" data-act="delete" data-i18n-title="card.delete">${ICON.trash}</button>
            <button class="icon-btn" data-act="close" data-i18n-title="card.close">${ICON.close}</button>
          </div>
        </div>
        <div class="card-scroll" data-el="scroll">
          <blockquote class="quote" data-el="quote"></blockquote>
          <div class="note" data-el="note"></div>
          <textarea class="editor" data-el="input" hidden data-i18n-placeholder="card.placeholder"></textarea>
        </div>
        <div class="card-foot">
          <div class="colors" data-el="colors"></div>
          <div class="foot-actions">
            <button class="btn" data-act="cancel" hidden data-i18n="card.cancel"></button>
            <button class="btn primary" data-act="save" hidden data-i18n="card.save"></button>
          </div>
        </div>
      </div>

      <div class="toast" data-el="toast"></div>
    </div>
  `;

  let host = null;
  let shadow = null;
  let els = {};
  let mounted = false;
  let toastTimer = null;
  let current = null;
  let onBlankClick = null;
  let docBound = false;

  // ------------------------------------------------------------ 挂载

  function mount() {
    if (mounted && host && host.isConnected) return;
    if (host && host.isConnected) {
      mounted = true;
      return;
    }

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; width: auto; height: auto; z-index: 2147483647; pointer-events: none;';

    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch (err) {
      return;
    }
    shadow.innerHTML = '<style>' + STYLE + '</style>' + HTML;

    (document.documentElement || document.body).appendChild(host);

    els = {
      toolbar: shadow.querySelector('[data-el="toolbar"]'),
      card: shadow.querySelector('[data-el="card"]'),
      dot: shadow.querySelector('[data-el="dot"]'),
      meta: shadow.querySelector('[data-el="meta"]'),
      quote: shadow.querySelector('[data-el="quote"]'),
      note: shadow.querySelector('[data-el="note"]'),
      input: shadow.querySelector('[data-el="input"]'),
      scroll: shadow.querySelector('[data-el="scroll"]'),
      colors: shadow.querySelector('[data-el="colors"]'),
      toast: shadow.querySelector('[data-el="toast"]')
    };

    buildColorPickers();
    bindEvents();
    mounted = true;
    refreshI18n();
  }

  function unmount() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    shadow = null;
    els = {};
    mounted = false;
    current = null;
  }

  function buildColorPickers() {
    els.colors.innerHTML = M.COLORS.map(
      (c) => '<button class="sw" data-color="' + c.id + '"></button>'
    ).join('');

    M.COLORS.forEach((c) => {
      const btn = els.colors.querySelector('[data-color="' + c.id + '"]');
      if (btn) {
        btn.style.setProperty('--sw', c.hex);
        btn.title = t('color.' + c.id);
      }
    });

    Array.from(els.toolbar.querySelectorAll('.sw')).forEach((btn) => {
      const color = M.COLORS.find((c) => c.id === btn.getAttribute('data-color'));
      if (color) {
        btn.style.setProperty('--sw', color.hex);
        btn.title = t('color.highlight', { color: t('color.' + color.id) });
      }
    });
  }

  /** 语言切换后重新套用文案（不重建 DOM，保留当前打开状态） */
  function refreshI18n() {
    if (!shadow || !mounted) return;
    try {
      WN.i18n.applyI18n(shadow);
    } catch (err) {
      /* 忽略 */
    }
    buildColorPickers();

    if (current) {
      setDotColor(current.color);
      if (els.card && !els.card.hidden) {
        const editing = els.input && !els.input.hidden;
        if (editing) {
          els.meta.textContent = current.id ? t('card.editing') : t('card.newNote');
        } else {
          els.meta.textContent =
            WN.util.relativeTime(current.createdAt) + ' · ' + t('card.annotated');
        }
        renderNoteView();
      }
    }
  }

  // ------------------------------------------------------------ 事件

  function bindEvents() {
    // 防止按钮按下时抢走页面选区
    shadow.addEventListener(
      'mousedown',
      (e) => {
        const target = e.target;
        if (target && target.closest && target.closest('button')) {
          e.preventDefault();
        }
      },
      true
    );

    els.toolbar.addEventListener('click', (e) => {
      const swatch = e.target.closest('.sw');
      if (swatch) {
        const color = swatch.getAttribute('data-color');
        if (current && current.onColor) current.onColor(color);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act && act.getAttribute('data-act') === 'compose') {
        if (current && current.onCompose) current.onCompose();
      }
    });

    els.card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      const swatch = e.target.closest('.sw');

      if (swatch) {
        pickColor(swatch.getAttribute('data-color'));
        return;
      }
      if (!act) return;

      switch (act.getAttribute('data-act')) {
        case 'edit':
          enterEditMode();
          break;
        case 'close':
          closeCard();
          break;
        case 'delete':
          doDelete();
          break;
        case 'cancel':
          doCancel();
          break;
        case 'save':
          doSave();
          break;
        default:
          break;
      }
    });

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        doSave();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        doCancel();
      }
    });

    if (docBound) return;
    docBound = true;

    // 点击页面空白处收起浮层
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!host || !host.isConnected) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(host) >= 0) return;
        if (els.toolbar && !els.toolbar.hidden) hideToolbar();
        if (els.card && !els.card.hidden) closeCard();
        if (onBlankClick) onBlankClick();
      },
      true
    );

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.card && !els.card.hidden) {
        closeCard();
      } else if (els.toolbar && !els.toolbar.hidden) {
        hideToolbar();
      }
    });
  }

  function setBlankClickHandler(fn) {
    onBlankClick = fn;
  }

  // ------------------------------------------------------------ 定位

  function place(el, bounds, prefer) {
    el.style.visibility = 'hidden';
    el.hidden = false;
    const box = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 10;
    const margin = 12;

    let top;
    let left;

    if (!bounds) {
      top = vh / 2 - box.height / 2;
      left = vw / 2 - box.width / 2;
    } else if (prefer === 'above') {
      top = bounds.top - box.height - gap;
      if (top < margin) top = bounds.bottom + gap;
      left = bounds.left + bounds.width / 2 - box.width / 2;
    } else if (prefer === 'below') {
      top = bounds.bottom + gap;
      if (top + box.height > vh - margin) top = bounds.top - box.height - gap;
      left = bounds.left;
    } else {
      top = bounds.top - box.height - gap;
      if (top < margin) top = bounds.bottom + gap;
      left = bounds.left + bounds.width / 2 - box.width / 2;
    }

    left = Math.max(margin, Math.min(left, vw - box.width - margin));
    top = Math.max(margin, Math.min(top, vh - box.height - margin));

    el.style.top = Math.round(top) + 'px';
    el.style.left = Math.round(left) + 'px';
    el.style.visibility = 'visible';
  }

  // ------------------------------------------------------------ 工具条

  function showToolbar(bounds, handlers) {
    if (!mounted) mount();
    if (!els.toolbar || !bounds) return;
    current = handlers || {};
    place(els.toolbar, bounds, 'above');
  }

  function hideToolbar() {
    if (els.toolbar) els.toolbar.hidden = true;
  }

  function isCardOpen() {
    return !!(els.card && !els.card.hidden);
  }

  // ------------------------------------------------------------ 卡片

  function setDotColor(color) {
    const found = M.COLORS.find((c) => c.id === color) || M.COLORS[0];
    els.card.style.setProperty('--wn-color', found.hex);
    Array.from(els.colors.querySelectorAll('.sw')).forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-color') === color);
    });
  }

  /**
   * @param {object} options
   *   id, quote, note, color, createdAt, bounds, mode: 'view'|'edit',
   *   onSave({note, color}), onDelete(), onChangeColor(color), onCancel()
   */
  function openCard(options) {
    if (!mounted) mount();
    if (!els.card) return;

    const opts = options || {};
    current = {
      id: opts.id || null,
      quote: opts.quote || '',
      note: opts.note || '',
      color: opts.color || 'yellow',
      createdAt: opts.createdAt || null,
      bounds: opts.bounds || null,
      onSave: opts.onSave || null,
      onDelete: opts.onDelete || null,
      onChangeColor: opts.onChangeColor || null,
      onCancel: opts.onCancel || null
    };

    hideToolbar();

    els.quote.textContent = current.quote;
    els.meta.textContent = current.id
      ? WN.util.relativeTime(current.createdAt) + ' · ' + t('card.annotated')
      : t('card.newNote');

    setDotColor(current.color);
    renderNoteView();
    setMode(opts.mode === 'edit' ? 'edit' : 'view');

    place(els.card, opts.bounds || null, 'below');
  }

  function renderNoteView() {
    const note = (current && current.note) || '';
    els.note.textContent = note || t('card.noNote');
    els.note.classList.toggle('empty', !note);
  }

  function setMode(mode) {
    const editing = mode === 'edit';
    els.card.classList.toggle('editing', editing);
    els.input.hidden = !editing;
    els.note.hidden = editing;
    els.quote.hidden = false;

    shadow.querySelector('[data-act="edit"]').hidden = editing || !current.id;
    shadow.querySelector('[data-act="delete"]').hidden = editing || !current.id;
    shadow.querySelector('[data-act="cancel"]').hidden = !editing;
    shadow.querySelector('[data-act="save"]').hidden = !editing;
    shadow.querySelector('[data-act="close"]').hidden = false;

    els.meta.textContent = editing
      ? current.id
        ? t('card.editing')
        : t('card.newNote')
      : WN.util.relativeTime(current.createdAt) + ' · ' + t('card.annotated');

    if (editing) {
      els.input.value = current.note || '';
      setTimeout(() => {
        els.input.focus();
        els.input.setSelectionRange(els.input.value.length, els.input.value.length);
      }, 30);
    }
  }

  function enterEditMode() {
    if (!current) return;
    setMode('edit');
    repositionCard();
  }

  function repositionCard() {
    if (!current || !els.card || els.card.hidden) return;
    place(els.card, current.bounds, 'below');
  }

  function closeCard() {
    if (!els.card) return;
    els.card.hidden = true;
    current = null;
  }

  function doCancel() {
    if (!current) return closeCard();
    if (!current.id) {
      if (current.onCancel) current.onCancel();
      closeCard();
      return;
    }
    renderNoteView();
    setMode('view');
    repositionCard();
  }

  function pickColor(color) {
    if (!current || !color) return;
    current.color = color;
    setDotColor(color);
    if (current.onChangeColor) current.onChangeColor(color);
  }

  async function doSave() {
    if (!current) return;
    const note = els.input.value.trim();
    const payload = { note: note, color: current.color };
    const save = current.onSave;
    const isNew = !current.id;

    els.meta.textContent = t('card.saving');
    try {
      if (save) await save(payload);
      current.note = note;
      if (isNew) {
        closeCard();
      } else {
        renderNoteView();
        setMode('view');
      }
      toast(isNew ? (note ? t('card.added') : t('card.highlighted')) : t('card.updated'));
    } catch (err) {
      els.meta.textContent = t('card.saveFailedRetry');
      toast((err && err.message) || t('error.saveFailed'), true);
    }
  }

  async function doDelete() {
    if (!current) return;
    const del = current.onDelete;
    try {
      if (del) await del();
      closeCard();
      toast(t('card.deleted'));
    } catch (err) {
      toast((err && err.message) || t('card.deleteFailed'), true);
    }
  }

  // ------------------------------------------------------------ toast / 主题

  function toast(message, isError) {
    if (!mounted) mount();
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('err', !!isError);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 1900);
  }

  function setTheme(mode) {
    if (!mounted || !host) return;
    let dark = mode === 'dark';
    if (mode === 'auto' || !mode) {
      dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    host.classList.toggle('wn-dark', !!dark);
  }

  WN.ui = {
    mount: mount,
    unmount: unmount,
    showToolbar: showToolbar,
    hideToolbar: hideToolbar,
    openCard: openCard,
    closeCard: closeCard,
    isCardOpen: isCardOpen,
    toast: toast,
    setTheme: setTheme,
    refreshI18n: refreshI18n,
    setBlankClickHandler: setBlankClickHandler
  };
})(typeof self !== 'undefined' ? self : globalThis);
