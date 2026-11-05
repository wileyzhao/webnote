/**
 * 生成 Chrome 应用商店素材的原始截图。
 * 运行： node tools/promo/capture.mjs
 * 产物： store-assets/raw/*.png（再用 build_assets.py 转成无 alpha 的成品）
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RAW = path.join(ROOT, 'store-assets', 'raw');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(RAW, { recursive: true });

const PAGE_HTML = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');

// ---------------------------------------------------------------- 静态服务
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/article`;

// ---------------------------------------------------------------- Chrome
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-promo-'));
const port = 9100 + Math.floor(Math.random() * 90);

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-crash-reporter',
    '--enable-unsafe-extension-debugging', '--force-color-profile=srgb',
    '--font-render-hinting=none',
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

// ---------------------------------------------------------------- CDP
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
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); }
        }, 25000);
      });
    },
    close() { try { ws.close(); } catch (e) { /* 忽略 */ } }
  };
}

async function ev(client, expression) {
  const r = await client.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval error');
  }
  return r.result.value;
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

async function findTarget(pred, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const found = (await listTargets()).find(pred);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

async function shot(client, name) {
  const res = await client.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false
  });
  const file = path.join(RAW, name + '.png');
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('  📸', path.relative(ROOT, file));
  return file;
}

async function openPage(browser, url, width, height) {
  await browser.send('Target.createTarget', { url });
  const t = await findTarget((x) => x.type === 'page' && x.url === url);
  const client = connect(t.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false
  });
  return client;
}

// 按「段落内第几个字符」选中，自动跨过 <em> 等子节点
function selectExpr(paraId, from, to) {
  return `(() => {
    window.getSelection().removeAllRanges();
    const p = document.getElementById('${paraId}');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let total = 0;
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: total });
      total += n.nodeValue.length;
    }
    if (!nodes.length) return '';
    const pointAt = (off) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].start <= off) {
          return { node: nodes[i].node, offset: Math.min(off - nodes[i].start, nodes[i].node.nodeValue.length) };
        }
      }
      return { node: nodes[0].node, offset: 0 };
    };
    const a = pointAt(${from});
    const b = pointAt(${to});
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return s.toString();
  })()`;
}

const clickToolbarColor = (color) => `(() => {
  const h = document.getElementById('__webnote_host__');
  const b = h.shadowRoot.querySelector('.sw[data-color="${color}"]');
  if (b) b.click();
})()`;

const clickCompose = `(() => {
  const h = document.getElementById('__webnote_host__');
  const b = h.shadowRoot.querySelector('[data-act="compose"]');
  if (b) b.click();
})()`;

const typeAndSave = (text) => `(() => {
  const h = document.getElementById('__webnote_host__');
  const input = h.shadowRoot.querySelector('[data-el="input"]');
  input.value = ${JSON.stringify(text)};
  h.shadowRoot.querySelector('[data-act="save"]').click();
})()`;

const hideToolbar = `(() => {
  window.getSelection().removeAllRanges();
  const h = document.getElementById('__webnote_host__');
  const t = h.shadowRoot.querySelector('[data-el="toolbar"]');
  if (t) t.hidden = true;
})()`;

const pressEsc = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;

const openCardOfFirstHighlight = `(() => {
  const h = CSS.highlights.get('wn-yellow');
  const r = Array.from(h.values())[0];
  const rect = r.getBoundingClientRect();
  return { x: rect.left + 24, y: rect.top + rect.height / 2 };
})()`;

// ---------------------------------------------------------------- 主流程
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
  console.log('扩展已加载:', loaded.id);

  await sleep(1200);
  for (const t of await listTargets()) {
    if (t.type === 'page' && t.url.includes(loaded.id)) {
      await browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
    }
  }

  console.log('\n网页场景：');
  const page = await openPage(browser, pageUrl, 1280, 800);
  await sleep(2200);

  // 1) 划词工具条（选第一段，让工具条落在正文上方的留白里）
  await ev(page, selectExpr('p1', 9, 40));
  await sleep(800);
  await shot(page, 'screenshot-1');

  // 清掉选区，准备做标注
  await ev(page, `window.getSelection().removeAllRanges()`);
  await sleep(400);

  // 2) 写一条批注
  await ev(page, selectExpr('p2', 9, 46));
  await sleep(700);
  await ev(page, clickCompose);
  await sleep(600);
  await ev(page, typeAndSave('连续批处理是这两年推理吞吐提升最关键的一步，工程上比换卡便宜得多。'));
  await sleep(1600);

  // 3) 再来两条不同颜色的高亮
  await ev(page, selectExpr('p3', 6, 38));
  await sleep(700);
  await ev(page, clickToolbarColor('blue'));
  await sleep(1300);

  await ev(page, selectExpr('p4', 0, 24));
  await sleep(700);
  await ev(page, clickToolbarColor('green'));
  await sleep(1600);

  // 4) 打开批注卡片
  const pos = await ev(page, openCardOfFirstHighlight);
  if (pos) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    await shot(page, 'screenshot-2');
  }

  // 5) 关掉卡片，纯多色高亮
  await ev(page, pressEsc);
  await sleep(900);
  await ev(page, hideToolbar);
  await sleep(500);
  const shot3 = await shot(page, 'screenshot-3');

  // 6) 管理页
  const swT = await findTarget((t) => t.type === 'service_worker' && t.url.includes(loaded.id));
  if (swT) {
    const sw = connect(swT.webSocketDebuggerUrl);
    await sw.ready;
    const sample = buildSample(Date.now(), 86400000);
    await ev(sw, `chrome.storage.local.set({'webnote:v1': ${JSON.stringify(sample)}}).then(() => 1)`);
    sw.close();
  }

  const dashUrl = `chrome-extension://${loaded.id}/src/dashboard/dashboard.html`;
  const dash = await openPage(browser, dashUrl, 1280, 800);
  await sleep(2200);
  await ev(dash, `document.querySelectorAll('.card-foot').forEach((e) => e.style.opacity = '1')`);
  await shot(dash, 'screenshot-4');
  dash.close();
  page.close();

  console.log('\n宣传图块：');
  const tile440 = await openPage(browser, 'file://' + path.join(__dirname, 'tile-440.html'), 440, 280);
  await sleep(1200);
  await shot(tile440, 'promo-440x280');
  tile440.close();

  // 1400 图块需要把截图嵌进去
  const shotB64 = fs.readFileSync(shot3).toString('base64');
  const tpl = fs.readFileSync(path.join(__dirname, 'tile-1400.html'), 'utf8');
  const filled = tpl.replace('{{SHOT}}', `data:image/png;base64,${shotB64}`);
  const tmpHtml = path.join(RAW, '_tile1400.html');
  fs.writeFileSync(tmpHtml, filled);

  const tile1400 = await openPage(browser, 'file://' + tmpHtml, 1400, 560);
  await sleep(1400);
  await shot(tile1400, 'promo-1400x560');
  tile1400.close();

  console.log('\n原始截图已生成');
} catch (err) {
  console.log('异常:', err.message);
  process.exitCode = 1;
} finally {
  if (browser) browser.close();
  cleanup();
}

// ---------------------------------------------------------------- 示例数据
function buildSample(now, day) {
  const ann = (id, quote, note, color, start, days) => ({
    id, start, end: start + quote.length, quote, prefix: '', suffix: '',
    color, note: note || '', createdAt: now - day * days, updatedAt: now - day * days
  });

  return {
    version: 1,
    settings: {
      enabled: true, disabledHosts: [], defaultColor: 'yellow',
      showToolbar: true, autoOpenNote: false, saveSnapshot: true, theme: 'auto'
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
        favicon: '', host: 'www.infoq.cn',
        createdAt: now - day * 3, updatedAt: now - day * 1,
        tagIds: ['t_ai', 't_infer'],
        snapshot: '过去一年，推理侧的单位 token 成本下降了接近一个数量级。',
        annotations: [
          ann('a1', '推理侧的单位 token 成本下降了接近一个数量级', '成本下降主要来自工程优化，不是换了更强的卡。', 'yellow', 10, 1),
          ann('a2', '连续批处理把请求的调度粒度从「整批」下沉到「单步」', '这个思路和 CPU 乱序执行有点像，都是靠填满空闲周期换吞吐。', 'green', 120, 1),
          ann('a3', '分页式 KV Cache 借鉴了操作系统虚拟内存的思路', '', 'blue', 260, 2)
        ]
      },
      'https://36kr.com/p/1234567890': {
        url: 'https://36kr.com/p/1234567890',
        title: 'AI 应用层的钱到底被谁赚走了',
        favicon: '', host: '36kr.com',
        createdAt: now - day * 6, updatedAt: now - day * 4,
        tagIds: ['t_biz'], snapshot: '',
        annotations: [ann('b1', '真正稳定赚钱的是那些把模型能力包进既有工作流里的公司', '用户不会为「模型」付费，只会为「少干一件事」付费。', 'pink', 30, 4)]
      },
      'https://sspai.com/post/88888': {
        url: 'https://sspai.com/post/88888',
        title: '我用三个月时间，把阅读工作流彻底重做了一遍',
        favicon: '', host: 'sspai.com',
        createdAt: now - day * 9, updatedAt: now - day * 7,
        tagIds: ['t_read'], snapshot: '',
        annotations: [ann('c1', '标注的价值不在于记下来，而在于三个月后你还能找到它', '', 'yellow', 15, 7)]
      },
      'https://github.com/openai/openai-cookbook': {
        url: 'https://github.com/openai/openai-cookbook',
        title: 'openai/openai-cookbook: Examples and guides for using the OpenAI API',
        favicon: '', host: 'github.com',
        createdAt: now - day * 15, updatedAt: now - day * 15,
        tagIds: ['t_ai'], snapshot: '', annotations: []
      }
    }
  };
}
