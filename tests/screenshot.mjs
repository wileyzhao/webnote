/** 截图，用于人工检查视觉效果 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const PAGE = fs.readFileSync(path.join(__dirname, 'e2e-page.html'));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/test.html`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-shot-'));
const debugPort = 9600 + Math.floor(Math.random() * 90);

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-crash-reporter',
    '--enable-unsafe-extension-debugging',
    '--force-color-profile=srgb',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
);

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const e = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? e.reject(new Error(JSON.stringify(msg.error))) : e.resolve(msg.result);
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
        setTimeout(() => reject(new Error('timeout ' + method)), 25000);
      });
    },
    close() { try { ws.close(); } catch (e) {} }
  };
}

async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval error');
  return r.result.value;
}

async function shot(client, name) {
  const res = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('  📸', file);
}


function buildSample(now, day) {
  const ann = (id, quote, note, color, start, days) => ({
    id: id,
    start: start,
    end: start + quote.length,
    quote: quote,
    prefix: '',
    suffix: '',
    color: color,
    note: note || '',
    createdAt: now - day * days,
    updatedAt: now - day * days
  });

  return {
    version: 1,
    settings: {
      enabled: true,
      disabledHosts: [],
      defaultColor: 'yellow',
      showToolbar: true,
      autoOpenNote: false,
      saveSnapshot: true,
      theme: 'auto'
    },
    tags: [
      { id: 't_ai', name: 'AI 工程', parentId: null, color: 'blue', order: 0, createdAt: now - day * 40 },
      { id: 't_infer', name: '推理优化', parentId: 't_ai', color: 'green', order: 0, createdAt: now - day * 39 },
      { id: 't_agent', name: 'Agent 设计', parentId: 't_ai', color: 'purple', order: 1, createdAt: now - day * 30 },
      { id: 't_biz', name: '商业观察', parentId: null, color: 'pink', order: 1, createdAt: now - day * 28 },
      { id: 't_read', name: '待读', parentId: null, color: 'yellow', order: 2, createdAt: now - day * 12 }
    ],
    pages: {
      'https://www.infoq.cn/article/llm-inference-cost': {
        url: 'https://www.infoq.cn/article/llm-inference-cost',
        title: '大模型推理成本一年下降十倍，工程侧发生了什么',
        favicon: '',
        host: 'www.infoq.cn',
        createdAt: now - day * 3,
        updatedAt: now - day * 1,
        tagIds: ['t_ai', 't_infer'],
        snapshot:
          '过去一年，推理侧的单位 token 成本下降了接近一个数量级。这个变化并不是单一技术突破带来的，而是模型结构、量化、KV Cache 管理、批处理调度和硬件利用率共同作用的结果。\n\n' +
          '先看最容易被忽视的一环：批处理调度。连续批处理（continuous batching）把请求的调度粒度从「整批」下沉到「单步」，让 GPU 在等待某个请求生成时不会空转，实际吞吐提升往往在两倍以上。\n\n' +
          '其次是 KV Cache 的显存管理。分页式 KV Cache 借鉴了操作系统虚拟内存的思路，把显存切成固定大小的块按需分配，显存碎片率显著下降，能同时挂载的会话数也随之上升。\n\n' +
          '这些优化叠加起来，才让「每百万 token 几块钱」成为可能。',
        annotations: [
          ann('a1', '推理侧的单位 token 成本下降了接近一个数量级', '成本下降主要来自工程优化，不是换了更强的卡，这点很关键。', 'yellow', 10, 1),
          ann('a2', '连续批处理（continuous batching）把请求的调度粒度从「整批」下沉到「单步」', '这个思路和 CPU 的乱序执行有点像，都是靠填满空闲周期换吞吐。', 'green', 120, 1),
          ann('a3', '分页式 KV Cache 借鉴了操作系统虚拟内存的思路', '', 'blue', 260, 2)
        ]
      },
      'https://36kr.com/p/1234567890': {
        url: 'https://36kr.com/p/1234567890',
        title: 'AI 应用层的钱到底被谁赚走了',
        favicon: '',
        host: '36kr.com',
        createdAt: now - day * 6,
        updatedAt: now - day * 4,
        tagIds: ['t_biz'],
        snapshot: '',
        annotations: [
          ann('b1', '真正稳定赚钱的是那些把模型能力包进既有工作流里的公司', '同意。用户不会为“模型”付费，只会为“少干一件事”付费。', 'pink', 30, 4)
        ]
      },
      'https://sspai.com/post/88888': {
        url: 'https://sspai.com/post/88888',
        title: '我用三个月时间，把阅读工作流彻底重做了一遍',
        favicon: '',
        host: 'sspai.com',
        createdAt: now - day * 9,
        updatedAt: now - day * 7,
        tagIds: ['t_read'],
        snapshot: '',
        annotations: [
          ann('c1', '标注的价值不在于记下来，而在于三个月后你还能找到它', '这也是我做这个插件的初衷。', 'yellow', 15, 7)
        ]
      },
      'https://github.com/openai/openai-cookbook': {
        url: 'https://github.com/openai/openai-cookbook',
        title: 'openai/openai-cookbook: Examples and guides for using the OpenAI API',
        favicon: '',
        host: 'github.com',
        createdAt: now - day * 15,
        updatedAt: now - day * 15,
        tagIds: ['t_ai'],
        snapshot: '',
        annotations: []
      },
      'https://example.com/blog/notes-on-reading': {
        url: 'https://example.com/blog/notes-on-reading',
        title: '关于「如何做读书笔记」的一点碎碎念',
        favicon: '',
        host: 'example.com',
        createdAt: now - day * 22,
        updatedAt: now - day * 22,
        tagIds: [],
        snapshot: '',
        annotations: []
      }
    }
  };
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
}

async function findTarget(predicate, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const found = (await listTargets()).find(predicate);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break; } catch (e) {}
    await sleep(250);
  }

  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;
  const loaded = await browser.send('Extensions.loadUnpacked', { path: ROOT });
  const extId = loaded.id;

  await sleep(1000);
  for (const t of await listTargets()) {
    if (t.type === 'page' && t.url.indexOf(extId) >= 0) {
      await browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
    }
  }

  // ---------- 1. 划词工具条
  await browser.send('Target.createTarget', { url: pageUrl });
  const pt = await findTarget((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0);
  const page = connect(pt.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1180, height: 760, deviceScaleFactor: 2, mobile: false
  });
  await sleep(2200);

  console.log('截图：');
  await evaluate(page, `(() => {
    const p = document.getElementById('para2');
    const r = document.createRange();
    r.setStart(p.firstChild, 3);
    r.setEnd(p.firstChild, Math.min(20, p.firstChild.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await sleep(700);
  await shot(page, '01-toolbar');

  // ---------- 2. 批注编辑卡片
  await evaluate(page, `document.getElementById('__webnote_host__').shadowRoot.querySelector('[data-act="compose"]').click()`);
  await sleep(600);
  await evaluate(page, `(() => {
    const host = document.getElementById('__webnote_host__');
    const input = host.shadowRoot.querySelector('[data-el="input"]');
    input.value = '连续批处理是这两年推理吞吐提升最关键的一步，工程上比换卡便宜得多。';
  })()`);
  await sleep(300);
  await shot(page, '02-composer');

  // 保存
  await evaluate(page, `document.getElementById('__webnote_host__').shadowRoot.querySelector('[data-act="save"]').click()`);
  await sleep(1500);

  // ---------- 3. 再补两条标注，看多色效果
  await evaluate(page, `(() => {
    const p = document.getElementById('para3');
    const r = document.createRange();
    r.setStart(p.firstChild, 2);
    r.setEnd(p.firstChild, Math.min(22, p.firstChild.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await sleep(650);
  await evaluate(page, `document.getElementById('__webnote_host__').shadowRoot.querySelector('.sw[data-color="blue"]').click()`);
  await sleep(900);

  await evaluate(page, `(() => {
    const p = document.getElementById('para4');
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, Math.min(16, p.firstChild.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await sleep(650);
  await evaluate(page, `document.getElementById('__webnote_host__').shadowRoot.querySelector('.sw[data-color="green"]').click()`);
  await sleep(1200);

  await evaluate(page, `(() => {
    window.getSelection().removeAllRanges();
    const host = document.getElementById('__webnote_host__');
    const tb = host.shadowRoot.querySelector('[data-el="toolbar"]');
    if (tb) tb.hidden = true;
  })()`);
  await sleep(400);
  await shot(page, '03-page-highlights');

  // ---------- 4. 点击高亮打开详情卡片
  const rect = await evaluate(page, `(() => {
    const h = CSS.highlights.get('wn-yellow');
    if (!h) return null;
    const r = Array.from(h.values())[0].getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  })()`);
  if (rect) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(1000);
    await shot(page, '04-annotation-card');
  } else {
    console.log('  (没找到黄色高亮)');
  }

  // ---------- 注入示例数据，让管理页截图接近真实使用
  const swTarget = await findTarget((t) => t.type === 'service_worker' && t.url.indexOf(extId) >= 0);
  if (swTarget) {
    const sw = connect(swTarget.webSocketDebuggerUrl);
    await sw.ready;
    const sample = buildSample(Date.now(), 86400000);
    sample.settings.locale = 'zh-CN';
    await evaluate(sw, "chrome.storage.local.set({'webnote:v1': " + JSON.stringify(sample) + "}).then(() => 1)");
    sw.close();
    console.log('  （已注入示例数据）');
  }

  // ---------- 4. 管理页（浅色 + 深色）
  const dashUrl = `chrome-extension://${extId}/src/dashboard/dashboard.html`;
  await browser.send('Target.createTarget', { url: dashUrl });
  const dt = await findTarget((t) => t.type === 'page' && t.url === dashUrl);
  const dash = connect(dt.webSocketDebuggerUrl);
  await dash.ready;
  await dash.send('Runtime.enable');
  await dash.send('Page.enable');
  await dash.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 2, mobile: false });
  await sleep(2000);

  // 建两个标签，让树有层级
  await evaluate(dash, `(async () => {
    window.__pnTestDone = false;
    return true;
  })()`);
  await evaluate(dash, `document.getElementById('btnNewTag').click()`);
  await sleep(400);
  await evaluate(dash, `(() => {
    const m = document.querySelector('.modal');
    m.querySelector('[data-el="name"]').value = '产品设计';
    m.querySelector('[data-act="ok"]').click();
  })()`);
  await sleep(1000);
  await evaluate(dash, `document.getElementById('btnNewTag').click()`);
  await sleep(400);
  await evaluate(dash, `(() => {
    const m = document.querySelector('.modal');
    m.querySelector('[data-el="name"]').value = '交互细节';
    const sel = m.querySelector('[data-el="parent"]');
    const opt = Array.from(sel.options).find((o) => o.textContent.trim() === '产品设计');
    if (opt) sel.value = opt.value;
    m.querySelector('[data-act="ok"]').click();
  })()`);
  await sleep(1200);
  await shot(dash, '05-dashboard');

  // 页面卡片：编辑标签
  await evaluate(dash, `(() => {
    const btn = document.querySelector('.mini-btn[data-act="tags"]');
    if (btn) btn.click();
  })()`);
  await sleep(600);
  await shot(dash, '06-dashboard-tagpicker');
  await evaluate(dash, `(() => { const c = document.querySelector('.modal [data-act="cancel"]'); if (c) c.click(); })()`);

  await dash.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(800);
  await shot(dash, '07-dashboard-dark');

  // ---------- 5. 弹窗
  const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
  await browser.send('Target.createTarget', { url: popupUrl });
  const pp = await findTarget((t) => t.type === 'page' && t.url === popupUrl);
  const popup = connect(pp.webSocketDebuggerUrl);
  await popup.ready;
  await popup.send('Runtime.enable');
  await popup.send('Page.enable');
  await popup.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 470, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  await shot(popup, '08-popup');

  console.log('\n完成');
} catch (err) {
  console.log('异常:', err.message);
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}
