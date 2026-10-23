/**
 * _shot.js —— 用 CDP 给截图页拍图（替代 chrome --screenshot）。
 *
 * 为什么必须换（★v8 实测）：
 *   `chrome --headless --screenshot --virtual-time-budget=N` 这条路上，
 *   虚拟时间预算**不等待图片解码**。DOM 侧早已 `complete=true / opacity=1`
 *   （SHOT_DIAG 实测 mEvent 98/98、naturalWidth=1080x608），但截图里是**成片空白占位**，
 *   而且**空白位置每次随机变化**（同一页面两次截图，一次前 8 张空、一次后 5 张空）
 *   ⇒ 纯渲染竞态，不是样式问题、不是图片问题。
 *   `--run-all-compositor-stages-before-draw` / `--headless=new` 都治不了。
 *
 *   根治办法：走 CDP —— `Page.navigate` → 等 `load` → **在页面里 await 所有 img.decode()**
 *   → 再连续两帧 rAF → 才 `Page.captureScreenshot`。这样拍到的一定是画完的。
 *
 * 零依赖：只用 Node 22 内置的 `fetch` 与全局 `WebSocket`（无 puppeteer）。
 * 页面由 `_shot.py` 生成（它负责图片本地缓存与内联），本脚本只负责「拍」。
 *
 * 用法（一般由 _shot.py 调起）：
 *   node _shot.js <输出文件名.png>
 * 环境变量：SHOT_W / SHOT_H / SHOT_DIR / CDP_PORT / HEADLESS / SHOT_DELAY
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe';
const OUTDIR = process.env.SHOT_DIR || 'C:/Users/komo/.wb-shot';
const PAGE = path.join(DIR, '_shot_tmp.html');
const PNG = process.argv[2] || 'shot.png';
const W = process.env.SHOT_W || '1400';
const H = process.env.SHOT_H || '1500';
const PORT = Number(process.env.CDP_PORT || 9333);
const HL = process.env.HEADLESS || '--headless=new';
const DELAY = Number(process.env.SHOT_DELAY || 0);

/* ---------- 极简 CDP 客户端 ---------- */
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
      } else {
        subs.forEach((fn) => fn(m));
      }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 主流程 ---------- */
(async () => {
  if (!fs.existsSync(PAGE)) throw new Error('截图页不存在：' + PAGE + '（先跑 _shot.py）');
  fs.mkdirSync(OUTDIR, { recursive: true });

  const ch = spawn(CHROME, [
    HL, '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H,
    '--user-data-dir=' + path.join(OUTDIR, 'prof-cdp'),
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const pg = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { /* 端口还没起来 */ }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) { ch.kill(); throw new Error('CDP 端口未就绪（chrome 没起来？）'); }

  const c = await cdp(wsUrl);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    const loaded = new Promise((r) => c.on((m) => { if (m.method === 'Page.loadEventFired') r(); }));
    await c.send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(400);                        /* 让页内 resetState/render 先跑完 */

    /* ★ 核心：等所有图片解码完 + 两帧合成，再截图。
       ⚠️ 兜底超时不能太短：原值 4000ms 在 mNew（153 张图）这种量级下**不够**，
       实测出现 `153/6` —— 147 张还在解码，Promise.all 就先返回了，截图虽有内容但可能带空白。
       现在：单张兜底 20s + 之后按 200ms 轮询到全就绪或硬截止，输出才可信。 */
    const R = await c.send('Runtime.evaluate', {
      expression: `(async () => {
        const imgs = [].slice.call(document.querySelectorAll('#main img'));
        const ready = im => im.complete && im.naturalWidth > 0;
        const HARD = Date.now() + 30000;
        await Promise.all(imgs.map(im => new Promise(res => {
          if (ready(im)) { im.decode ? im.decode().then(res, res) : res(); return; }
          im.addEventListener('load', res, { once: true });
          im.addEventListener('error', res, { once: true });
          setTimeout(res, 20000);
        })));
        /* 兜底轮询：某些图 load 事件早于入树时会漏掉回调，这里再确认一遍 */
        while (Date.now() < HARD && imgs.some(im => !ready(im))) {
          await new Promise(r => setTimeout(r, 200));
        }
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const ok = imgs.filter(ready).length;
        return imgs.length + '/' + ok;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (DELAY) await sleep(DELAY);

    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUTDIR, PNG);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('[cdp] 图片就绪 ' + (R.result && R.result.value) + '  ->  ' + out +
      '  ' + fs.statSync(out).size);
  } finally {
    c.close();
    ch.kill();
  }
})().catch((e) => { console.error('[cdp] 失败：' + e.message); process.exit(1); });
