/**
 * 多语言专项测试：切换界面语言后，各处文案是否真的跟着变。
 * 运行： node tests/i18n-test.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) {
    passed += 1;
    console.log('  ✅ ' + name);
  } else {
    failed += 1;
    console.log('  ❌ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  }
};

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>i18n</title></head>
<body><p id="p">This paragraph is used to test localized toolbar labels on the page.</p></body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/t`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-i18n-'));
const port = 9200 + Math.floor(Math.random() * 90);

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-crash-reporter',
    '--enable-unsafe-extension-debugging', '--lang=zh-CN',
    `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, 'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
);

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch (e) { /* 忽略 */ }
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
};
process.on('exit', cleanup);

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const e = pending.get(m.id);
      pending.delete(m.id);
      m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 25000);
      });
    },
    close() { try { ws.close(); } catch (e) { /* 忽略 */ } }
  };
}

async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval error');
  }
  return r.result.value;
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}
async function findTarget(pred, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const found = (await listTargets()).find(pred);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

let browser = null;

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;

  const loaded = await browser.send('Extensions.loadUnpacked', { path: ROOT });
  const extId = loaded.id;
  await sleep(1000);

  for (const t of await listTargets()) {
    if (t.type === 'page' && t.url.includes(extId)) {
      await browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
    }
  }

  const swT = await findTarget((t) => t.type === 'service_worker' && t.url.includes(extId));
  const sw = connect(swT.webSocketDebuggerUrl);
  await sw.ready;

  const setLocale = (locale) =>
    evaluate(sw, `chrome.storage.local.get('webnote:v1').then((r) => {
      const st = r['webnote:v1'] || { version: 1, pages: {}, tags: [], settings: {} };
      st.settings = Object.assign({}, st.settings, { locale: ${JSON.stringify(locale)} });
      return chrome.storage.local.set({ 'webnote:v1': st }).then(() => 1);
    })`);

  console.log('\n① 管理页跟随语言');

  const dashUrl = `chrome-extension://${extId}/src/dashboard/dashboard.html`;
  await browser.send('Target.createTarget', { url: dashUrl });
  const dashT = await findTarget((t) => t.type === 'page' && t.url === dashUrl);
  const dash = connect(dashT.webSocketDebuggerUrl);
  await dash.ready;
  await dash.send('Runtime.enable');
  await sleep(1800);

  const expectations = [
    { locale: 'zh-CN', title: '全部页面', exportBtn: '导出', settings: '设置' },
    { locale: 'en', title: 'All pages', exportBtn: 'Export', settings: 'Settings' },
    { locale: 'ja', title: 'すべてのページ', exportBtn: 'エクスポート', settings: '設定' },
    { locale: 'fr', title: 'Toutes les pages', exportBtn: 'Exporter', settings: 'Paramètres' },
    { locale: 'de', title: 'Alle Seiten', exportBtn: 'Exportieren', settings: 'Einstellungen' },
    { locale: 'es', title: 'Todas las páginas', exportBtn: 'Exportar', settings: 'Ajustes' }
  ];

  for (const item of expectations) {
    await setLocale(item.locale);
    await sleep(900);
    const got = await evaluate(
      dash,
      `({
        title: (document.getElementById('viewTitle') || {}).textContent || '',
        exportBtn: (document.getElementById('btnExport') || {}).textContent || '',
        settings: (document.getElementById('btnSettings') || {}).textContent || '',
        lang: document.documentElement.getAttribute('lang') || ''
      })`
    );
    check(
      `${item.locale} 管理页文案`,
      got.title === item.title && got.exportBtn === item.exportBtn && got.settings === item.settings,
      got
    );
  }

  console.log('\n② 语言选择器本身可用');
  await setLocale('zh-CN');
  await sleep(600);
  await evaluate(dash, `document.getElementById('btnSettings').click()`);
  await sleep(700);
  const opts = await evaluate(
    dash,
    `(() => {
      const sel = document.querySelector('.modal [data-el="locale"]');
      if (!sel) return null;
      return {
        count: sel.options.length,
        values: Array.from(sel.options).map((o) => o.value),
        current: sel.value
      };
    })()`
  );
  check('设置里有语言下拉', !!opts, opts);
  check('包含 7 个选项（auto + 6 语言）', opts && opts.count === 7, opts && opts.count);
  check('当前语言为 zh-CN', opts && opts.current === 'zh-CN', opts && opts.current);
  await evaluate(dash, `document.querySelector('.modal [data-act="ok"]').click()`);
  await sleep(500);

  console.log('\n③ 通过设置面板切换语言');
  await evaluate(dash, `document.getElementById('btnSettings').click()`);
  await sleep(700);
  await evaluate(
    dash,
    `(() => {
      const sel = document.querySelector('.modal [data-el="locale"]');
      sel.value = 'ja';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.modal [data-act="ok"]').click();
    })()`
  );
  await sleep(1200);
  const afterSwitch = await evaluate(dash, `(document.getElementById('viewTitle') || {}).textContent || ''`);
  check('从设置切换为日文后标题更新', afterSwitch === 'すべてのページ', afterSwitch);

  console.log('\n④ 页内工具条跟随语言');
  await setLocale('en');
  await sleep(500);

  await browser.send('Target.createTarget', { url: pageUrl });
  const pageT = await findTarget((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0);
  const page = connect(pageT.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Runtime.enable');
  await sleep(2200);

  await evaluate(
    page,
    `(() => {
      const p = document.getElementById('p');
      const r = document.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, 20);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
    })()`
  );
  await sleep(700);

  const toolbarEn = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      if (!host) return null;
      const compose = host.shadowRoot.querySelector('[data-act="compose"] span');
      const swatch = host.shadowRoot.querySelector('.sw[data-color="yellow"]');
      return {
        compose: compose ? compose.textContent : '',
        swatchTitle: swatch ? swatch.title : ''
      };
    })()`
  );
  check('英文工具条按钮文案', toolbarEn && toolbarEn.compose === 'Note', toolbarEn);
  check('英文颜色提示文案', toolbarEn && toolbarEn.swatchTitle === 'Yellow highlight', toolbarEn);

  await setLocale('ja');
  await sleep(900);
  const toolbarJa = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      const compose = host.shadowRoot.querySelector('[data-act="compose"] span');
      const swatch = host.shadowRoot.querySelector('.sw[data-color="yellow"]');
      return { compose: compose ? compose.textContent : '', swatchTitle: swatch ? swatch.title : '' };
    })()`
  );
  check('切换日文后工具条即时更新', toolbarJa && toolbarJa.compose === 'メモ', toolbarJa);
  check('切换日文后颜色提示更新', toolbarJa && toolbarJa.swatchTitle === '黄のハイライト', toolbarJa);

  console.log('\n⑤ 弹窗跟随语言');
  await setLocale('fr');
  await sleep(500);
  const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
  await browser.send('Target.createTarget', { url: popupUrl });
  const popT = await findTarget((t) => t.type === 'page' && t.url === popupUrl);
  const popup = connect(popT.webSocketDebuggerUrl);
  await popup.ready;
  await popup.send('Runtime.enable');
  await sleep(1500);
  const popupFr = await evaluate(
    popup,
    `({
      dashboard: (document.getElementById('btnDashboard') || {}).textContent || '',
      emptyTitle: (document.querySelector('.empty-title') || {}).textContent || ''
    })`
  );
  check('法文弹窗按钮文案', popupFr.dashboard === 'Bibliothèque · Tags', popupFr);
  check('法文弹窗空态文案', popupFr.emptyTitle === 'Aucune annotation', popupFr);

  page.close();
  popup.close();
  dash.close();
  sw.close();
  browser.close();
} catch (err) {
  failed += 1;
  console.log('\n❌ 测试异常: ' + (err && err.message ? err.message : err));
} finally {
  console.log('\n' + '='.repeat(50));
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  cleanup();
  process.exit(failed ? 1 : 0);
}
