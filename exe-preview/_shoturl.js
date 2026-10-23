/**
 * _shoturl.js —— 给「任意 URL」截图的零依赖 CDP 工具（本项目自建，只读上游）。
 *
 * 为什么另写一个：demo 自己的 `demo/_shot.js` 只会拍 `demo/_shot_tmp.html`（file://），
 * 而这次要拍的是**跑在 127.0.0.1:8123 上的 GameHub 真页面**（HTTP）。
 * 上游目录只读、不许落任何文件，所以脚本放在本项目 `exe-preview/` 内。
 *
 * 手法沿用 `_shot.js`（已知能治「拍到未光栅化空白图」）：
 *   Page.navigate → 等 load → 页内 await 所有 img.decode() → 两帧 rAF → Page.captureScreenshot
 *
 * 用法：
 *   node _shoturl.js <url> <输出文件.png> [W] [H] [等待毫秒]
 * 环境变量：CHROME_PATH / CDP_PORT / HEADLESS
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2];
const PNG = process.argv[3] || 'out.png';
const W = process.argv[4] || '1440';
const H = process.argv[5] || '900';
const EXTRA_WAIT = Number(process.argv[6] || 0);
const PORT = Number(process.env.CDP_PORT || 9400 + Math.floor(Math.random() * 300));
const HL = process.env.HEADLESS || '--headless=new';
const PROFILE = process.env.PROFILE_DIR || path.join(process.env.TEMP || '.', 'shoturl-prof');

if (!URL_) { console.error('用法: node _shoturl.js <url> <out.png> [W] [H]'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pend = new Map();
    const subs = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) {
        const { res, rej } = pend.get(m.id);
        pend.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else subs.forEach((fn) => fn(m));
    };
    ws.onerror = () => reject(new Error('CDP websocket 连接失败'));
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const i = ++id;
          pend.set(i, { res, rej });
          ws.send(JSON.stringify({ id: i, method, params: params || {} }));
        });
      },
      on(fn) { subs.push(fn); },
      close() { try { ws.close(); } catch (e) { /* noop */ } },
    });
  });
}

(async () => {
  fs.mkdirSync(path.dirname(path.resolve(PNG)), { recursive: true });
  const ch = spawn(CHROME, [
    HL, '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H,
    '--user-data-dir=' + PROFILE,
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const pg = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { /* 端口还没起 */ }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) { ch.kill(); throw new Error('CDP 端口未就绪'); }

  const c = await cdp(wsUrl);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    const loaded = new Promise((r) => c.on((m) => { if (m.method === 'Page.loadEventFired') r(); }));
    await c.send('Page.navigate', { url: URL_ });
    await Promise.race([loaded, sleep(30000)]);
    await sleep(600);

    const R = await c.send('Runtime.evaluate', {
      expression: `(async () => {
        const imgs = [].slice.call(document.images || []);
        const ready = im => im.complete && im.naturalWidth > 0;
        const HARD = Date.now() + 30000;
        await Promise.all(imgs.map(im => new Promise(res => {
          if (ready(im)) { im.decode ? im.decode().then(res, res) : res(); return; }
          im.addEventListener('load', res, { once: true });
          im.addEventListener('error', res, { once: true });
          setTimeout(res, 15000);
        })));
        while (Date.now() < HARD && imgs.some(im => !ready(im))) await new Promise(r => setTimeout(r, 200));
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        return imgs.length + '/' + imgs.filter(ready).length + ' | ' + document.title;
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (EXTRA_WAIT) await sleep(EXTRA_WAIT);

    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    const out = path.resolve(PNG);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('[cdp] ' + (R.result && R.result.value) + '  ->  ' + out + '  ' + fs.statSync(out).size);
  } finally {
    c.close();
    ch.kill();
  }
})().catch((e) => { console.error('[cdp] 失败：' + e.message); process.exit(1); });
