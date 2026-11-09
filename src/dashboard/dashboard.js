(function () {
  'use strict';

  const WN = window.WN;
  const M = WN.model;
  const t = (key, params) => WN.i18n.t(key, params);
  const $ = (id) => document.getElementById(id);

  const state = {
    snapshot: null,
    search: '',
    activeTag: null,
    expanded: new Set(),
    expandedCards: new Set(),
    sort: 'updated'
  };

  // ================================================================ 工具

  function colorHex(id) {
    const found = M.COLORS.find((c) => c.id === id);
    return found ? found.hex : '#4b93f7';
  }

  function toast(message, isError) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('err', !!isError);
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 2100);
  }

  function totalCounts() {
    const pages = Object.values(state.snapshot.pages);
    const annotations = pages.reduce((sum, p) => sum + p.annotations.length, 0);
    return { pages: pages.length, annotations: annotations };
  }

  function computeTagCounts() {
    const counts = new Map();
    const tags = state.snapshot.tags;
    Object.values(state.snapshot.pages).forEach((page) => {
      const seen = new Set();
      page.tagIds.forEach((id) => {
        let cursor = M.getTag(tags, id);
        let guard = 0;
        while (cursor && guard++ < 64) {
          seen.add(cursor.id);
          cursor = cursor.parentId ? M.getTag(tags, cursor.parentId) : null;
        }
      });
      seen.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });
    return counts;
  }

  // ================================================================ 渲染：侧栏

  function isActiveTag(id) {
    if (id === '__all__') return state.activeTag === null;
    return state.activeTag === id;
  }

  function createTreeRow(opts) {
    const row = document.createElement('div');
    row.className = 'tag-row' + (isActiveTag(opts.id) ? ' active' : '');
    row.dataset.id = opts.id;
    row.style.paddingLeft = 8 + opts.depth * 14 + 'px';

    const caret = document.createElement('span');
    caret.className = 'caret';
    if (opts.hasChildren) {
      caret.textContent = '▶';
      if (state.expanded.has(opts.id)) caret.classList.add('open');
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.expanded.has(opts.id)) state.expanded.delete(opts.id);
        else state.expanded.add(opts.id);
        renderTree();
      });
    } else {
      caret.classList.add('hidden-caret');
    }

    const dot = document.createElement('span');
    dot.className = 'dot';
    if (opts.color) dot.style.background = opts.color;
    else dot.style.display = 'none';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = opts.name;
    name.title = opts.name;

    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = String(opts.count);

    const ops = document.createElement('div');
    ops.className = 'row-ops';

    if (opts.tag) {
      const add = document.createElement('button');
      add.textContent = '＋';
      add.title = t('dash.newSubTag');
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        openTagModal({ parentId: opts.tag.id });
      });

      const rename = document.createElement('button');
      rename.textContent = '✎';
      rename.title = t('dash.editTag');
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        openTagModal({ tag: opts.tag });
      });

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '×';
      del.title = t('dash.deleteTag');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTag(opts.tag);
      });

      ops.append(add, rename, del);
    }

    row.append(caret, dot, name, cnt, ops);
    row.addEventListener('click', () => {
      state.activeTag = opts.id === '__all__' ? null : opts.id;
      render();
    });

    return row;
  }

  function renderTree() {
    const tree = $('tree');
    tree.textContent = '';

    const counts = computeTagCounts();
    const pages = Object.values(state.snapshot.pages);
    const untagged = pages.filter((p) => p.tagIds.length === 0).length;

    tree.appendChild(
      createTreeRow({ id: '__all__', name: t('dash.allPages'), count: pages.length, depth: 0, hasChildren: false })
    );
    tree.appendChild(
      createTreeRow({ id: 'untagged', name: t('dash.untagged'), count: untagged, depth: 0, hasChildren: false })
    );

    const tags = state.snapshot.tags;
    if (tags.length) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--line);margin:8px 10px;';
      tree.appendChild(sep);
    }

    // 首次渲染时展开有子标签的根节点，让层级结构一眼可见
    if (!state._expandedInit) {
      state._expandedInit = true;
      M.childrenOf(tags, null).forEach((tag) => {
        if (M.childrenOf(tags, tag.id).length) state.expanded.add(tag.id);
      });
    }

    const walk = (parentId, depth) => {
      M.childrenOf(tags, parentId).forEach((tag) => {
        const kids = M.childrenOf(tags, tag.id);
        tree.appendChild(
          createTreeRow({
            id: tag.id,
            name: tag.name,
            count: counts.get(tag.id) || 0,
            depth: depth,
            hasChildren: kids.length > 0,
            color: colorHex(tag.color),
            tag: tag
          })
        );
        if (kids.length && state.expanded.has(tag.id)) walk(tag.id, depth + 1);
      });
    };
    walk(null, 0);
  }

  function renderStats() {
    const totals = totalCounts();
    const el = $('sideStats');
    el.innerHTML = '';
    const line = document.createElement('div');
    line.innerHTML = t('dash.summary', {
      pages: '<b>' + totals.pages + '</b>',
      notes: '<b>' + totals.annotations + '</b>'
    });
    el.appendChild(line);
  }

  // ================================================================ 渲染：主区

  function filterPages() {
    const tags = state.snapshot.tags;
    let list = Object.values(state.snapshot.pages);

    if (state.activeTag === 'untagged') {
      list = list.filter((p) => p.tagIds.length === 0);
    } else if (state.activeTag) {
      const ids = new Set(M.tagSubtreeIds(tags, state.activeTag));
      list = list.filter((p) => p.tagIds.some((id) => ids.has(id)));
    }

    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        if ((p.title || '').toLowerCase().indexOf(q) >= 0) return true;
        if (p.url.toLowerCase().indexOf(q) >= 0) return true;
        return p.annotations.some(
          (a) =>
            (a.quote || '').toLowerCase().indexOf(q) >= 0 || (a.note || '').toLowerCase().indexOf(q) >= 0
        );
      });
    }

    const sort = state.sort;
    list.sort((a, b) => {
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '', 'zh-CN');
      if (sort === 'created') return b.createdAt - a.createdAt;
      if (sort === 'count') return b.annotations.length - a.annotations.length || b.updatedAt - a.updatedAt;
      return b.updatedAt - a.updatedAt;
    });

    return list;
  }

  function renderHeader(pages) {
    const tag = state.activeTag && state.activeTag !== 'untagged' ? M.getTag(state.snapshot.tags, state.activeTag) : null;
    let title = t('dash.allPages');
    if (state.activeTag === 'untagged') title = t('dash.untagged');
    else if (tag) title = tag.name;

    $('viewTitle').textContent = title;

    const annotations = pages.reduce((sum, p) => sum + p.annotations.length, 0);
    const parts = [];
    parts.push(t('dash.pagesCount', { n: pages.length }));
    if (annotations) parts.push(t('dash.notesCount', { n: annotations }));
    if (state.search.trim()) parts.push(t('dash.searching', { q: state.search.trim() }));
    $('viewSub').textContent = parts.join(' · ');
  }

  function createFavicon(page) {
    const fallback = () => {
      const el = document.createElement('div');
      el.className = 'favicon-fallback';
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
      return el;
    };

    if (!page.favicon) return fallback();

    const img = document.createElement('img');
    img.className = 'favicon';
    img.alt = '';
    img.src = page.favicon;
    img.addEventListener(
      'error',
      () => {
        if (img.parentNode) img.parentNode.replaceChild(fallback(), img);
      },
      { once: true }
    );
    return img;
  }

  function createCard(page) {
    const card = document.createElement('article');
    card.className = 'card';

    // ---- head
    const head = document.createElement('div');
    head.className = 'card-head';

    head.appendChild(createFavicon(page));

    const titleWrap = document.createElement('div');
    titleWrap.className = 'card-title';

    const h2 = document.createElement('h2');
    const link = document.createElement('a');
    link.href = page.url;
    link.textContent = page.title || page.url;
    link.title = page.title;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openPage(page.url, null);
    });
    h2.appendChild(link);

    const urlLine = document.createElement('div');
    urlLine.className = 'card-url';
    urlLine.textContent = page.url.replace(/^https?:\/\//, '');
    urlLine.title = page.url;

    titleWrap.append(h2, urlLine);

    const stats = document.createElement('div');
    stats.className = 'card-stats';
    stats.innerHTML =
      t('dash.annCount', { n: '<b>' + page.annotations.length + '</b>' }) +
      '<br>' +
      WN.util.relativeTime(page.updatedAt);

    head.append(titleWrap, stats);
    card.appendChild(head);

    // ---- tags
    const tags = page.tagIds.map((id) => M.getTag(state.snapshot.tags, id)).filter(Boolean);
    if (tags.length) {
      const tagRow = document.createElement('div');
      tagRow.className = 'card-tags';
      tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorHex(tag.color);
        chip.append(dot, document.createTextNode(tag.name));
        tagRow.appendChild(chip);
      });
      card.appendChild(tagRow);
    }

    // ---- annotations
    if (page.annotations.length) {
      const annList = document.createElement('div');
      annList.className = 'ann-list';

      const expanded = state.expandedCards.has(page.url);
      const limit = expanded ? page.annotations.length : 4;
      const sorted = page.annotations.slice().sort((a, b) => a.start - b.start);

      sorted.slice(0, limit).forEach((ann) => {
        annList.appendChild(createAnnRow(page, ann));
      });

      if (sorted.length > limit) {
        const more = document.createElement('button');
        more.className = 'ann-more';
        more.textContent = t('dash.expandRest', { n: sorted.length - limit });
        more.addEventListener('click', () => {
          state.expandedCards.add(page.url);
          renderContents();
        });
        annList.appendChild(more);
      } else if (expanded && sorted.length > 4) {
        const less = document.createElement('button');
        less.className = 'ann-more';
        less.textContent = t('dash.collapse');
        less.addEventListener('click', () => {
          state.expandedCards.delete(page.url);
          renderContents();
        });
        annList.appendChild(less);
      }

      card.appendChild(annList);
    }

    // ---- footer
    const foot = document.createElement('div');
    foot.className = 'card-foot';

    const openBtn = document.createElement('button');
    openBtn.className = 'mini-btn';
    openBtn.dataset.act = 'open';
    openBtn.textContent = t('dash.openOriginal');
    openBtn.addEventListener('click', () => openPage(page.url, null));

    const tagBtn = document.createElement('button');
    tagBtn.className = 'mini-btn';
    tagBtn.dataset.act = 'tags';
    tagBtn.textContent = t('dash.editTags');
    tagBtn.addEventListener('click', () => openPageTagsModal(page));

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn danger';
    delBtn.dataset.act = 'delete';
    delBtn.textContent = t('dash.delete');
    delBtn.addEventListener('click', () => removePage(page));

    foot.append(openBtn, tagBtn);

    if (page.snapshot) {
      const snapBtn = document.createElement('button');
      snapBtn.className = 'mini-btn';
      snapBtn.dataset.act = 'snapshot';
      snapBtn.textContent = t('dash.snapshot');
      snapBtn.title = t('dash.snapshotTitle');
      snapBtn.addEventListener('click', () => openSnapshotModal(page));
      foot.append(snapBtn);
    }

    foot.append(delBtn);
    card.appendChild(foot);

    return card;
  }

  function createAnnRow(page, ann) {
    const row = document.createElement('div');
    row.className = 'ann';
    row.title = t('dash.locateHint');

    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.background = colorHex(ann.color);

    const body = document.createElement('div');
    body.className = 'ann-body';

    const quote = document.createElement('div');
    quote.className = 'ann-q';
    quote.textContent = ann.quote;
    body.appendChild(quote);

    if (ann.note) {
      const note = document.createElement('div');
      note.className = 'ann-n';
      note.textContent = ann.note;
      body.appendChild(note);
    }

    row.append(bar, body);
    row.addEventListener('click', () => openPage(page.url, ann.id));
    return row;
  }

  function renderContents() {
    const contents = $('contents');
    contents.textContent = '';

    const pages = filterPages();
    renderHeader(pages);

    if (!pages.length) {
      contents.appendChild(createEmptyState());
      return;
    }

    const list = document.createElement('div');
    list.className = 'card-list';
    pages.forEach((page) => list.appendChild(createCard(page)));
    contents.appendChild(list);
  }

  function createEmptyState() {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const totals = totalCounts();
    const searching = !!state.search.trim();

    if (searching) {
      wrap.innerHTML =
        '<div class="big">⌕</div><h2>' + t('dash.empty.searchTitle') + '</h2><p>' +
        t('dash.empty.searchDesc') + '</p>';
      return wrap;
    }

    if (state.activeTag) {
      wrap.innerHTML =
        '<div class="big">◇</div><h2>' + t('dash.empty.tagTitle') + '</h2><p>' +
        t('dash.empty.tagDesc') + '</p>';
      return wrap;
    }

    if (!totals.pages) {
      wrap.innerHTML =
        '<div class="big">✎</div><h2>' + t('dash.empty.firstTitle') + '</h2><p>' +
        t('dash.empty.firstDesc') + '</p>';
      return wrap;
    }

    wrap.innerHTML =
      '<div class="big">◇</div><h2>' + t('dash.empty.genericTitle') + '</h2><p>' +
      t('dash.empty.genericDesc') + '</p>';
    return wrap;
  }

  function render() {
    if (!state.snapshot) return;
    renderTree();
    renderStats();
    renderContents();
  }

  // ================================================================ 操作

  async function openPage(url, annId) {
    if (!chrome.tabs) {
      window.open(url, '_blank');
      return;
    }
    let tabId = null;
    try {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find((t) => t.url === url);
      if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
        tabId = existing.id;
      } else {
        const created = await chrome.tabs.create({ url: url, active: true });
        tabId = created.id;
      }
    } catch (err) {
      window.open(url, '_blank');
      return;
    }

    if (!annId || !tabId) return;

    let tries = 0;
    const attempt = () => {
      tries += 1;
      chrome.tabs
        .sendMessage(tabId, { type: 'WN_FOCUS_ANNOTATION', id: annId })
        .then(() => undefined)
        .catch(() => {
          if (tries < 4) setTimeout(attempt, 1200);
        });
    };
    setTimeout(attempt, 1000);
  }

  async function removePage(page) {
    const ok = await confirmDialog({
      title: t('page.deleteTitle'),
      desc: t('page.deleteDesc', { title: page.title || page.url, n: page.annotations.length }),
      confirmText: t('page.deleteConfirm'),
      danger: true
    });
    if (!ok) return;
    await WN.store.mutate('deletePage', { url: page.url });
    state.expandedCards.delete(page.url);
    await refresh();
    toast(t('page.deleted'));
  }

  async function removeTag(tag) {
    const count = Object.values(state.snapshot.pages).filter((p) => p.tagIds.indexOf(tag.id) >= 0).length;
    const ok = await confirmDialog({
      title: t('tag.deleteTitle', { name: tag.name }),
      desc:
        t('tag.deleteDesc', { n: count }),
      confirmText: t('tag.deleteConfirm'),
      danger: true
    });
    if (!ok) return;
    await WN.store.mutate('deleteTag', { id: tag.id });
    if (state.activeTag === tag.id) state.activeTag = null;
    state.expanded.delete(tag.id);
    await refresh();
    toast(t('tag.deleted'));
  }

  // ================================================================ 模态框

  function showModal(build) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const modal = document.createElement('div');
    modal.className = 'modal';
    mask.appendChild(modal);
    $('modalRoot').appendChild(mask);

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      mask.remove();
    };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close();
    });

    build(modal, close);
    const focusable = modal.querySelector('input, textarea, select');
    if (focusable) setTimeout(() => focusable.focus(), 40);
    return close;
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      showModal((modal, close) => {
        modal.innerHTML =
          '<h3></h3><div class="desc"></div>' +
          '<div class="modal-actions">' +
          '<button class="btn" data-act="cancel">' + t('modal.cancel') + '</button>' +
          '<button class="btn ' +
          (opts.danger ? 'danger' : 'primary') +
          '" data-act="ok"></button>' +
          '</div>';
        modal.querySelector('h3').textContent = opts.title || t('modal.confirm');
        modal.querySelector('.desc').textContent = opts.desc || '';
        const okBtn = modal.querySelector('[data-act="ok"]');
        okBtn.textContent = opts.confirmText || t('modal.confirm');
        modal.querySelector('[data-act="cancel"]').addEventListener('click', () => {
          close();
          resolve(false);
        });
        okBtn.addEventListener('click', () => {
          close();
          resolve(true);
        });
      });
    });
  }

  function openTagModal(opts) {
    const options = opts || {};
    const editing = options.tag || null;

    showModal((modal, close) => {
      modal.innerHTML =
        '<h3>' + (editing ? t('tag.edit') : t('tag.new')) + '</h3>' +
        '<div class="field"><label>' + t('tag.name') + '</label>' +
        '<input class="input" data-el="name" placeholder="' + t('tag.namePlaceholder') + '" maxlength="60"></div>' +
        '<div class="field"><label>' + t('tag.parent') + '</label><select class="input" data-el="parent"></select></div>' +
        '<div class="field"><label>' + t('tag.color') + '</label><div class="color-row" data-el="colors"></div></div>' +
        '<div class="modal-actions">' +
        '<button class="btn" data-act="cancel">' + t('modal.cancel') + '</button>' +
        '<button class="btn primary" data-act="ok">' + (editing ? t('modal.save') : t('modal.create')) + '</button>' +
        '</div>';

      const nameInput = modal.querySelector('[data-el="name"]');
      const parentSelect = modal.querySelector('[data-el="parent"]');
      const colorRow = modal.querySelector('[data-el="colors"]');

      let pickedColor = editing
        ? editing.color
        : M.TAG_PALETTE[state.snapshot.tags.length % M.TAG_PALETTE.length];
      let pickedParent = editing ? editing.parentId || '' : options.parentId || '';

      nameInput.value = editing ? editing.name : '';

      // 父标签选项：排除自己与自己的子树
      const banned = new Set(editing ? M.tagSubtreeIds(state.snapshot.tags, editing.id) : []);
      const base = document.createElement('option');
      base.value = '';
      base.textContent = t('tag.parentNone');
      parentSelect.appendChild(base);

      const walk = (parentId, depth) => {
        M.childrenOf(state.snapshot.tags, parentId).forEach((tag) => {
          if (!banned.has(tag.id)) {
            const opt = document.createElement('option');
            opt.value = tag.id;
            opt.textContent = '\u00a0\u00a0'.repeat(depth) + tag.name;
            parentSelect.appendChild(opt);
          }
          walk(tag.id, depth + 1);
        });
      };
      walk(null, 0);
      parentSelect.value = pickedParent;

      M.COLORS.forEach((color) => {
        const dot = document.createElement('button');
        dot.className = 'color-dot' + (color.id === pickedColor ? ' active' : '');
        dot.style.background = color.hex;
        dot.title = color.label;
        dot.addEventListener('click', () => {
          pickedColor = color.id;
          Array.from(colorRow.children).forEach((c) => c.classList.remove('active'));
          dot.classList.add('active');
        });
        colorRow.appendChild(dot);
      });

      const submit = async () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        const parentId = parentSelect.value || null;
        try {
          if (editing) {
            await WN.store.mutate('updateTag', {
              id: editing.id,
              name: name,
              parentId: parentId,
              color: pickedColor
            });
            toast(t('tag.updated'));
          } else {
            await WN.store.mutate('addTag', { name: name, parentId: parentId, color: pickedColor });
            toast(t('tag.created'));
          }
          if (parentId) state.expanded.add(parentId);
          close();
          await refresh();
        } catch (err) {
          toast((err && err.message) || t('error.operationFailed'), true);
        }
      };

      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
      modal.querySelector('[data-act="ok"]').addEventListener('click', submit);
    });
  }

  function openSnapshotModal(page) {
    showModal((modal, close) => {
      modal.classList.add('wide');
      modal.innerHTML =
        '<h3>' + t('snapshot.title') + '</h3>' +
        '<div class="desc" data-el="desc"></div>' +
        '<div class="snapshot" data-el="body"></div>' +
        '<div class="modal-actions">' +
        '<button class="btn" data-act="copy">' + t('snapshot.copy') + '</button>' +
        '<button class="btn primary" data-act="close">' + t('card.close') + '</button>' +
        '</div>';

      const text = page.snapshot || '';
      modal.querySelector('[data-el="desc"]').textContent =
        t('snapshot.meta', {
          title: page.title || page.url,
          n: Math.max(1, Math.round(text.length / 1000))
        });
      modal.querySelector('[data-el="body"]').textContent = text;

      modal.querySelector('[data-act="close"]').addEventListener('click', close);
      modal.querySelector('[data-act="copy"]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast(t('snapshot.copied'));
        } catch (err) {
          toast(t('error.copyFailed'), true);
        }
      });
    });
  }

  function openPageTagsModal(page) {
    showModal((modal, close) => {
      modal.innerHTML =
        '<h3>' + t('tags.title') + '</h3>' +
        '<div class="desc" data-el="desc"></div>' +
        '<div class="tag-picker" data-el="picker"></div>' +
        '<div class="modal-actions">' +
        '<button class="btn" data-act="new">' + t('dash.newTag') + '</button>' +
        '<button class="btn" data-act="cancel">' + t('modal.cancel') + '</button>' +
        '<button class="btn primary" data-act="ok">' + t('modal.save') + '</button>' +
        '</div>';

      modal.querySelector('[data-el="desc"]').textContent = page.title || page.url;

      const picker = modal.querySelector('[data-el="picker"]');
      const selected = new Set(page.tagIds);
      const tags = state.snapshot.tags;

      if (!tags.length) {
        picker.innerHTML = '<div class="tag-pick-empty">' + t('tags.empty') + '</div>';
      } else {
        const walk = (parentId, depth) => {
          M.childrenOf(tags, parentId).forEach((tag) => {
            const row = document.createElement('label');
            row.className = 'tag-pick-row' + (selected.has(tag.id) ? ' checked' : '');
            row.style.paddingLeft = 8 + depth * 16 + 'px';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = selected.has(tag.id);
            input.addEventListener('change', () => {
              if (input.checked) selected.add(tag.id);
              else selected.delete(tag.id);
              row.classList.toggle('checked', input.checked);
            });

            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.style.background = colorHex(tag.color);

            const label = document.createElement('span');
            label.textContent = tag.name;

            row.append(input, dot, label);
            picker.appendChild(row);
            walk(tag.id, depth + 1);
          });
        };
        walk(null, 0);
      }

      modal.querySelector('[data-act="new"]').addEventListener('click', () => {
        close();
        openTagModal({});
      });

      modal.querySelector('[data-act="cancel"]').addEventListener('click', close);

      modal.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          await WN.store.mutate('setPageTags', {
            url: page.url,
            title: page.title,
            favicon: page.favicon,
            tagIds: Array.from(selected)
          });
          close();
          await refresh();
          toast(t('tags.saved'));
        } catch (err) {
          toast((err && err.message) || t('error.saveFailed'), true);
        }
      });
    });
  }

  function openSettingsModal() {
    const settings = state.snapshot.settings;

    showModal((modal, close) => {
      const localeOptions = WN.i18n.LOCALES.map((item) => {
        const label = item.id === 'auto' ? t('settings.languageAuto') : item.label;
        return '<option value="' + item.id + '">' + label + '</option>';
      }).join('');

      modal.innerHTML =
        '<h3>' + t('settings.title') + '</h3>' +
        '<div class="desc">' + t('settings.desc') + '</div>' +
        '<div class="switch-row">' +
        '<div><div class="label">' + t('settings.enabled') + '</div><div class="hint">' +
        t('settings.enabledHint') + '</div></div>' +
        '<label class="mini-switch"><input type="checkbox" data-el="enabled"><span class="track"></span></label>' +
        '</div>' +
        '<div class="switch-row">' +
        '<div><div class="label">' + t('settings.toolbar') + '</div><div class="hint">' +
        t('settings.toolbarHint') + '</div></div>' +
        '<label class="mini-switch"><input type="checkbox" data-el="toolbar"><span class="track"></span></label>' +
        '</div>' +
        '<div class="switch-row">' +
        '<div><div class="label">' + t('settings.snapshot') + '</div><div class="hint">' +
        t('settings.snapshotHint') + '</div></div>' +
        '<label class="mini-switch"><input type="checkbox" data-el="snapshot"><span class="track"></span></label>' +
        '</div>' +
        '<div class="field" style="margin-top:16px"><label>' + t('settings.language') + '</label>' +
        '<select class="input" data-el="locale">' + localeOptions + '</select>' +
        '<div class="hint" style="margin-top:5px">' + t('settings.languageHint') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><label>' + t('settings.defaultColor') +
        '</label><div class="color-row" data-el="colors"></div></div>' +
        '<div class="modal-actions" style="justify-content:space-between">' +
        '<button class="btn danger" data-act="clear">' + t('settings.clear') + '</button>' +
        '<button class="btn primary" data-act="ok">' + t('modal.done') + '</button>' +
        '</div>';

      const enabled = modal.querySelector('[data-el="enabled"]');
      const toolbar = modal.querySelector('[data-el="toolbar"]');
      const snapshotSwitch = modal.querySelector('[data-el="snapshot"]');
      const localeSelect = modal.querySelector('[data-el="locale"]');
      enabled.checked = settings.enabled !== false;
      toolbar.checked = settings.showToolbar !== false;
      snapshotSwitch.checked = settings.saveSnapshot !== false;
      localeSelect.value = settings.locale || 'auto';

      let pickedColor = settings.defaultColor || 'yellow';
      const colorRow = modal.querySelector('[data-el="colors"]');
      M.COLORS.forEach((color) => {
        const dot = document.createElement('button');
        dot.className = 'color-dot' + (color.id === pickedColor ? ' active' : '');
        dot.style.background = color.hex;
        dot.title = t('color.' + color.id);
        dot.addEventListener('click', () => {
          pickedColor = color.id;
          Array.from(colorRow.children).forEach((c) => c.classList.remove('active'));
          dot.classList.add('active');
        });
        colorRow.appendChild(dot);
      });

      const save = async () => {
        try {
          await WN.store.mutate('updateSettings', {
            patch: {
              enabled: enabled.checked,
              showToolbar: toolbar.checked,
              saveSnapshot: snapshotSwitch.checked,
              defaultColor: pickedColor,
              locale: localeSelect.value
            }
          });
          await refresh();
          toast(t('settings.saved'));
        } catch (err) {
          toast((err && err.message) || t('error.saveFailed'), true);
        }
      };

      modal.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        await save();
        close();
      });

      modal.querySelector('[data-act="clear"]').addEventListener('click', async () => {
        close();
        const ok = await confirmDialog({
          title: t('settings.clearTitle'),
          desc: t('settings.clearDesc'),
          confirmText: t('settings.clearConfirm'),
          danger: true
        });
        if (!ok) return;
        await WN.store.mutate('clearAll', {});
        state.activeTag = null;
        state.expandedCards.clear();
        await refresh();
        toast(t('settings.cleared'));
      });
    });
  }

  // ================================================================ 导入导出

  async function exportBackup() {
    const payload = {
      app: 'webnote',
      version: M.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      pages: state.snapshot.pages,
      tags: state.snapshot.tags,
      settings: state.snapshot.settings
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'webnote-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t('export.done'));
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.pages) {
        throw new Error(t('import.badFormat'));
      }
      const res = await WN.store.mutate('importMerge', { state: parsed });
      await refresh();
      toast(t('import.done', { n: res.pages || 0 }));
    } catch (err) {
      toast((err && err.message) || t('import.failed'), true);
    }
  }

  // ================================================================ 刷新

  async function refresh() {
    state.snapshot = await WN.store.readState();
    WN.i18n.setLocale(state.snapshot.settings.locale);
    WN.i18n.applyI18n(document);
    if (state.activeTag && state.activeTag !== 'untagged' && !M.getTag(state.snapshot.tags, state.activeTag)) {
      state.activeTag = null;
    }
    render();
  }

  // ================================================================ 绑定

  function bind() {
    const search = $('search');
    const onSearch = WN.util.debounce(() => {
      state.search = search.value;
      renderContents();
    }, 220);
    search.addEventListener('input', onSearch);

    $('sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderContents();
    });

    $('btnNewTag').addEventListener('click', () => openTagModal({}));
    $('btnExport').addEventListener('click', exportBackup);
    $('btnImport').addEventListener('click', () => $('fileInput').click());
    $('btnSettings').addEventListener('click', openSettingsModal);

    $('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) await importBackup(file);
    });

    WN.store.watch(() => {
      refresh();
    });
  }

  // ================================================================ 启动

  async function init() {
    state.snapshot = await WN.store.readState();
    WN.i18n.setLocale(state.snapshot.settings.locale);
    WN.i18n.applyI18n(document);
    bind();
    render();
  }

  init();
})();
