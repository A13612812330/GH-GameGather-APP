/**
 * _imgfit.js —— 图片适配审计的「量」那一步（走 CDP，真实时间等待）。
 *
 * 为什么不用 `chrome --headless --dump-dom --virtual-time-budget=N`（_device 实测）：
 *   虚拟时间会把 setTimeout 链瞬间快进，而图片解码是真实 IO ⇒ 探针还没采完
 *   就被 dump 了（症状：`<pre id="imgfit">` 根本没生成，dom 里只有原始页面）。
 *   换成 CDP + awaitPromise 后，等待是真实的（跟 _shot.js 同一个套路，已验证可行）。
 *
 * 页面由 `_imgfit.py` 生成（负责内联 data.js + 图片换本地缓存），本脚本只负责量。
 * 输出：一行 `###JSON###<json>` 到 stdout。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe';
const PAGE = process.env.IMG_PAGE || path.join(DIR, '_imgfit_tmp.html');
const W = process.env.IMG_W || '1440';
const H = process.env.IMG_H || '900';
const PORT = Number(process.env.CDP_PORT || 9341);
const TABS = (process.env.IMG_TABS ||
  'home,pcNew,pcHot,pcRank,pcTrainer,pcMod,mNew,mEvent,mPlay,report')
  .split(',').map(s => s.trim()).filter(Boolean);

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

const EXPR = `(async () => {
  const TABS = ${JSON.stringify(TABS)};
  const ready = im => im.complete && im.naturalWidth > 0;
  const out = [];

  function measure(tab) {
    return [].slice.call(document.querySelectorAll('#main img')).map(function (im, i) {
      const p = im.parentElement;
      const pr = p.getBoundingClientRect();
      const ir = im.getBoundingClientRect();
      const cs = getComputedStyle(im);
      return {
        t: tab, i: i, pc: (p.className || '').trim(), fit: cs.objectFit, pos: cs.objectPosition,
        bw: Math.round(pr.width * 10) / 10, bh: Math.round(pr.height * 10) / 10,
        iw: Math.round(ir.width * 10) / 10, ih: Math.round(ir.height * 10) / 10,
        nw: im.naturalWidth, nh: im.naturalHeight,
        src: (im.getAttribute('src') || '').split('/').pop()
      };
    });
  }

  async function settle() {
    const imgs = [].slice.call(document.querySelectorAll('#main img'));
    await Promise.all(imgs.map(im => new Promise(res => {
      if (ready(im)) { im.decode ? im.decode().then(res, res) : res(); return; }
      im.addEventListener('load', res, { once: true });
      im.addEventListener('error', res, { once: true });
      setTimeout(res, 10000);
    })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return imgs.length;
  }

  for (const t of TABS) {
    try { resetState(t); render(); } catch (e) { out.push({ t: t, err: String(e && e.message) }); continue; }
    await new Promise(r => setTimeout(r, 300));
    await settle();
    out.push.apply(out, measure(t));
  }
  return JSON.stringify(out);
})()`;

(async () => {
  if (!fs.existsSync(PAGE)) throw new Error('审计页不存在：' + PAGE + '（先跑 _imgfit.py 生成）');

  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H,
    '--user-data-dir=' + path.join(DIR, '_imgfit_prof'),
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
  if (!wsUrl) { ch.kill(); throw new Error('CDP 端口未就绪'); }

  const c = await cdp(wsUrl);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    const loaded = new Promise((r) => c.on((m) => { if (m.method === 'Page.loadEventFired') r(); }));
    await c.send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') });
    await Promise.race([loaded, sleep(20000)]);
    await sleep(500);
    const R = await c.send('Runtime.evaluate', {
      expression: EXPR, awaitPromise: true, returnByValue: true,
    });
    if (R.exceptionDetails) throw new Error('页内脚本异常：' + JSON.stringify(R.exceptionDetails).slice(0, 400));
    console.log('###JSON###' + (R.result && R.result.value));
  } finally {
    c.close();
    ch.kill();
  }
})().catch((e) => { console.error('[imgfit] 失败：' + e.message); process.exit(1); });
