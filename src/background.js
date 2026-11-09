/*
 * WebNote — 后台服务
 * 1) 串行化所有写操作，避免多标签页并发覆盖
 * 2) 右键菜单 / 快捷键
 * 3) 给已打开的标签页补注入 content script
 */
importScripts('shared/i18n.js', 'shared/model.js', 'shared/store.js');

const M = self.WN.model;
function t(key, params) {
  return self.WN.i18n.t(key, params);
}

const MENU = {
  SAVE: 'wn-save-page',
  ANNOTATE: 'wn-annotate',
  NOTE: 'wn-annotate-note',
  COLOR: 'wn-color-',
  DASH: 'wn-open-dashboard'
};

const CONTENT_FILES = [
  'src/shared/i18n.js',
  'src/shared/model.js',
  'src/shared/store.js',
  'src/content/anchor.js',
  'src/content/highlight.js',
  'src/content/ui.js',
  'src/content/content.js'
];

// ------------------------------------------------------------------ 写入队列

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function applyMutation(op, payload) {
  const stored = await chrome.storage.local.get(M.STORAGE_KEY);
  const state = M.normalizeState(stored[M.STORAGE_KEY]);
  let extra;

  if (op === 'importMerge') {
    extra = M.mergeState(state, payload && payload.state);
  } else {
    extra = M.mutate(state, op, payload);
  }

  await chrome.storage.local.set({ [M.STORAGE_KEY]: state });
  return Object.assign({ ok: true }, extra || {});
}

// ------------------------------------------------------------------ 右键菜单

async function buildMenus() {
  const stored = await chrome.storage.local.get(M.STORAGE_KEY);
  const state = M.normalizeState(stored[M.STORAGE_KEY]);
  self.WN.i18n.setLocale(state.settings.locale);

  await new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU.SAVE,
        title: t('menu.savePage'),
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: MENU.ANNOTATE,
        title: t('menu.annotate'),
        contexts: ['selection']
      });

      M.COLORS.forEach((color) => {
        chrome.contextMenus.create({
          id: MENU.COLOR + color.id,
          parentId: MENU.ANNOTATE,
          title: t('color.highlight', { color: t('color.' + color.id) }),
          contexts: ['selection']
        });
      });

      chrome.contextMenus.create({
        id: 'wn-sep-1',
        parentId: MENU.ANNOTATE,
        type: 'separator',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: MENU.NOTE,
        parentId: MENU.ANNOTATE,
        title: t('menu.note'),
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'wn-sep-2',
        type: 'separator',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: MENU.DASH,
        title: t('menu.dashboard'),
        contexts: ['page']
      });

      resolve();
    });
  });
}

// ------------------------------------------------------------------ 注入保障

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'WN_PING' });
    return !!(res && res.ok);
  } catch (err) {
    return false;
  }
}

async function ensureContentScript(tab) {
  if (!tab || typeof tab.id !== 'number') return false;
  if (!/^https?:\/\//i.test(tab.url || '')) return false;
  if (await ping(tab.id)) return true;

  if (!chrome.scripting) return false;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    return await ping(tab.id);
  } catch (err) {
    console.warn('[WebNote] 注入脚本失败', err);
    return false;
  }
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    return null;
  }
}

async function openDashboard() {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const tabs = await chrome.tabs.query({ url: url });
  if (tabs && tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: url });
}

// ------------------------------------------------------------------ 事件绑定

chrome.runtime.onInstalled.addListener(async (details) => {
  buildMenus();

  const stored = await chrome.storage.local.get(M.STORAGE_KEY);
  if (!stored[M.STORAGE_KEY]) {
    await chrome.storage.local.set({ [M.STORAGE_KEY]: M.emptyState() });
  }

  // 让已经打开的网页立刻可用，避免用户以为没生效
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    ensureContentScript(tab);
  }

  if (details.reason === 'install') {
    openDashboard();
  }
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
});

// 用户切换界面语言后，右键菜单需要重建
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[M.STORAGE_KEY]) return;
  const next = M.normalizeState(changes[M.STORAGE_KEY].newValue);
  if (self.WN.i18n.getLocale() !== self.WN.i18n.resolve(next.settings.locale)) {
    buildMenus();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId || '');

  if (id === MENU.DASH) {
    openDashboard();
    return;
  }

  if (!tab || typeof tab.id !== 'number') return;
  const ready = await ensureContentScript(tab);
  if (!ready) return;

  if (id === MENU.SAVE) {
    await sendToTab(tab.id, { type: 'WN_SAVE_PAGE' });
    return;
  }

  if (id.indexOf(MENU.COLOR) === 0) {
    const color = id.slice(MENU.COLOR.length);
    await sendToTab(tab.id, { type: 'WN_ANNOTATE_SELECTION', color: color, withNote: false });
    return;
  }

  if (id === MENU.NOTE) {
    await sendToTab(tab.id, { type: 'WN_ANNOTATE_SELECTION', color: null, withNote: true });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab) return;
  const ready = await ensureContentScript(tab);
  if (!ready) return;

  if (command === 'highlight-selection') {
    await sendToTab(tab.id, { type: 'WN_ANNOTATE_SELECTION', color: null, withNote: false });
  } else if (command === 'note-selection') {
    await sendToTab(tab.id, { type: 'WN_ANNOTATE_SELECTION', color: null, withNote: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'WN_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (message.type === 'WN_GET_STATE') {
    (async () => {
      const stored = await chrome.storage.local.get(M.STORAGE_KEY);
      sendResponse({ ok: true, state: M.normalizeState(stored[M.STORAGE_KEY]) });
    })();
    return true;
  }

  if (message.type === 'WN_MUTATE') {
    enqueue(() => applyMutation(message.op, message.payload))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

  if (message.type === 'WN_RELAY') {
    sendToTab(message.tabId, message.message).then((res) => sendResponse({ ok: true, result: res }));
    return true;
  }

  if (message.type === 'WN_BADGE') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (typeof tabId === 'number') {
      const text = message.count > 0 ? String(message.count) : '';
      try {
        chrome.action.setBadgeText({ tabId: tabId, text: text });
        if (text) {
          chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#f2c33d' });
          if (chrome.action.setBadgeTextColor) {
            chrome.action.setBadgeTextColor({ tabId: tabId, color: '#1f2328' });
          }
        }
      } catch (err) {
        /* 忽略 */
      }
    }
    return false;
  }

  if (message.type === 'WN_OPEN_DASHBOARD') {
    openDashboard();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'WN_ENSURE_CONTENT') {
    (async () => {
      const ok = await ensureContentScript(sender.tab || { id: message.tabId });
      sendResponse({ ok: ok });
    })();
    return true;
  }

  return false;
});
