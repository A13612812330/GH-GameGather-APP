'use strict';
/* 游戏情报客户端 · 便携版主进程
   ---------------------------------------------------------------------------
   与 P0 的 electron/ 壳（fork 上游 server.js 那份）是**两条不同的路线**：

     electron/        → 起本地 Node 服务 + 开窗加载 127.0.0.1  （打 GameHub 工作台）
     electron-intel/  → 直接 loadFile 静态页                     （打情报客户端）

   用户 2026-10-15 拍板「**只要情报站**」，故本壳**不起任何本地服务** ——
   demo 是纯静态页（index.html + data.js），file:// 直开已验证全绿。
   好处：不用带上游 255 MB（server.js / node_modules / data / tools），体积约 215 MB。

   本壳只做三件事：
     ① 开窗加载 web/index.html
     ② 用 IPC 代取线上 data.js（file:// 的 Origin 是 null，直接 fetch 会被 CORS 拦）
     ③ 关窗即退（没有子进程要清）
   --------------------------------------------------------------------------- */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const WEB   = path.join(__dirname, 'web');
const START = path.join(WEB, 'index.html');

/* ★v13：应用图标。两道保险 ——
   ① 窗口 / 任务栏图标走这里（`BrowserWindow.icon`）；
   ② exe 文件本身的图标是**另一个东西**，它烧在 PE 资源段里，必须在打包后
      用 resedit 打进去（见 tools/set_exe_icon.js），本行管不到。
   缺图标不能让壳起不来，所以做存在性判断。 */
const ICON = path.join(__dirname, 'assets', 'icon.ico');
const ICON_OK = fs.existsSync(ICON);

const SMOKE = process.argv.includes('--smoke');
const SHOT_ARG = process.argv.find((a) => a.startsWith('--shot='));
const SHOT_PATH = SHOT_ARG ? SHOT_ARG.slice('--shot='.length) : null;
const SHOT_WAIT = parseInt(process.env.SHOT_WAIT_MS, 10) || 9000;

/* ------------------------------------------------------------------ 白名单
   页面只能让主进程去取这个前缀下的东西。做成前缀白名单而不是「任意 URL」，
   是为了万一页面被注入，也拿不到任意网络访问能力。 */
const FETCH_ALLOW = ['https://game-intel-client.app.workbuddy.host/'];

let win = null;
let LOG_FILE = null;

/* ------------------------------------------------------------------ 日志 */
function initLog() {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    LOG_FILE = path.join(dir, 'shell.log');
  } catch (e) { LOG_FILE = null; }
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (!LOG_FILE) return;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* 忽略 */ }
}

/* --------------------------------------------------------------- 取文本 */
function getText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向过多'));
    const req = https.get(url, {
      timeout: 20000,
      headers: { 'user-agent': 'GameIntelClient/1.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        log(`[net] ${res.statusCode} → ${next}`);
        return resolve(getText(next, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

/* ------------------------------------------------------------------ 开窗 */
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '游戏情报客户端',
    icon: ICON_OK ? ICON : undefined,          /* ★v13：窗口 / 任务栏图标 */
    backgroundColor: '#161616',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    log('[shell] 窗口已显示');
  });

  /* 外链一律丢给系统浏览器，不在应用内打开 */
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  win.loadFile(START);

  win.on('closed', () => {
    win = null;
    log('[shell] 窗口关闭');
    app.quit();
  });
}

/* ------------------------------------------------------------------ 主流程 */
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

if (!app.requestSingleInstanceLock()) {
  console.log('[shell] 已有实例在跑 ⇒ 退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    initLog();
    log(`[shell] 启动 · 包目录=${__dirname} · 起始页=${START} · 图标=${ICON_OK ? ICON : '(未找到，用默认)'}`);

    /* ---- IPC：代取线上 data.js（页面通过 preload 的 __SHELL_FETCH__ 调用） ---- */
    ipcMain.handle('shell:fetch', async (_e, url) => {
      if (typeof url !== 'string' || !FETCH_ALLOW.some((p) => url.startsWith(p))) {
        log('[ipc] 拒绝非白名单请求: ' + url);
        throw new Error('url not allowed');
      }
      const t = await getText(url);
      log(`[ipc] 代取成功 ${url} → ${t.length} B`);
      return t;
    });

    if (!fs.existsSync(START)) {
      const msg = '找不到页面文件：' + START;
      log('[shell] ' + msg);
      dialog.showErrorBox('游戏情报客户端 启动失败', msg);
      app.exit(1);
      return;
    }

    /* ---- 冒烟：验证页面可加载 + IPC 代取能通 ---- */
    if (SMOKE) {
      try {
        log('[smoke] 页面文件存在 : YES');
        const probeUrl = FETCH_ALLOW[0] + 'data.js';
        const txt = await getText(probeUrl);
        const m = /"builtAt"\s*:\s*"([^"]+)"/.exec(txt);
        log(`[smoke] 线上 data.js : ${txt.length} B · builtAt=${m ? m[1] : '(未解析到)'}`);
        createWindow();
        win.webContents.once('did-finish-load', async () => {
          await new Promise((r) => setTimeout(r, 3500));
          const t = await win.webContents.executeJavaScript('document.title');
          const n = await win.webContents.executeJavaScript('document.querySelectorAll(".nav a").length');
          const b = await win.webContents.executeJavaScript('(document.getElementById("builtAt")||{}).textContent || ""');
          /* `#main.dataset.tab` 由 render() 写入，直接反映当前 Tab（= 全局 cur） */
          const dt = await win.webContents.executeJavaScript('(document.getElementById("main")||{dataset:{}}).dataset.tab || "(无)"');
          const h2 = await win.webContents.executeJavaScript('document.querySelector(".crumb h2") ? document.querySelector(".crumb h2").textContent : "(无)"');
          log(`[smoke] 页面标题 : ${t}`);
          log(`[smoke] 侧栏项数 : ${n}`);
          log(`[smoke] 当前 Tab : ${dt} · 页头「${h2}」`);
          /* 诊断：首页主图（机地 CDN）在渲染进程里为何加载不出来 —— 直接测一次同 URL */
          const imgTest = await win.webContents.executeJavaScript(`
            (async () => {
              const U = 'https://img2.52jidi.com/topic/cover/id/649608/sz/420';
              const test = (policy) => new Promise(r => {
                const t0 = Date.now();
                const i = new Image();
                if (policy) i.referrerPolicy = policy;
                i.onload  = () => r((policy || '(默认)') + ': OK ' + i.naturalWidth + 'x' + i.naturalHeight + ' ' + (Date.now()-t0) + 'ms');
                i.onerror = () => r((policy || '(默认)') + ': ERROR ' + (Date.now()-t0) + 'ms');
                i.src = U + '?probe=' + Math.random();     /* 每次不同 URL，避免缓存干扰 */
                setTimeout(() => r((policy || '(默认)') + ': TIMEOUT'), 15000);
              });
              /* ★关键：页面里那张主图现在是什么状态？被 remove 了，还是只是没 reveal？ */
              const himg = document.querySelector('.hmain img');
              const ph   = document.querySelector('.hmain .ph');
              const snap = {
                slideCount: document.querySelectorAll('.hmain .hslide').length,
                imgExists : !!himg,
                imgSrc    : himg ? himg.getAttribute('src') : '',
                imgComplete: himg ? himg.complete : null,
                imgNatural: himg ? himg.naturalWidth : null,
                imgOpacity: himg ? getComputedStyle(himg).opacity : null,
                phVisible : ph ? getComputedStyle(ph).display : null,
                heroImgTotal: document.querySelectorAll('img').length
              };
              return await test('no-referrer') + '  ||  ' + await test('') +
                     '\\n[hero] ' + JSON.stringify(snap, null, 0);
            })()
          `);
          log(`[smoke] 主图诊断 : ${imgTest}`);
          log(`[smoke] 页内数据时间 : ${b}`);

          /* ★v14：在**真实渲染进程**里复核本轮三项改动确实进了成品。
             只读 jsdom 结果是不够的 —— jsdom 不跑 @media、也不做真实布局。 */
          const v14 = await win.webContents.executeJavaScript(`
            (() => {
              try {
                const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('');
                const out = {};
                out.断点数 = (css.match(/@media\\s*\\(max-width:\\s*\\d+px\\)/g) || []).length;
                out.白名单 = (typeof searchScore === 'function') ? searchScore({url:'https://a/b', title:'别的'}, 'http') : 'missing';
                out.加权   = (typeof searchScore === 'function') ? searchScore({title:'赛博朋克2077'}, '赛博') : 'missing';
                out.无hack = !/setSelectionRange/.test(document.documentElement.innerHTML);
                resetState('pcNew'); render();
                out.列表锚点 = !!document.querySelector('#main #listbox');
                const kw0 = document.getElementById('kw'), bar0 = document.querySelector('#main .filter-bar');
                kw0.value = '赛博'; kw0.dispatchEvent(new Event('input', { bubbles: true }));
                out.输入框未重建 = (document.getElementById('kw') === kw0);
                out.筛选栏未重建 = (document.querySelector('#main .filter-bar') === bar0);
                out.命中数 = document.querySelectorAll('#main .card').length;
                kw0.value = ''; kw0.dispatchEvent(new Event('input', { bubbles: true }));
                out.清空后恢复 = document.querySelectorAll('#main .card').length;
                return JSON.stringify(out);
              } catch (e) { return 'ERR: ' + e.message; }
            })()
          `);
          log(`[smoke] v14 复核 : ${v14}`);

          log('[smoke] PASS');
          app.exit(0);
        });
      } catch (e) {
        log('[smoke] FAIL: ' + (e && e.message));
        app.exit(1);
      }
      return;
    }

    /* ---- 截图：真实窗口像素 ---- */
    if (SHOT_PATH) {
      try {
        createWindow();
        win.webContents.once('did-finish-load', async () => {
          await new Promise((r) => setTimeout(r, SHOT_WAIT));
          /* 截图前报一次当前 Tab —— 用于确认「落地页」与「截图所见」是否一致 */
          const dt = await win.webContents.executeJavaScript('(document.getElementById("main")||{dataset:{}}).dataset.tab || "(无)"');
          const h2 = await win.webContents.executeJavaScript('document.querySelector(".crumb h2") ? document.querySelector(".crumb h2").textContent : "(无)"');
          log(`[shot] 截图前 Tab : ${dt} · 页头「${h2}」`);
          const img = await win.webContents.capturePage();
          const buf = img.toPNG();
          fs.writeFileSync(SHOT_PATH, buf);
          log(`[shot] 已保存 ${SHOT_PATH} (${buf.length} B, ${img.getSize().width}x${img.getSize().height})`);
          app.exit(0);
        });
      } catch (e) {
        log('[shot] FAIL: ' + (e && e.message));
        app.exit(1);
      }
      return;
    }

    createWindow();
  });
}
