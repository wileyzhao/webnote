/*
 * WebNote — 存储与消息通道
 * 所有写操作统一走 background 串行执行，避免多页面并发覆盖。
 */
(function (root) {
  'use strict';

  const WN = (root.WN = root.WN || {});
  const M = WN.model;

  /** 读取完整状态（只读，安全） */
  async function readState() {
    try {
      const got = await chrome.storage.local.get(M.STORAGE_KEY);
      return M.normalizeState(got ? got[M.STORAGE_KEY] : null);
    } catch (err) {
      console.warn('[WebNote] 读取本地数据失败', err);
      return M.emptyState();
    }
  }

  /** 发起一次变更，等待 background 落盘后返回 */
  async function mutate(op, payload) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'WN_MUTATE', op: op, payload: payload || {} });
    } catch (err) {
      throw new Error('无法连接扩展后台，请刷新页面后重试');
    }
    if (!res || !res.ok) {
      throw new Error((res && res.error) || '操作失败');
    }
    return res;
  }

  /** 监听状态变化（来自其它标签页 / 弹窗 / 管理页的写入） */
  function watch(cb) {
    const handler = (changes, area) => {
      if (area !== 'local' || !changes[M.STORAGE_KEY]) return;
      const next = changes[M.STORAGE_KEY].newValue;
      cb(M.normalizeState(next), next);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  /** 当前活动标签页（仅扩展页面可用） */
  async function getActiveTab() {
    if (!chrome.tabs || !chrome.tabs.query) return null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] ? tabs[0] : null;
    } catch (err) {
      return null;
    }
  }

  /** 向某个标签页发消息，页面没有 content script 时静默失败 */
  async function sendToTab(tabId, message) {
    if (!chrome.tabs || typeof tabId !== 'number') return null;
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      return null;
    }
  }

  function isInjectableUrl(url) {
    if (!url) return false;
    return /^https?:\/\//i.test(url);
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait);
    };
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      const now = Date.now();
      const remain = wait - (now - last);
      if (remain <= 0) {
        clearTimeout(timer);
        timer = null;
        last = now;
        fn.apply(ctx, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(ctx, args);
        }, remain);
      }
    };
  }

  function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function prettyHost(url) {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch (e) {
      return url || '';
    }
  }

  WN.store = {
    readState,
    mutate,
    watch,
    getActiveTab,
    sendToTab,
    isInjectableUrl
  };

  WN.util = {
    debounce,
    throttle,
    relativeTime,
    prettyHost
  };
})(typeof self !== 'undefined' ? self : globalThis);
