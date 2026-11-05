/**
 * 端到端测试：在真实 Chrome 中加载扩展，走一遍完整用户流程。
 *
 * 运行： node tests/e2e.mjs
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
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ✅ ' + name);
  } else {
    failed += 1;
    console.log('  ❌ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  }
}

// ---------------------------------------------------------------- 静态服务器

const PAGE = fs.readFileSync(path.join(__dirname, 'e2e-page.html'));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/test.html`;

// ---------------------------------------------------------------- Chrome

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnote-e2e-'));
const debugPort = 9800 + Math.floor(Math.random() * 190);

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
);

const cleanup = () => {
  try {
    chrome.kill('SIGKILL');
  } catch (e) {
    /* 忽略 */
  }
  server.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (e) {
    /* 忽略 */
  }
};
process.on('exit', cleanup);

// ---------------------------------------------------------------- CDP

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('CDP 超时: ' + method));
          }
        }, 25000);
      });
    },
    close() {
      try {
        ws.close();
      } catch (e) {
        /* 忽略 */
      }
    }
  };
}

async function evaluate(client, expression) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (res.exceptionDetails) {
    const desc =
      (res.exceptionDetails.exception && res.exceptionDetails.exception.description) ||
      res.exceptionDetails.text ||
      '执行异常';
    throw new Error(desc);
  }
  return res.result.value;
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  return res.json();
}

async function findTarget(predicate, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const list = await listTargets();
    const found = list.find(predicate);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

// ---------------------------------------------------------------- 主流程

let extId = '';

try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (r.ok) break;
    } catch (e) {
      /* 等待 */
    }
    await sleep(250);
  }

  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;

  console.log('加载扩展');
  const loaded = await browser.send('Extensions.loadUnpacked', { path: ROOT });
  extId = loaded.id;
  check('扩展加载成功', !!extId, extId);

  // 安装时会自动打开管理页，先关掉以免干扰
  await sleep(1200);
  const early = await listTargets();
  for (const t of early) {
    if (t.type === 'page' && t.url.indexOf(extId) >= 0) {
      await browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
    }
  }

  console.log('\n打开测试文章');
  await browser.send('Target.createTarget', { url: pageUrl });
  const pageTarget = await findTarget((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0);
  check('测试页已打开', !!pageTarget);

  const page = connect(pageTarget.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Runtime.enable');
  await sleep(2000);

  console.log('\n① content script 注入');
  const injected = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      return {
        host: !!host,
        shadow: !!(host && host.shadowRoot),
        toolbar: !!(host && host.shadowRoot && host.shadowRoot.querySelector('[data-el="toolbar"]')),
        supported: !!(window.CSS && CSS.highlights)
      };
    })()`
  );
  check('UI 宿主已挂载', injected.host === true);
  check('Shadow DOM 结构完整', injected.toolbar === true);
  check('浏览器支持 CSS Highlight', injected.supported === true);

  console.log('\n② 划词后浮出工具条');
  await evaluate(
    page,
    `(() => {
      const p = document.getElementById('para2');
      const r = document.createRange();
      r.setStart(p.firstChild, 3);
      r.setEnd(p.firstChild, 12);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return sel.toString();
    })()`
  );
  await sleep(550);

  const toolbar = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      const tb = host && host.shadowRoot.querySelector('[data-el="toolbar"]');
      if (!tb || tb.hidden) return { visible: false };
      const rect = tb.getBoundingClientRect();
      return { visible: rect.width > 40, w: Math.round(rect.width), h: Math.round(rect.height) };
    })()`
  );
  check('工具条可见且有尺寸', toolbar.visible === true, toolbar);

  console.log('\n③ 点色创建高亮');
  await evaluate(
    page,
    `document.getElementById('__webnote_host__').shadowRoot.querySelector('.sw[data-color="yellow"]').click()`
  );
  await sleep(1600);

  const hl = await evaluate(
    page,
    `(() => {
      const keys = [];
      for (const k of CSS.highlights.keys()) keys.push(k);
      const h = CSS.highlights.get('wn-yellow');
      return { keys: keys, size: h ? h.size : 0 };
    })()`
  );
  check('注册了 wn-yellow', hl.keys.indexOf('wn-yellow') >= 0, hl.keys);
  check('生成 1 个高亮区间', hl.size === 1, hl.size);

  console.log('\n④ 划词写批注');
  await evaluate(
    page,
    `(() => {
      window.getSelection().removeAllRanges();
      const p = document.getElementById('para3');
      const r = document.createRange();
      r.setStart(p.firstChild, 2);
      r.setEnd(p.firstChild, 14);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return sel.toString();
    })()`
  );
  await sleep(550);

  const composeClicked = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      const btn = host.shadowRoot.querySelector('[data-act="compose"]');
      if (!btn) return 'no-btn';
      btn.click();
      return 'ok';
    })()`
  );
  check('批注按钮可点击', composeClicked === 'ok', composeClicked);
  await sleep(500);

  const editorState = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      const card = host.shadowRoot.querySelector('[data-el="card"]');
      const input = host.shadowRoot.querySelector('[data-el="input"]');
      if (!card || card.hidden) return { open: false };
      return { open: true, inputVisible: !input.hidden };
    })()`
  );
  check('批注卡片以编辑态打开', editorState.open === true && editorState.inputVisible === true, editorState);

  await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      const input = host.shadowRoot.querySelector('[data-el="input"]');
      input.value = '这是自动化测试写下的批注';
      host.shadowRoot.querySelector('[data-act="save"]').click();
    })()`
  );
  await sleep(1800);

  const afterNote = await evaluate(
    page,
    `(() => {
      const h = CSS.highlights.get('wn-yellow');
      return { size: h ? h.size : 0 };
    })()`
  );
  check('批注保存后新增高亮', afterNote.size === 2, afterNote.size);

  const bodyInfo = await evaluate(page, `({ textLen: document.body.innerText.length, head: document.body.innerText.slice(0, 30) })`);
  console.log('  诊断 · 页面 innerText 长度:', bodyInfo.textLen, JSON.stringify(bodyInfo.head));

  console.log('\n⑤ 数据落盘');
  const swTarget = await findTarget((t) => t.type === 'service_worker' && t.url.indexOf(extId) >= 0);
  check('扩展后台在运行', !!swTarget);
  if (swTarget) {
    const sw = connect(swTarget.webSocketDebuggerUrl);
    await sw.ready;
    const stored = await evaluate(
      sw,
      `chrome.storage.local.get('webnote:v1').then((r) => {
        const s = r['webnote:v1'] || {};
        const urls = Object.keys(s.pages || {});
        let annotations = [];
        urls.forEach((u) => { annotations = annotations.concat(s.pages[u].annotations || []); });
        return {
          pages: urls.length,
          count: annotations.length,
          notes: annotations.filter((a) => a.note).map((a) => a.note),
          quotes: annotations.map((a) => a.quote),
          colors: annotations.map((a) => a.color),
          snapshotLen: urls.length ? (s.pages[urls[0]].snapshot || '').length : 0,
          pageKeys: urls.length ? Object.keys(s.pages[urls[0]]) : []
        };
      })`
    );
    check('存储中有 1 个页面', stored.pages === 1, stored.pages);
    check('存储中有 2 条标注', stored.count === 2, stored.count);
    check('批注文字已保存', stored.notes.indexOf('这是自动化测试写下的批注') >= 0, stored.notes);
    check('原文引用已保存', stored.quotes.every((q) => typeof q === 'string' && q.length > 0), stored.quotes);
    check('正文快照已保存', stored.snapshotLen > 100, { len: stored.snapshotLen, keys: stored.pageKeys });
    sw.close();
  }

  console.log('\n⑥ 刷新后自动恢复');
  await page.send('Page.enable');
  await page.send('Page.reload', { ignoreCache: false });
  await sleep(3200);

  const restored = await evaluate(
    page,
    `(() => {
      const host = document.getElementById('__webnote_host__');
      if (!host) return { host: false };
      const h = CSS.highlights.get('wn-yellow');
      return { host: true, size: h ? h.size : 0 };
    })()`
  );
  check('刷新后 UI 重新挂载', restored.host === true);
  check('刷新后 2 条高亮全部恢复', restored.size === 2, restored.size);

  console.log('\n⑦ 管理页');
  const dashUrl = `chrome-extension://${extId}/src/dashboard/dashboard.html`;
  await browser.send('Target.createTarget', { url: dashUrl });
  const dashTarget = await findTarget((t) => t.type === 'page' && t.url === dashUrl);
  check('管理页已打开', !!dashTarget);

  if (dashTarget) {
    const dash = connect(dashTarget.webSocketDebuggerUrl);
    await dash.ready;
    await dash.send('Runtime.enable');
    await sleep(1800);

    const dashInfo = await evaluate(
      dash,
      `(() => ({
        cards: document.querySelectorAll('.card').length,
        title: ((document.querySelector('.card-title h2 a') || {}).textContent || ''),
        anns: document.querySelectorAll('.ann').length,
        treeRows: document.querySelectorAll('.tag-row').length,
        viewTitle: (document.getElementById('viewTitle') || {}).textContent || '',
        hasSnapshotBtn: Array.from(document.querySelectorAll('.mini-btn')).some((b) => b.textContent === '正文快照')
      }))()`
    );
    check('渲染出页面卡片', dashInfo.cards === 1, dashInfo.cards);
    check('卡片标题正确', dashInfo.title.indexOf('大模型推理成本') >= 0, dashInfo.title);
    check('卡片里能看到标注', dashInfo.anns === 2, dashInfo.anns);
    check('标签树渲染', dashInfo.treeRows >= 2, dashInfo.treeRows);
    check('卡片提供正文快照入口', dashInfo.hasSnapshotBtn === true);

    console.log('\n⑧ 管理页新建标签');
    await evaluate(dash, `document.getElementById('btnNewTag').click()`);
    await sleep(500);
    const modalOpen = await evaluate(dash, `!!document.querySelector('.modal')`);
    check('新建标签弹窗出现', modalOpen === true);

    await evaluate(
      dash,
      `(() => {
        const modal = document.querySelector('.modal');
        modal.querySelector('[data-el="name"]').value = '技术观察';
        modal.querySelector('[data-act="ok"]').click();
      })()`
    );
    await sleep(1400);

    const treeAfter = await evaluate(
      dash,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.tag-row .name')).map((n) => n.textContent);
        return { names: rows };
      })()`
    );
    check('新标签出现在树里', treeAfter.names.indexOf('技术观察') >= 0, treeAfter.names);

    console.log('\n⑨ 搜索过滤');
    await evaluate(
      dash,
      `(() => {
        const s = document.getElementById('search');
        s.value = '批注';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      })()`
    );
    await sleep(700);
    const searched = await evaluate(dash, `document.querySelectorAll('.card').length`);
    check('搜索命中批注内容', searched === 1, searched);

    await evaluate(
      dash,
      `(() => {
        const s = document.getElementById('search');
        s.value = '不存在的关键词zzz';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      })()`
    );
    await sleep(700);
    const searchedEmpty = await evaluate(
      dash,
      `({ cards: document.querySelectorAll('.card').length, empty: !!document.querySelector('.empty-state') })`
    );
    check('无结果时显示空态', searchedEmpty.cards === 0 && searchedEmpty.empty === true, searchedEmpty);

    dash.close();
  }

  console.log('\n⑩ 弹窗页面');
  const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
  await browser.send('Target.createTarget', { url: popupUrl });
  const popupTarget = await findTarget((t) => t.type === 'page' && t.url === popupUrl);
  if (popupTarget) {
    const popup = connect(popupTarget.webSocketDebuggerUrl);
    await popup.ready;
    await popup.send('Runtime.enable');
    await sleep(1200);
    const popupInfo = await evaluate(
      popup,
      `({
        hasToggle: !!document.getElementById('toggleEnabled'),
        title: (document.getElementById('pageTitle') || {}).textContent || '',
        footer: !!document.getElementById('btnDashboard')
      })`
    );
    check('弹窗渲染正常', popupInfo.hasToggle && popupInfo.footer, popupInfo);
    check('弹窗有内容文案', (popupInfo.title || '').length > 0, popupInfo.title);
    popup.close();
  } else {
    check('弹窗页面可打开', false);
  }

  page.close();
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
