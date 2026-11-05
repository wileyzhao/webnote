(function () {
  'use strict';

  const WN = window.WN;
  const M = WN.model;

  const $ = (id) => document.getElementById(id);

  let tab = null;
  let snapshot = null;
  let pageUrl = '';
  let host = '';
  let injectable = false;
  let contentReady = false;

  function colorHex(id) {
    const found = M.COLORS.find((c) => c.id === id);
    return found ? found.hex : '#f2c33d';
  }

  function showHint(text) {
    const el = $('hint');
    if (!text) {
      el.hidden = true;
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  function relay(message) {
    if (!tab || typeof tab.id !== 'number') return;
    try {
      chrome.runtime.sendMessage({ type: 'WN_RELAY', tabId: tab.id, message: message });
    } catch (err) {
      /* 忽略 */
    }
  }

  // ---------------------------------------------------------------- 渲染

  function render() {
    const settings = snapshot.settings;
    const page = pageUrl ? snapshot.pages[pageUrl] : null;
    const annotations = page ? page.annotations.slice().sort((a, b) => a.start - b.start) : [];

    $('toggleEnabled').checked = settings.enabled;

    $('pageTitle').textContent = injectable ? tab.title || pageUrl : '当前页面不可标注';
    $('pageUrl').textContent = tab && tab.url ? tab.url : '';
    $('countText').textContent = annotations.length ? annotations.length + ' 条标注' : '尚未标注';

    const siteOff = settings.disabledHosts.indexOf(host) >= 0;
    $('btnSiteToggle').textContent = siteOff ? '本站启用' : '本站禁用';
    $('btnSiteToggle').disabled = !injectable;
    $('btnSave').disabled = !injectable || !settings.enabled;

    $('statusText').textContent = !settings.enabled
      ? '已全局关闭'
      : siteOff
      ? '本站已暂停'
      : '本地高亮与批注';

    renderList(annotations, page);
  }

  function renderList(annotations, page) {
    const list = $('list');
    const empty = $('empty');
    list.textContent = '';

    if (!annotations.length) {
      empty.hidden = false;
      empty.querySelector('.empty-sub').textContent = injectable
        ? '在网页上选中文字，即可高亮或写批注'
        : '请打开一个普通网页后再使用';
      return;
    }
    empty.hidden = true;

    const tagNames = (page && page.tagIds ? page.tagIds : [])
      .map((id) => M.getTag(snapshot.tags, id))
      .filter(Boolean);

    annotations.forEach((ann) => {
      const li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = ann.id;

      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.background = colorHex(ann.color);

      const body = document.createElement('div');
      body.className = 'body';

      const quote = document.createElement('div');
      quote.className = 'q';
      quote.textContent = ann.quote;
      body.appendChild(quote);

      if (ann.note) {
        const note = document.createElement('div');
        note.className = 'n';
        note.textContent = ann.note;
        body.appendChild(note);
      }

      const time = document.createElement('div');
      time.className = 't';
      time.textContent = WN.util.relativeTime(ann.updatedAt || ann.createdAt);
      body.appendChild(time);

      if (tagNames.length) {
        const tags = document.createElement('div');
        tags.className = 'tag';
        tagNames.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className = 'mini-tag';
          chip.textContent = tag.name;
          tags.appendChild(chip);
        });
        body.appendChild(tags);
      }

      li.appendChild(bar);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- 动作

  async function toggleGlobal(enabled) {
    try {
      await WN.store.mutate('updateSettings', { patch: { enabled: enabled } });
      snapshot = await WN.store.readState();
      render();
      relay({ type: 'WN_OPEN_SETTINGS' });
    } catch (err) {
      showHint((err && err.message) || '操作失败');
      $('toggleEnabled').checked = !enabled;
    }
  }

  async function toggleSite() {
    if (!host) return;
    const list = snapshot.settings.disabledHosts.slice();
    const idx = list.indexOf(host);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(host);

    try {
      await WN.store.mutate('updateSettings', { patch: { disabledHosts: list } });
      snapshot = await WN.store.readState();
      render();
      relay({ type: 'WN_OPEN_SETTINGS' });
    } catch (err) {
      showHint((err && err.message) || '操作失败');
    }
  }

  async function saveCurrentPage() {
    if (!tab || !injectable) return;

    // 优先让页面侧保存：这样能顺带抓一份正文快照
    if (contentReady) {
      try {
        await chrome.runtime.sendMessage({
          type: 'WN_RELAY',
          tabId: tab.id,
          message: { type: 'WN_SAVE_PAGE' }
        });
        snapshot = await WN.store.readState();
        render();
        flashSaved();
        return;
      } catch (err) {
        /* 落到下面直接写存储 */
      }
    }

    try {
      await WN.store.mutate('savePage', {
        url: tab.url,
        title: tab.title || tab.url,
        favicon: tab.favIconUrl || ''
      });
      snapshot = await WN.store.readState();
      render();
      flashSaved();
    } catch (err) {
      showHint((err && err.message) || '保存失败');
    }
  }

  function flashSaved() {
    const btn = $('btnSave');
    btn.textContent = '已保存';
    setTimeout(() => {
      btn.textContent = '保存本页';
    }, 1600);
  }

  // ---------------------------------------------------------------- 绑定

  function bind() {
    $('toggleEnabled').addEventListener('change', (e) => toggleGlobal(e.target.checked));
    $('btnSiteToggle').addEventListener('click', toggleSite);
    $('btnSave').addEventListener('click', saveCurrentPage);

    $('btnDashboard').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'WN_OPEN_DASHBOARD' });
      window.close();
    });

    $('list').addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      if (!contentReady) {
        showHint('页面尚未就绪，请刷新网页后再试');
        return;
      }
      relay({ type: 'WN_FOCUS_ANNOTATION', id: item.dataset.id });
      window.close();
    });
  }

  // ---------------------------------------------------------------- 启动

  async function init() {
    tab = await WN.store.getActiveTab();
    snapshot = await WN.store.readState();

    if (tab && tab.url) {
      pageUrl = M.normalizeUrl(tab.url);
      try {
        host = new URL(tab.url).hostname;
      } catch (err) {
        host = '';
      }
      injectable = WN.store.isInjectableUrl(tab.url);
    }

    render();
    bind();

    if (injectable && tab) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'WN_PING' });
        contentReady = !!(res && res.ok);
      } catch (err) {
        contentReady = false;
      }
      if (!contentReady) {
        showHint('这个页面还没加载 WebNote 脚本，刷新一次网页即可使用');
      }
    }
  }

  WN.store.watch(() => {
    WN.store.readState().then((next) => {
      snapshot = next;
      render();
    });
  });

  init();
})();
