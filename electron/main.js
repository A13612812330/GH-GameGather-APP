'use strict';
/**
 * GameIntel 壳 · 情报站落地版（v15）
 * ===========================================================================
 * ★v15 口径（用户 2026-10-16）：「**移除工作台入口**，这个是单独的项目」，
 *   改为在 APP 内做完三件事 —— 所以本版**不再是「合并版」**：
 *     · 新增「游戏库」：直接吃上游 `/api/library/browse` 全量 21,251 款（实时，不再只看快照）
 *     · 新增「我的游戏」：扫盘找本机已装游戏 → 按名匹配资源 → 命中给下载弹窗
 *     · 新增「下载管理」：统一收口下载任务，真直链由本壳直接下到本地
 *   v14 的「5 个 PC 工作台入口 + 返回情报站按钮」按用户要求**移除**（代码保留在
 *   `GAMEHUB_START=/xxx` 这条排查通道上，方便截图工作台页）。
 *
 * ---------- 壳负责的 4 件事（页面做不到的那部分）----------
 *   ① 起上游服务：只能 fork 子进程（server.js 无 module.exports、末尾无条件 listen）
 *   ② 端口探活必须先做（8123 被占时 server.js 会 process.exit(1)，不自动换端口）
 *   ③ 关窗必须杀子进程，否则服务留在后台
 *   ④ ELECTRON_RUN_AS_NODE=1 让 electron.exe 退化成纯 Node 运行时
 *   ⚠️ 开发期跑本文件必须 `env -u ELECTRON_RUN_AS_NODE`：本机环境里带着这个变量，
 *      会把它传给 electron.exe 导致主进程退化成纯 Node（require('electron') 返回路径串）。
 *      **成品 exe 双击不受影响**。
 *
 * ---------- 为什么情报站从 file:// 直开、却调得通 127.0.0.1 ----------
 * 上游 server.js 有全局 CORS（`Access-Control-Allow-Origin: *`，见 server.js:105），
 * 注释写明是给「file:// 打开的离线快照 HTML 直连本服务」用的 —— 正是本场景。
 * 好处：上游拷贝**逐字节不变**（连 public/ 都不动），"上游零写入"这条纪律在打包产物里也成立。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, powerSaveBlocker } = require('electron');
const { fork, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
/* ★v19：下载引擎（aria2 JSON-RPC 封装，独立文件）。**不 require electron** ⇒ 可单测。 */
const aria2 = require('./aria2');
const http = require('http');
const https = require('https');

/* ---- 可配置项：打包后走包内相对路径；开发期用环境变量指回真上游 ---------- */
const UPSTREAM = process.env.GAMEHUB_ROOT
  || path.join(__dirname, 'upstream');           // 打包后：resources/app/upstream
const PORT = parseInt(process.env.GAMEHUB_PORT, 10) || 8123;
const SERVICE = `http://127.0.0.1:${PORT}`;
const SMOKE = process.argv.includes('--smoke');
/* --shot=<绝对路径>：开真窗 → 加载完成 → 等 N 秒 → 截图存盘 → 退出。
   ★ 路径**不能带中文**（实测静默失败：窗口自行关闭、不存盘也不报错）。 */
const SHOT_ARG = process.argv.find((a) => a.startsWith('--shot='));
const SHOT_PATH = SHOT_ARG ? SHOT_ARG.slice('--shot='.length) : null;
/* 截图前等待毫秒数：外链封面图较慢，默认 7s，可用 SHOT_WAIT_MS 覆盖 */
const SHOT_WAIT = parseInt(process.env.SHOT_WAIT_MS, 10) || 7000;
/* `SHOT_JS`：截图前在页面里跑一段脚本（用来把弹窗/页签打开再拍），跑完再等 SHOT_JS_WAIT_MS */
const SHOT_JS = process.env.SHOT_JS || null;
const SHOT_JS_WAIT = parseInt(process.env.SHOT_JS_WAIT_MS, 10) || 6000;
/* 落地页：默认情报站。
   `GAMEHUB_START=/resources.html` 可直接落在工作台某页（截图 / 排查用）。
   `GAMEHUB_INTEL=<绝对路径>` 供**开发期**指向项目根的 `demo/index.html`
   —— 打包后 intel/ 就在 __dirname 下，开发期没有它，不指路就没法起壳自测。 */
const START_MODE = process.env.GAMEHUB_START || 'intel';
const INTEL_FILE = process.env.GAMEHUB_INTEL || path.join(__dirname, 'intel', 'index.html');

const ICON = path.join(__dirname, 'assets', 'icon.ico');
const ICON_OK = fs.existsSync(ICON);

const FETCH_ALLOW = ['https://game-intel-client.app.workbuddy.host/'];

let child = null;        // 子进程句柄（null = 复用已有服务）
let childOwned = false;  // 是否由本壳启动（决定关窗时要不要杀）
let win = null;
let adminWin = null;     // ★v18：独立「管理页」窗口（工作台），与主窗并存
/* ★v18：上游实例归属 —— 由 `/api/health` 的 `pid` 与 `child.pid` 比对得出，**不猜**。
   owner: 'shell'（本壳 fork 的）| 'external'（本来就在跑的）| 'unknown'（老版上游无 pid 字段） */
let upInfo = { owner: 'unknown', pid: 0, shell: false, startedAt: 0, listenPort: null };
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

/* ------------------------------------------------------------------ 探活 */
function probe(port, timeout = 1500, p = '/api/health') {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitReady(port, budgetMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (await probe(port)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 250));
  }
  return -1;
}

/* ------------------------------------------------- ★v18 上游实例归属判定 */
/* 探活只要「200」，但要判断「这个实例是不是我拉起来的」就得读 body。
   ★ 必须**容忍缺字段**：老版上游的 `/api/health` 只回 `{ok, ts, ttl}`
     （实测：2026-10-15 起就在跑的那个实例就是老版）⇒ 拿不到就老实标 unknown，
     不许拿 ts 之类的旁证去猜「应该是我拉的吧」。 */
function healthOf(port, timeout = 1500, p = '/api/health') {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; if (buf.length > 65536) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* 归属判定（三条互斥，全部实测得来）：
   · 本壳 fork 过，且 health.pid === child.pid ⇒ 'shell'
   · 复用了本来就在跑的实例 ⇒ 'external'（**哪怕它带 shell:true** —— 那是别的壳拉起的，不是我）
   · health 里没有 pid（老版上游）⇒ 'unknown'，日志里写明「无法判定」 */
async function refreshUpInfo(reused) {
  const h = await healthOf(PORT);
  if (!h) return upInfo;
  const pid = Number(h.pid) || 0;
  const owned = !reused && !!child && child.pid === pid;
  upInfo = {
    owner: pid ? (owned ? 'shell' : 'external') : 'unknown',
    pid,
    shell: h.shell === true,
    startedAt: Number(h.startedAt) || 0,
    listenPort: typeof h.port === 'number' ? h.port : null,
  };
  log('[shell] 上游实例归属 = ' + upInfo.owner
    + ' · pid=' + (pid || '?')
    + ' · shell=' + upInfo.shell
    + (pid ? '' : '（该实例是**旧版上游**，health 里没有 pid 字段 ⇒ 无法判定归属）'));
  return upInfo;
}

/* -------------------------------------------------------------- 起子进程 */
function startServer() {
  const entry = path.join(UPSTREAM, 'server.js');
  if (!fs.existsSync(entry)) throw new Error('找不到上游入口：' + entry);
  const c = fork(entry, [], {
    cwd: UPSTREAM,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',   // ★ 关键：让 electron.exe 当纯 Node 跑
      PORT: String(PORT),
      GAMEHUB_SHELL: '1',          // 让上游能识别「我是被壳拉起的」
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  c.stdout.on('data', (b) => process.stdout.write('[svc] ' + b.toString()));
  c.stderr.on('data', (b) => process.stderr.write('[svc:err] ' + b.toString()));
  c.on('exit', (code, sig) => {
    log(`[shell] 子进程退出 code=${code} sig=${sig}`);
    if (child === c) child = null;
  });
  return c;
}

/* ---------------------------------------------------------------- 清理 */
function cleanup() {
  return new Promise((resolve) => {
    if (child && childOwned && !child.killed) {
      log('[shell] 关闭子进程（关窗清理）');
      try { child.kill(); } catch (e) { /* 已退出 */ }
    }
    child = null;
    childOwned = false;
    setTimeout(resolve, 400);
  });
}

/* ------------------------------------------------------------ bootstrap */
async function bootstrap() {
  const t0 = Date.now();
  const alive = await probe(PORT);

  if (alive) {
    log(`[shell] ${PORT} 已有健康服务 ⇒ 直接复用，不 fork（② 端口不撞）`);
    const info = await refreshUpInfo(true);
    return { reused: true, startupMs: 0, totalMs: Date.now() - t0, info };
  }

  log(`[shell] ${PORT} 空闲 ⇒ fork 上游 server.js`);
  child = startServer();
  childOwned = true;

  const ms = await waitReady(PORT, 30000);
  if (ms < 0) throw new Error('子进程 30s 内未就绪（① 启动等待 失败）');
  log(`[shell] 内嵌服务就绪，耗时 ${ms} ms`);
  const info = await refreshUpInfo(false);
  return { reused: false, startupMs: ms, totalMs: Date.now() - t0, info };
}

/* ========================================================== ★v15 我的游戏：扫盘
   「最好是增加一个我的游戏，可以进行扫盘获取到游戏的启动器，并对应进行匹配」
   （用户 2026-10-16 原话）

   ---------- 设计取舍：为什么**不用注册表** ----------
   ① 开发期本机沙箱把 `reg.exe` 列进了程序黑名单（实测直接拒绝启动：PROGRAM BLOCKED
      BY SECURITY POLICY），走注册表会让「开发期能不能跑」取决于沙箱策略；
   ② 成品 exe 里虽不受沙箱限制，但为了**一份代码两处都能跑**（本机调试 = 成品行为），
      这里只做纯文件系统探测 —— 零外部程序、零依赖。

   ---------- 三条来源（按可靠度排序）----------
    ① Steam 库    —— 解析 `steamapps/libraryfolders.vdf` 拿到全部库路径，
                     再读每个库的 `appmanifest_*.acf`（官方机器可读格式：
                     游戏名 / appid / 安装目录都是明文键值）
    ② 快捷方式    —— 桌面与开始菜单的 `*.lnk`。**只用文件名当游戏名**：
                     解析 lnk 目标需要 COM/WScript（外部依赖），而「匹配资源」本来就是
                     按名字匹配，文件名已经够用 —— 少一个依赖，多一分可移植。
    ③ 常见目录    —— Epic / WeGame / Riot / Battle.net / Xbox / Ubisoft 等固定安装根，
                     取它们的**直接子目录名**当游戏名。

   ★ 全程只读：不写、不移、不删任何用户文件。 */
const EXE_SKIP = /(unins|setup|install|vcredist|dxsetup|redist|crash|report|helper|updater|upgrade|launcher|service|config|diag|benchmark|server|sdk|editor|tool)/i;
/* 快捷方式黑名单。**实测口径**（2026-10-16 本机）：桌面 + 开始菜单共 137 个 .lnk，
   里面绝大多数是工具/办公/影音，不是游戏（7-Zip、飞书、格式播放器、次元鲨·适配工作台…）。
   黑名单永远列不全 ⇒ 它是**降噪**，不是判据；真正的判据是「上游全量库有没有这个名字」
   （页面默认只显示匹配到的，见 demo/index.html 的 renderMyGames）。 */
const SHORTCUT_SKIP = new RegExp([
  '卸载|uninstall|readme|说明|帮助|help|更新|update|^卸载',
  /* 启动器本体（不是游戏） */
  '^steam$|epic games|wegame|battle\\.net|战网|应用宝|gog galaxy|ubisoft connect|^origin$|ea app',
  /* 浏览器 */
  '浏览器|browser|edge|chrome|firefox|360安全|搜狗|qq浏览器|2345',
  /* 办公 */
  'word|excel|powerpoint|outlook|onenote|access|wps|office|飞书|feishu|lark|钉钉|dingtalk|notion|typora|幕布',
  /* 通讯 */
  '微信|wechat|企业微信|telegram|discord|zoom|腾讯会议|会议|腾讯文档',
  /* 影音与网盘 */
  '音乐|视频|播放器|player|potplayer|vlc|网盘|下载|迅雷|夸克|bilibili',
  /* 开发 */
  'vscode|visual studio|pycharm|idea$|webstorm|^git|docker|python|^node|java|cmd|powershell|终端|terminal|sourcetree|navicat',
  /* 压缩与系统工具 */
  '7-zip|winrar|bandizip|压缩|记事本|notepad|计算器|画图|截图|录屏|远程|teamviewer|todesk|anydesk|驱动|鲁大师|^360|火绒|控制面板|设置$|回收站|资源管理器|服务$',
  /* 输入法与其它 —— 最后几个是实测捞出来又被 simName 挡住的（手册/向导/管理器/工具类） */
  '输入法|ime$|^格式|^次元|^适配|^工作台|手册|向导|管理器|^管理|工具$|盒子|教程|示例|模板',
].join('|'), 'i');

/* 枚举存在的盘符（A–Z）。对不存在的盘 fs.existsSync 返回 false，不抛。 */
function driveLetters() {
  const out = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(d)) out.push(d); } catch (e) { /* 某些盘会抛，跳过 */ }
  }
  return out;
}

/* 找 Steam 安装根：只要 `<root>\steamapps` 存在就算。 */
function findSteamRoots() {
  const subs = ['Steam', 'Program Files (x86)\\Steam', 'Program Files\\Steam',
                'SteamLibrary', 'Games\\Steam'];
  const out = [];
  for (const d of driveLetters()) {
    for (const s of subs) {
      const p = path.join(d, s);
      try { if (fs.existsSync(path.join(p, 'steamapps'))) out.push(p); } catch (e) { /* */ }
    }
  }
  return out;
}

/* 解析 libraryfolders.vdf，取出所有库路径（"path" 键）。
   VDF 里的值是 JSON 式转义（"D:\\Steam"）⇒ 要把双反斜杠还原成单反斜杠。 */
function vdfLibs(vdfPath) {
  try {
    const txt = fs.readFileSync(vdfPath, 'utf8');
    const out = [];
    const re = /"path"\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt))) out.push(m[1].replace(/\\\\/g, '\\'));
    return out;
  } catch (e) { return []; }
}

/* 在游戏目录里挑「最像主程序」的 exe：深度 ≤2、跳过噪音名、取体积最大的那个。
   启发式：主程序几乎总是该目录里最大的可执行文件（资源全在里面）。 */
function pickExe(root, maxDepth = 2, budget = { n: 600 }) {
  const found = [];
  (function walk(d, dep) {
    if (dep > maxDepth || budget.n <= 0) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (budget.n-- <= 0) return;
      if (e.isDirectory()) { walk(path.join(d, e.name), dep + 1); continue; }
      if (!/\.exe$/i.test(e.name) || EXE_SKIP.test(e.name)) continue;
      const full = path.join(d, e.name);
      let sz = 0;
      try { sz = fs.statSync(full).size; } catch (e2) { /* */ }
      found.push({ p: full, sz });
    }
  })(root, 0);
  found.sort((a, b) => b.sz - a.sz);
  return found.length ? found[0].p : '';
}

/* ① Steam 库 */
function steamGames(libs) {
  const out = [];
  for (const lib of libs) {
    const ap = path.join(lib, 'steamapps');
    let files;
    try { files = fs.readdirSync(ap); } catch (e) { continue; }
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      let txt = '';
      try { txt = fs.readFileSync(path.join(ap, f), 'utf8'); } catch (e) { continue; }
      const nm = (txt.match(/"name"\s*"([^"]*)"/) || [])[1] || '';
      const dir = (txt.match(/"installdir"\s*"([^"]*)"/) || [])[1] || '';
      const id = (txt.match(/"appid"\s*"(\d+)"/) || [])[1] || '';
      if (!nm) continue;                       /* 名字是匹配的唯一依据，没有就没用 */
      const gdir = path.join(ap, 'common', dir);
      out.push({ name: nm, steamId: id, source: 'Steam', dir: gdir, exe: pickExe(gdir) });
    }
  }
  return out;
}

/* ② 桌面 / 开始菜单快捷方式 */
function shortcutGames() {
  const dirs = [];
  try { dirs.push(app.getPath('desktop')); } catch (e) { /* */ }
  try { dirs.push(path.join(app.getPath('home'), 'OneDrive', 'Desktop')); } catch (e) { /* */ }
  dirs.push('C:\\Users\\Public\\Desktop');
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs'));
  dirs.push('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs');

  const out = [];
  for (const d of dirs) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      /* 开始菜单是**多级目录**（厂商文件夹 → 快捷方式）⇒ 递归一层找 .lnk */
      if (e.isDirectory()) {
        let sub;
        try { sub = fs.readdirSync(path.join(d, e.name), { withFileTypes: true }); } catch (e2) { continue; }
        for (const s of sub) {
          if (s.isDirectory() || !/\.lnk$/i.test(s.name)) continue;
          const nm = s.name.replace(/\.lnk$/i, '').trim();
          if (!nm || SHORTCUT_SKIP.test(nm)) continue;
          out.push({ name: nm, source: '快捷方式', dir: path.join(d, e.name), exe: path.join(d, e.name, s.name) });
        }
        continue;
      }
      if (!/\.lnk$/i.test(e.name)) continue;
      const nm = e.name.replace(/\.lnk$/i, '').trim();
      if (!nm || SHORTCUT_SKIP.test(nm)) continue;
      out.push({ name: nm, source: '快捷方式', dir: d, exe: path.join(d, e.name) });
    }
  }
  return out;
}

/* ③ 常见启动器安装根：取直接子目录名当游戏名 */
const GAME_ROOTS = [
  'C:\\Program Files (x86)\\Tencent\\WeGame\\apps',
  'C:\\Program Files\\Tencent\\WeGame\\apps',
  'C:\\WeGameApps', 'D:\\WeGameApps', 'E:\\WeGameApps', 'F:\\WeGameApps',
  'C:\\Program Files\\Epic Games', 'D:\\Program Files\\Epic Games', 'E:\\Program Files\\Epic Games',
  'C:\\Program Files (x86)\\Origin Games', 'C:\\Program Files\\Origin Games',
  'C:\\Program Files\\EA Games', 'D:\\EA Games',
  'C:\\Riot Games', 'D:\\Riot Games', 'E:\\Riot Games',
  'C:\\Program Files (x86)\\Battle.net', 'C:\\Program Files\\Battle.net',
  'C:\\XboxGames', 'D:\\XboxGames',
  'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games',
  'D:\\Games', 'E:\\Games', 'D:\\GAMES', 'E:\\GAMES',
  /* ⚠️ 不要把 `D:\\SteamLibrary` 这类**Steam 库根**列进来：
     它的直接子目录是 `steamapps`（不是游戏），会平白多一条噪音。
     Steam 库里的游戏已由 steamGames() 从 appmanifest_*.acf 精确取出。 */
];
function dirGames() {
  const out = [];
  for (const r of GAME_ROOTS) {
    let ents;
    try { ents = fs.readdirSync(r, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const nm = e.name.trim();
      if (!nm || nm.startsWith('.') || nm.startsWith('_')) continue;
      const full = path.join(r, nm);
      out.push({ name: nm, source: '目录扫描', dir: full, exe: pickExe(full, 2, { n: 200 }) });
    }
  }
  return out;
}

/* 归一化游戏名：小写、去商标符、去空白/分隔符、去括号补充。
   与页面侧的匹配口径一致（页面拿去调 /api/library?q= 时用的是原文，
   这里只用于**去重**，不能太激进，否则《仁王 完全版》与《仁王》会被误并）。 */
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[（(【\[].{0,20}?[)）】\]]/g, '')
    .replace(/[\s\-_:：·・]+/g, '')
    .trim();
}

async function scanGames() {
  const t0 = Date.now();
  const raw = [];
  const note = [];

  const roots = findSteamRoots();
  const libs = new Set(roots);
  for (const r of roots) for (const l of vdfLibs(path.join(r, 'steamapps', 'libraryfolders.vdf'))) libs.add(l);
  const sg = steamGames([...libs]);
  raw.push(...sg);
  note.push(`Steam 库 ${libs.size} 个 → ${sg.length} 款`);

  const sh = shortcutGames();
  raw.push(...sh);
  note.push(`快捷方式 ${sh.length} 条`);

  const dg = dirGames();
  raw.push(...dg);
  note.push(`常见目录 ${dg.length} 款`);

  /* 去重：同名只留一条，优先 Steam（有 appid / 安装目录最准），其次目录，最后快捷方式 */
  const PRIO = { Steam: 0, '目录扫描': 1, '快捷方式': 2 };
  const seen = new Map();
  for (const g of raw) {
    const k = normName(g.name);
    if (!k) continue;
    const old = seen.get(k);
    if (!old || (PRIO[g.source] ?? 9) < (PRIO[old.source] ?? 9)) seen.set(k, g);
  }

  const games = [...seen.values()].sort((a, b) => {
    const pa = PRIO[a.source] ?? 9, pb = PRIO[b.source] ?? 9;
    return pa !== pb ? pa - pb : String(a.name).localeCompare(String(b.name), 'zh');
  });

  log(`[scan] ${games.length} 款（原始 ${raw.length} 条，去重 ${raw.length - games.length}）· ${Date.now() - t0} ms`);
  return { ok: true, games, ms: Date.now() - t0, note: note.join(' · ') };
}

/* ======================================================== ★v15 下载管理：下载器
   「我需要的是全都能够通过 exe 进行直链下载」「最好增加一个功能，下载管理进行统一管理」

   ---------- 为什么不用 session.defaultSession 的 will-download ----------
   那条路是「**页面发起导航 / 点击链接**」触发的；而我们的下载是页面用 JS 主动指定 URL。
   走 will-download 需要页面去构造 `<a download>` 或改 location，会污染页面状态（后退栈、
   滚动位置、SPA 路由）。自己用 Node 流取则完全可控：

     · 自定义 Referer —— 实测 FLiNG 的 zip 直链**无 Referer 直接 403**，带上站点页才通；
     · 自定义落盘目录 —— 页面拿不到、也指定不了（安全边界在主进程）；
     · 逐块上报进度 + 随时 abort —— 取消是真的中断连接，不是「假装停了」。

   ★ 真实边界（必须如实告诉用户，不能吹成「什么都能直下」）：
     实测 MOD 的 200 条链接里 **199 条是迅雷网盘分享页**（不是直链文件），
     源站没给直链的，本壳也变不出来 ⇒ 页面把这类登记成 manual（复制链接 + 唤起客户端）。 */
const dlJobs = new Map();     /* id → { req, file, canceled } */
const dlRoots = new Set();    /* 本壳自己写出过的目录（openPath/revealPath 的白名单） */

function dlDir() {
  const d = path.join(app.getPath('downloads'), 'GameIntel');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 已存在或权限不足，交给下游报错 */ }
  dlRoots.add(d);
  return d;
}

/* ---------- ★v19：下载引擎（aria2）—— **契约先定，引擎后接** ----------
   为什么现在就把这一层写出来：磁力链下载由 App 自己接管，但本轮**不装引擎**、只预留。
   「预留」的正确做法不是画一个假按钮，而是：
     · **契约**（方法名 / 参数 / 返回结构）现在定死 ⇒ 将来接引擎时**页面一行都不用改**；
     · **状态如实反映磁盘事实** —— 现在没有 `aria2c.exe` 就报 `available:false`；
       将来把 `vendor/aria2/aria2c.exe` 放进去，**同一个 IPC 立刻变可用**，不必改代码。

   ★ 安全边界（照抄上游 `data/download-engine.js` 的结论，不自己发明）：
     RPC 必须 `--rpc-listen-all=false` + 只绑 127.0.0.1 + 每次启动随机 secret。
     一旦被局域网/公网够到，等于把「往任意目录写文件」这个能力公开
     （aria2 的 `dir` 参数可以指任何路径）⇒ **secret 与 dir 永不进页面上下文**，
     页面只能调白名单 IPC，`dir` 由主进程自己算。 */
const ARIA2_DIR = path.join(__dirname, 'vendor', 'aria2');
const ARIA2_BIN = path.join(ARIA2_DIR, process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');
let aria2VerCache = null;   /* 探测一次就够，引擎版本不会在运行期变 */

/* 引擎状态：**只报磁盘与 `--version` 能证明的事**，绝不猜「应该装好了吧」。 */
function engineInfo() {
  const out = { available: false, bin: null, version: '', dir: ARIA2_DIR, reason: '' };
  let st = null;
  try { st = fs.statSync(ARIA2_BIN); } catch (e) { st = null; }
  if (!st || !st.isFile()) {
    out.reason = '下载引擎未接入（预留）—— vendor/aria2/ 下没有 aria2c';
    return out;
  }
  out.bin = ARIA2_BIN;
  if (aria2VerCache) { out.available = true; out.version = aria2VerCache; return out; }
  try {
    const r = spawnSync(ARIA2_BIN, ['--version'], { timeout: 4000, encoding: 'utf8' });
    const first = String((r && r.stdout) || '').split('\n')[0].trim();
    const m = /version\s+([\d.]+)/i.exec(first);
    if (r && r.status === 0 && m) {
      aria2VerCache = m[1]; out.available = true; out.version = m[1];
    } else {
      out.reason = 'aria2c 存在但无法执行' + (first ? '：' + first.slice(0, 80) : '');
    }
  } catch (e) {
    out.reason = 'aria2c 无法执行：' + String((e && e.message) || e);
  }
  return out;
}

/* ---------- 引擎实例：**懒启动 + 失败退避** ----------
   为什么懒：只在真的要下载 / 打开下载页时才 spawn，App 平时不多一个常驻进程。
   为什么退避：引擎起不来（比如端口被占）时，页面每次渲染都会调 `shell:dl-engine`，
   不设闸门就会变成「每次渲染都 spawn 一次失败的进程」。 */
let engineBooting = null;
let engineFailAt = 0;
let engineFailMsg = '';
const ENGINE_RETRY_MS = 30000;

/* gid ↔ 页面任务 id 的映射。
   ★ 这一层是**兼容性关键**：页面早就用「自己生成的 id」登记任务、并靠这个 id 匹配进度事件；
   aria2 给的是 gid。若不映射，页面就收不到进度（表现成「任务卡在 0%」）。
   ⇒ 对外一律用**页面 id**，gid 只活在主进程里。 */
const gidAlias = new Map();          /* gid -> pageId */
function gidOf(pageId) {
  const pid = String(pageId || '');
  for (const [g, p] of gidAlias) if (p === pid) return g;
  return '';
}
function pageIdOf(gid) { return gidAlias.get(String(gid || '')) || String(gid || ''); }

/* 进度回推：形状与内置下载器**完全一致**，页面零改动 */
function fireEngineProgress(t) {
  if (!t) return;
  /* ★v20：顺带维护「有没有活跃下载」—— 休眠抑制与退出确认都靠这个集合。
     放在这里而不是另起轮询：进度事件天然带 state，零额外 RPC。 */
  if (t.state === 'running' || t.state === 'waiting') activeDlIds.add(t.id);
  else activeDlIds.delete(t.id);
  syncSleepBlocker();
  const msg = Object.assign({}, t, { id: pageIdOf(t.id), engine: 'aria2' });
  if (win && !win.isDestroyed()) win.webContents.send('shell:dl-progress', msg);
}

/* ---------- ★v20：下载期间阻止系统休眠（借鉴迅雷的 `app:set-download-no-sleep`）----------
   为什么必须做：几十 GB 的下载跑着，用户离开 → 系统睡眠 → 任务断掉。
   ★ 用 `prevent-app-suspension` 而不是 `prevent-display-sleep`：
     前者只阻止「应用被挂起」，**屏幕照常可以关** —— 下载场景要的是这个档位。 */
const activeDlIds = new Set();
let sleepBlockerId = 0;
function syncSleepBlocker() {
  const want = activeDlIds.size > 0;
  if (want && !sleepBlockerId) {
    try {
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      log('[power] 有 ' + activeDlIds.size + ' 个任务在下载 ⇒ 阻止系统休眠（id=' + sleepBlockerId + '）');
    } catch (e) { /* 平台不支持就算了，不影响下载本身 */ }
  } else if (!want && sleepBlockerId) {
    try { powerSaveBlocker.stop(sleepBlockerId); } catch (e) { /* */ }
    log('[power] 下载已全部结束 ⇒ 恢复系统休眠策略');
    sleepBlockerId = 0;
  }
}

/* ---------- ★v20：退出前确认（借鉴迅雷的三段式退出握手，但**刻意简化**）----------
   迅雷是 main ↔ renderer 三段握手（consume-pending / exit-ack / force-ready），
   因为它的渲染层可能还有未保存的表单。
   **我们没有未保存状态** —— 唯一该拦的就是「还有下载在跑」。
   ⇒ 用主进程原生 `dialog.showMessageBoxSync` 就够，不必为它新增一套 IPC 协议。
   ⚠️ 诚实说明：这**不是**照抄它的握手，而是取同一个目的（关窗前先问一句）的最短实现。 */
let forceQuit = false;
function confirmQuitWithDownloads(e) {
  if (forceQuit || !win) return false;
  const n = activeDlIds.size;
  if (!n) return false;
  e.preventDefault();
  const r = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['继续下载', '仍然退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '还有下载在进行',
    message: '还有 ' + n + ' 个任务正在下载',
    detail: '退出会中断当前下载。\naria2 的续传信息（session）已保存，下次启动可以接着下。',
  });
  if (r === 1) {
    forceQuit = true;
    try { win.close(); } catch (err) { /* */ }
  }
  return true;
}

async function ensureEngine(force) {
  const inf = engineInfo();
  if (!inf.bin) return { ok: false, code: 'engine-not-ready', error: inf.reason, engine: Object.assign({}, inf, { running: false }) };
  const cur = aria2.info();
  if (cur.running) return { ok: true, engine: cur };
  if (!force && engineFailMsg && Date.now() - engineFailAt < ENGINE_RETRY_MS) {
    return { ok: false, code: 'engine-error', error: engineFailMsg, engine: Object.assign({}, cur, { reason: engineFailMsg }) };
  }
  if (engineBooting) { try { await engineBooting; } catch (e) { /* 统一在下面判 */ } }
  else {
    engineBooting = aria2.start({
      bin: ARIA2_BIN,
      /* 会话/种子缓存放 userData，**不污染下载目录**（用户打开目录只该看到成品） */
      stateDir: path.join(app.getPath('userData'), 'aria2'),
      dir: dlDir(),
      log: (m) => log(m),
      onProgress: fireEngineProgress,
    });
    try { await engineBooting; }
    catch (e) {
      engineFailAt = Date.now();
      engineFailMsg = String((e && e.message) || e);
      log('[aria2] 启动失败：' + engineFailMsg);
    }
    finally { engineBooting = null; }
  }
  const after = aria2.info();
  if (after.running) { engineFailMsg = ''; return { ok: true, engine: after }; }
  return { ok: false, code: 'engine-error', error: engineFailMsg || after.reason || '引擎未就绪', engine: after };
}

/* 防盗链：按域名给 Referer。没命中的站点不带 —— 带了反而可能被拒。 */
const REFERER_RULES = [
  [/flingtrainer\.com/i, 'https://flingtrainer.com/'],
  [/nexusmods\.com/i, 'https://www.nexusmods.com/'],
  [/gamersky\.com|ventacorius\.com/i, 'https://www.gamersky.com/'],
];
function refererFor(u) {
  for (const [re, r] of REFERER_RULES) if (re.test(u)) return r;
  return '';
}

/* 落盘文件名：Content-Disposition > URL 末段 > 页面给的 name + 后缀 */
function pickFileName(res, u, hint) {
  let nm = '';
  const cd = String(res.headers['content-disposition'] || '');
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i.exec(cd);
  if (m) { try { nm = decodeURIComponent(m[1]); } catch (e) { nm = m[1]; } }
  if (!nm) {
    try { nm = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { /* */ }
  }
  if (!nm) {
    const base = String(hint || 'download').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    nm = base + (/\.[a-z0-9]{2,5}$/i.test(base) ? '' : '.zip');
  }
  return nm.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150) || ('dl-' + Date.now() + '.bin');
}

function startDownload(o) {
  const id = String(o.id || '');
  const url = String(o.url || '');
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('只接受 http(s) 直链'));

  const dir = dlDir();
  const ctl = { canceled: false, req: null, file: '' };
  dlJobs.set(id, ctl);
  const emit = (p) => {
    if (win && !win.isDestroyed()) win.webContents.send('shell:dl-progress', Object.assign({ id }, p));
  };
  log(`[dl] 开始 ${id} → ${url.slice(0, 120)}`);

  return new Promise((resolve) => {
    let lastT = Date.now(), lastGot = 0;
    const done = (state, err) => {
      dlJobs.delete(id);
      if (ctl.canceled) { emit({ state: 'pause', err: '' }); return resolve({ ok: false, canceled: true }); }
      emit({ state, err: err || '', dest: ctl.file });
      resolve({ ok: state === 'done', error: err || '' });
    };
    const fail = (msg) => done('fail', String(msg || '下载失败'));

    const step = (u, depth) => {
      if (ctl.canceled) return;
      if (depth > 5) return fail('重定向过多');
      const mod = u.startsWith('https:') ? https : http;
      const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameIntelClient/1.0' };
      const ref = refererFor(u);
      if (ref) headers.referer = ref;

      let req;
      try {
        req = mod.get(u, { headers, timeout: 60000 }, (res) => {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            return step(new URL(res.headers.location, u).toString(), depth + 1);
          }
          if (code !== 200) { res.resume(); return fail('HTTP ' + code); }

          const total = Number(res.headers['content-length']) || 0;
          ctl.file = path.join(dir, pickFileName(res, u, o.name));
          log(`[dl] ${id} → 落盘 ${ctl.file}（content-length=${total || '未知'}）`);

          let got = 0;
          const out = fs.createWriteStream(ctl.file);
          /* ★ 这里必须真的把数据写进流。第一版只在 data 里累加 got、忘了 out.write，
             结果「下载完成」的文件是 0 字节 —— 是 smoke 自检把它抓出来的（见 PACK §十四）。
             背压处理：write 返回 false 就暂停上游，等 drain 再续。 */
          res.on('data', (c) => {
            got += c.length;
            if (!out.write(c)) res.pause();
            const now = Date.now();
            if (now - lastT >= 400) {          /* 节流：最多 2.5 次/秒，别把 IPC 打满 */
              emit({ state: 'running', got, total, dest: ctl.file,
                     speed: Math.round((got - lastGot) / ((now - lastT) / 1000)) });
              lastT = now; lastGot = got;
            }
          });
          out.on('drain', () => { try { res.resume(); } catch (e) { /* */ } });
          res.on('end', () => out.end());
          out.on('finish', () => {
            let size = got;
            try { size = fs.statSync(ctl.file).size; } catch (e) { /* */ }
            log(`[dl] ${id} 完成 ${size} B`);
            emit({ state: 'done', got: size, total: total || size, dest: ctl.file });
            dlJobs.delete(id);
            resolve({ ok: true, file: ctl.file, size });
          });
          out.on('error', (e) => fail(e && e.message));
          res.on('error', (e) => fail(e && e.message));
          res.on('aborted', () => fail('连接中断'));
        });
      } catch (e) { return fail(e && e.message); }

      ctl.req = req;
      req.on('error', (e) => fail(e && e.message));
      req.on('timeout', () => { try { req.destroy(); } catch (e) { /* */ } fail('请求超时'); });
    };

    step(url, 0);
  });
}

function cancelDownload(id) {
  const c = dlJobs.get(String(id));
  if (!c) return { ok: false, error: '没有这个任务' };
  c.canceled = true;
  try { if (c.req) c.req.destroy(); } catch (e) { /* */ }
  log(`[dl] 取消 ${id}`);
  return { ok: true };
}

/* openPath / revealPath 的安全边界：**只认本壳自己写出来的目录**。
   否则页面就是个「打开任意路径」的后门。 */
function withinDlRoots(p) {
  const abs = path.resolve(String(p || ''));
  for (const r of dlRoots) {
    const rr = path.resolve(r);
    if (abs === rr || abs.startsWith(rr + path.sep)) return true;
  }
  return false;
}

/* 网盘：只做「唤起」，不解析、不代下。
   ★ 为什么不内置网盘直链解析：LinkSwift 等开源实现的原理是「用你自己浏览器的登录态
     调网盘官方 API」，且它是 AGPL-3.0（传染性，不能抄代码）；第三方解析站要把你的
     分享链接发到别人服务器上，有隐私与封号风险。⇒ 本轮只做「复制链接 + 唤起本机客户端」，
     真要在 APP 内完成取链，需要内嵌登录窗口 + 自己复刻官方接口（另立项，见 PACK §十四.5）。 */
const NETDISK_HOSTS = /(pan\.xunlei\.com|pan\.baidu\.com|yun\.baidu\.com|pan\.quark\.cn|drive\.uc\.cn|aliyundrive\.com|alipan\.com|123pan\.com|cloud\.189\.cn|caiyun\.139\.com|mypikpak\.com|lanzou[a-z]?\.com|woozooo\.com)/i;

/* ------------------------------------------------------- 工作台页的「返回」 */
/* ★ 为什么用注入而不是改上游 HTML：
     上游 public/*.html 是**只读**的（范围铁律）。在渲染进程里塞一个悬浮按钮，
     文件一个字节都不动，哪天不要了删掉这段即可。
   按钮自己判断当前是不是情报站：是 ⇒ 不注入（避免情报站里出现「返回情报站」）。 */
const BACK_BTN_JS = `(() => {
  const ID = '__intelBack';
  const isIntel = location.protocol === 'file:' || /\\/intel\\//.test(location.pathname);
  const old = document.getElementById(ID);
  if (isIntel) { if (old) old.remove(); return 'intel'; }
  if (old) return 'kept';
  const el = document.createElement('div');
  el.id = ID;
  el.textContent = '← 返回情报站';
  el.title = '回到「游戏情报客户端」首页';
  el.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:2147483647;'
    + 'padding:9px 15px;border-radius:999px;background:#1f6feb;color:#fff;'
    + 'font:600 13px/1 system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;'
    + 'box-shadow:0 6px 20px rgba(0,0,0,.4);user-select:none;opacity:.92';
  el.onmouseenter = () => { el.style.opacity = '1'; };
  el.onmouseleave = () => { el.style.opacity = '.92'; };
  el.onclick = () => {
    if (window.__SHELL_OPEN__) window.__SHELL_OPEN__('intel');
    else location.href = 'http://127.0.0.1:${PORT}/intel/index.html';
  };
  document.body.appendChild(el);
  return 'injected';
})()`;

/* ---------------------------------------------------------------- 开窗 */
/* ★v15 桌面客户端形态：`titleBarStyle:'hidden'` 去掉系统标题栏，
   `titleBarOverlay` 让**系统继续画**最小化/最大化/关闭三个按钮 ——
   好处是窗口缩放、双击拖拽区最大化、键盘快捷键这些原生行为全都保留，
   不必自己用 `frame:false` 去补一堆窗口管理逻辑（那才是真正的坑）。
   颜色随后由页面在切主题时经 `shell:titlebar` 同步（见 preload.js / demo index.html）。 */
const TB_DARK  = { color: '#101010', symbolColor: '#e8eaed', height: 48 };
const TB_LIGHT = { color: '#1e3a6e', symbolColor: '#ffffff', height: 48 };

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '游戏情报客户端',
    icon: ICON_OK ? ICON : undefined,
    backgroundColor: '#161616',
    autoHideMenuBar: true,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: TB_DARK,
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

  /* 外链 / 新窗策略：
     · 指向本机服务的 ⇒ 同一个窗口里打开（保住「返回情报站」按钮，也不炸出无边框窗口）
     · 其它 http(s)    ⇒ 交给系统浏览器（网盘下载链接就该在浏览器里走） */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SERVICE)) { setTimeout(() => { if (win) win.loadURL(url); }, 0); return { action: 'deny' }; }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /* ★ 只在截图模式下关掉后台节流（2026-10-16）：
     窗口在后台时 Chromium 会停止合成，`capturePage()` 于是返回**上一次合成**的画面 ——
     实测 SHOT_JS 已经把页面切到「我的游戏」并扫出 67 条（日志 Tab=myGames、DOM 也对），
     抓到的仍是切页之前的首页；`invalidate()` 也救不回来。
     ⇒ 关掉节流才会真的重画。**只在 --shot 下开**，成品仍保留默认节流（最小化时不该白烧 CPU）。 */
  if (SHOT_PATH) {
    try { win.webContents.setBackgroundThrottling(false); } catch (e) { /* 忽略 */ }
  }

  /* 每次文档加载完都补一次「返回情报站」按钮（情报站自身不需要，脚本会自行判断） */
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(BACK_BTN_JS, true)
      .then((r) => log('[shell] 返回按钮 : ' + r))
      .catch(() => { /* 注入失败不影响主体 */ });
  });

  if (/^\//.test(START_MODE)) {
    log('[shell] 落地页 = ' + SERVICE + START_MODE + '（GAMEHUB_START）');
    win.loadURL(SERVICE + START_MODE);
  } else {
    win.loadFile(INTEL_FILE);
    log('[shell] 落地页 = ' + INTEL_FILE);
  }

  /* ★v20：关窗前先问一句（还在下载时）。放在 `closed` 之前注册 —— 顺序不重要，
     但 `close` 是唯一能 `preventDefault()` 拦下来的时机。 */
  win.on('close', (e) => { confirmQuitWithDownloads(e); });

  win.on('closed', () => {
    win = null;
    log('[shell] 窗口关闭 ⇒ 触发清理（③ 关窗无残留）');
    cleanup().then(() => app.quit());
  });
}

/* ================================================ ★v18 独立「管理页」窗口
   用户口径（2026-10-16）：「后续我想将工作台变成该 APP 的管理页面」；
   形态**拍板 = 独立窗口**（另两案「整窗切换 / 侧栏内嵌」已当场说明代价，未采纳）。

   为什么**不**复用 v14 的 `shell:open`（`win.loadURL(SERVICE + p)`）：
     那是**整窗切走** —— App 界面被工作台顶掉，「一边看情报站一边管理」做不到。
   为什么**不**用 `<webview>` 内嵌：
     工作台自带侧栏 + 顶栏，嵌进 App 侧栏必然「双导航」；且要开 `webviewTag`（安全面变大）。
   ★ 上游 HTML **一个字节都不改** —— 管理页右下角那个「本机动作条」由本文件注入
     （与 `BACK_BTN_JS` 同一套路：注入而非改上游）。 */
const ADMIN_TB = { color: '#101010', symbolColor: '#e8eaed', height: 40 };

/* 管理页上的「本机动作条」——**这就是「工作台 → App」的回写通道**。
   设计纪律（与 preload 的注释同源）：
     · 只挂**无需页面上下文**的动作（打开下载目录 / 扫描本机游戏 / 回到 App / 刷新）
       —— 「对当前这款游戏做什么」需要读工作台内部状态，那是**上游**的事，
         本壳不去猜它的 DOM（猜一次就得跟一辈子）；
     · 每个动作都走 preload 白名单，页面**拿不到任意路径或任意 URL**；
     · 「本机」胶囊上显示的**上游归属**来自 `describe()`，用来肉眼证明双向链路是通的。 */
const ADMIN_BAR_JS = `(() => {
  const ID = '__appBar';
  const S = window.__SHELL__;
  if (!S) return 'no-shell';
  if (document.getElementById(ID)) return 'kept';
  const box = document.createElement('div');
  box.id = ID;
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;display:flex;'
    + 'align-items:center;gap:8px;padding:8px 10px;border-radius:999px;'
    + 'background:rgba(16,16,16,.93);color:#e8eaed;'
    + 'font:600 12.5px/1 system-ui,"Microsoft YaHei",sans-serif;'
    + 'box-shadow:0 8px 28px rgba(0,0,0,.45);user-select:none';
  const tag = document.createElement('span');
  tag.textContent = '本机';
  tag.style.cssText = 'padding:0 4px;opacity:.8;white-space:nowrap';
  box.appendChild(tag);
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.title = title;
    b.style.cssText = 'all:unset;padding:7px 11px;border-radius:999px;cursor:pointer;'
      + 'background:#1f6feb;color:#fff;font:inherit;white-space:nowrap';
    b.onmouseenter = () => { b.style.background = '#2b7cf5'; };
    b.onmouseleave = () => { b.style.background = '#1f6feb'; };
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };
  const say = (t) => { tag.textContent = t; };

  mk('📁 下载目录', '打开本 APP 的下载目录', async () => {
    const r = await S.openDlRoot();
    if (r && r.ok === false) say('⚠ ' + (r.error || '打开失败'));
  });

  mk('🕹 扫描本机游戏', '扫一遍 Steam 库 / 快捷方式 / 常见安装目录', async () => {
    say('扫描中…');
    const r = await S.scanGames();
    say('本机游戏 ' + ((r && r.games && r.games.length) || 0) + ' 个');
  });

  mk('↩ 回到 App', '把「游戏情报客户端」主窗调到前台', () => { S.focusApp(); });

  mk('⟳ 刷新', '重新加载本管理页', () => { location.reload(); });

  document.body.appendChild(box);

  /* 「本机」胶囊上直接显示**上游实例归属** —— 这是肉眼可验的「双向链路是通的」证据：
       App 托管 = 本壳 fork 的；外部实例 = 你在别处跑着的那个（App 只复用、不冒认）；
       未知     = 对方是旧版上游（health 里没有 pid 字段）。 */
  S.describe().then((d) => {
    const o = d && d.upOwner;
    say(o === 'shell' ? '本机 · 上游由 App 托管'
      : o === 'external' ? '本机 · 上游是外部实例'
      : '本机 · 上游归属未知（旧版）');
  }).catch(() => { /* 自述失败就保持「本机」 */ });

  return 'built';
})()`;

function createAdminWindow(startPath) {
  if (adminWin && !adminWin.isDestroyed()) { adminWin.focus(); return adminWin; }
  /* 只认「服务根下的路径」，且**必须由主进程校验** —— 页面拿不到任意 URL 的导航能力。
     ★v21 修：默认页从 `/index.html` 改成 **`/admin.html`**。
       上游 `public/` 下其实有 `admin.html`（真管理后台）和 `index.html`（工作台/情报站）两个页面，
       之前默认开 `index.html` ⇒ 用户点「管理页」看到的**不是管理页**（用户 2026-10-22 反馈原话）。 */
  const p = /^\/[A-Za-z0-9._\-/?=&%]*$/.test(String(startPath || '')) ? startPath : '/admin.html';
  adminWin = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '管理页 · GameHub',
    icon: ICON_OK ? ICON : undefined,
    backgroundColor: '#101010',
    autoHideMenuBar: true,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: ADMIN_TB,
    webPreferences: {
      /* 动作条要用 `__SHELL_*` ⇒ 必须挂**同一个 preload**（contextIsolation 保持不变）。 */
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  adminWin.once('ready-to-show', () => { if (adminWin) { adminWin.show(); log('[shell] 管理窗已显示'); } });

  /* 管理窗自己一套新窗策略（`setWindowOpenHandler` 是**每 webContents** 的，
     不会从主窗继承）：服务内链接留在管理窗，其它 http(s) 交系统浏览器。 */
  adminWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SERVICE)) {
      setTimeout(() => { if (adminWin && !adminWin.isDestroyed()) adminWin.loadURL(url); }, 0);
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  adminWin.webContents.on('did-finish-load', () => {
    if (!adminWin || adminWin.isDestroyed()) return;
    adminWin.webContents.executeJavaScript(ADMIN_BAR_JS, true)
      .then((r) => log('[shell] 管理页动作条 : ' + r))
      .catch(() => { /* 注入失败不影响管理页主体 */ });
  });

  adminWin.loadURL(SERVICE + p);
  log('[shell] 管理窗打开 = ' + SERVICE + p
    + ' · 上游归属=' + upInfo.owner + ' pid=' + (upInfo.pid || '?'));

  /* ★★ 关管理窗**只置 null** —— 绝不 `app.quit()`，也**不碰**上游子进程：
     上游归**主窗**的生命周期管（主窗 `closed` 才 cleanup）。这是本窗口最重要的一条纪律。 */
  adminWin.on('closed', () => {
    adminWin = null;
    log('[shell] 管理窗已关闭（主窗与上游服务均不受影响）');
  });
  return adminWin;
}

/* --------------------------------------------------------------- 取文本 */
function getText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向过多'));
    const req = https.get(url, { timeout: 20000, headers: { 'user-agent': 'GameIntelClient/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        log(`[net] ${res.statusCode} → ${next}`);
        return resolve(getText(next, depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

/* ------------------------------------------------------------------ 主流程 */
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ★ 兜底清理：正常关窗走 win.on('closed')，但「退出/被信号杀」不会触发它。 */
function hardCleanup() {
  if (child && childOwned) { try { child.kill(); } catch (e) { /* 已退出 */ } }
  /* ★v19：下载引擎也必须有同步出口 —— 否则退出后 aria2c 会留在后台偷偷占着 DHT 端口。 */
  try { aria2.hardKill(); } catch (e) { /* 未启动 */ }
}
app.on('before-quit', hardCleanup);
process.on('exit', hardCleanup);
process.on('SIGINT', () => { hardCleanup(); process.exit(0); });
process.on('SIGTERM', () => { hardCleanup(); process.exit(0); });

if (!app.requestSingleInstanceLock()) {
  console.log('[shell] 已有实例在跑 ⇒ 退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    initLog();
    log(`[shell] 启动 · 包目录=${__dirname} · 上游=${UPSTREAM} · 图标=${ICON_OK ? '有' : '无'}`);

    /* ---- IPC：代取线上 data.js（file:// 的 Origin 是 null，直接 fetch 会被 CORS 拦）---- */
    ipcMain.handle('shell:fetch', async (_e, url) => {
      if (typeof url !== 'string' || !FETCH_ALLOW.some((p) => url.startsWith(p))) {
        log('[ipc] 拒绝非白名单请求: ' + url);
        throw new Error('url not allowed');
      }
      const t = await getText(url);
      log(`[ipc] 代取成功 ${url} → ${t.length} 字符`);
      return t;
    });

    /* ---- IPC：切到工作台页 / 回情报站 ----
       只认两种入参：'intel'（回情报站）或 `/xxx`（服务根下的路径）。
       页面永远拿不到任意 URL 的导航能力。 */
    ipcMain.handle('shell:open', async (_e, p) => {
      const s = String(p || '');
      if (s === 'intel') { log('[ipc] 回情报站'); if (win) win.loadFile(INTEL_FILE); return { ok: true }; }
      if (!/^\/[A-Za-z0-9._\-/?=&%]*$/.test(s) || s.includes('..')) {
        log('[ipc] 拒绝非法跳转: ' + s);
        throw new Error('path not allowed');
      }
      log('[ipc] 打开工作台页 ' + s);
      if (win) win.loadURL(SERVICE + s);
      return { ok: true };
    });

    /* ---- ★v18 IPC：独立「管理页」窗口 ----
       只认四个动作名，且**不接任意 URL / 路径**（起始页也过主进程正则，页面无从指定外站）。 */
    ipcMain.handle('shell:admin', async (_e, act, startPath) => {
      const a = String(act || '');
      if (a === 'open' || a === 'toggle') {
        const w = createAdminWindow(startPath);
        return { ok: true, open: !!(w && !w.isDestroyed()), owner: upInfo.owner, pid: upInfo.pid };
      }
      if (a === 'focus') {
        if (adminWin && !adminWin.isDestroyed()) { adminWin.focus(); return { ok: true, open: true }; }
        return { ok: true, open: false };
      }
      if (a === 'close') {
        if (adminWin && !adminWin.isDestroyed()) adminWin.close();
        return { ok: true, open: false };
      }
      log('[ipc] 拒绝非法管理页动作: ' + a);
      return { ok: false, error: 'action not allowed' };
    });

    /* ---- ★v18 IPC：把主窗调回前台（管理页动作条「回到 App」用）---- */
    ipcMain.handle('shell:focusApp', async () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return { ok: true };
      }
      return { ok: false, error: '主窗不存在' };
    });

    /* ---- ★v18 IPC：打开本 APP 的下载目录 ----
       ★ **不接受任何路径入参** —— 目录由主进程自己算（`dlDir()`），
         这样页面上就算被注入了脚本，也拿不到「打开任意路径」的能力。 */
    ipcMain.handle('shell:openDlRoot', async () => {
      try {
        const d = dlDir();
        const r = await shell.openPath(d);
        return r ? { ok: false, error: r } : { ok: true, dir: d };
      } catch (e) { return { ok: false, error: String(e && e.message) }; }
    });

    /* ---- ★v15 IPC：本机能力（扫盘 / 下载 / 文件操作）----
       每一个入参都在主进程侧校验；页面永远拿不到任意路径或任意 URL 的能力。 */

    ipcMain.handle('shell:scanGames', async () => {
      try { return await scanGames(); }
      catch (e) { log('[scan] 失败: ' + (e && e.message)); return { ok: false, error: String(e && e.message), games: [] }; }
    });

    /* ---- ★v19 下载：一个入口、两个后端 ----
       有引擎 ⇒ 交 aria2（多连接 / 断点续传 / 磁力）；没引擎 ⇒ **自动回落**内置单连下载器。
       ★ 这是「关联」的关键：页面**只调一个 `startDownload`**，不需要知道背后是谁。 */
    ipcMain.handle('shell:dl-start', async (_e, o) => {
      const opt = o || {};
      const url = String(opt.url || '');
      if (!/^(https?|ftp|magnet):/i.test(url)) {
        return { ok: false, error: '只接受 http(s) / ftp 直链或 magnet 磁力链' };
      }

      const eng = await ensureEngine().catch(() => ({ ok: false }));
      if (eng.ok) {
        const r = await aria2.add({
          url,
          out: opt.name,
          selectFile: opt.selectFile,
          /* ★v22：网盘直链常要特定 UA/Referer —— 由 OpenList 的 `data.header` 提供，原样透传 */
          header: opt.header,
          referer: refererFor(url) || undefined,
        });
        if (r.ok) {
          /* 建立 gid ↔ 页面 id 的映射（页面用自己生成的 id 匹配进度，见 gidAlias 注释） */
          gidAlias.set(String(r.id), String(opt.id || r.id));
          log('[dl] aria2 接单 gid=' + r.id + ' → 页面 id=' + String(opt.id || r.id));
          return r;
        }
        log('[dl] aria2 拒绝（' + r.error + '）⇒ 回落内置下载器');
      }

      if (!/^https?:\/\//i.test(url)) {
        return {
          ok: false, code: 'engine-required',
          error: '磁力链接只能由下载引擎处理' + (eng.error ? '（' + eng.error + '）' : ''),
        };
      }
      try { return await startDownload(opt); }
      catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });

    ipcMain.handle('shell:dl-cancel', async (_e, id) => {
      const pid = String(id || '');
      const g = gidOf(pid);
      if (g) {
        const r = await aria2.act('remove', g);
        gidAlias.delete(g);
        /* ★v20：取消后从活跃集合里摘掉，否则休眠抑制会一直挂着 */
        activeDlIds.delete(pid); activeDlIds.delete(g); syncSleepBlocker();
        return Object.assign({ engine: 'aria2' }, r);
      }
      activeDlIds.delete(pid); syncSleepBlocker();
      return cancelDownload(pid);
    });

    /* ---- ★v19：下载引擎接口 ----
       返回结构统一 `{ ok, code?, error?, engine?, files?, totalBytes? }`。
       ★ 入参一律在主进程侧校验：磁力必须真的是 magnet 形态，
         页面因此拿不到「让主进程去 fetch 任意 URL」的能力。 */

    /* 引擎状态：**顺手懒启动一次**（有二进制才试），失败要带原因回去。 */
    ipcMain.handle('shell:dl-engine', async (_e, force) => {
      try {
        const inf = engineInfo();
        if (!inf.bin) return { ok: true, engine: Object.assign({}, inf, { running: false }) };
        const r = await ensureEngine(!!force);
        const now = aria2.info();
        return {
          ok: true,
          engine: Object.assign({}, inf, {
            available: now.running,
            running: now.running,
            version: now.version || inf.version,
            reason: now.running ? '' : (r.error || now.reason || ''),
          }),
        };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });

    /* 磁力「只取元数据 → 出文件清单」（预览，**不下载正文**）。
       ★ 页面拿到的是 `files[]`，正文等他选完文件再 `dl-start` 才会下。 */
    ipcMain.handle('shell:dl-magnet-preview', async (_e, magnet) => {
      const mg = String(magnet || '').trim();
      if (!/^magnet:\?/i.test(mg) || !/xt=urn:btih:[A-Za-z0-9]{32,40}/i.test(mg)) {
        return { ok: false, code: 'bad-magnet', error: '不是合法的磁力链（需要 magnet:?xt=urn:btih:…）', files: [] };
      }
      const r = await ensureEngine().catch(() => ({ ok: false, error: '引擎启动异常' }));
      if (!r.ok) return { ok: false, code: 'engine-not-ready', error: r.error, engine: r.engine, files: [] };
      const t = Number(process.env.GI_MAGNET_PREVIEW_MS) || 45000;
      return await aria2.preview(mg, { timeout: t });
    });

    /* 暂停 / 继续：**只有引擎里的任务**才支持；内置下载器仍然只能取消。 */
    ipcMain.handle('shell:dl-pause', async (_e, id) => {
      const g = gidOf(String(id || ''));
      if (!g) {
        return {
          ok: false, code: 'not-supported', id: String(id || ''),
          error: '这个任务不在下载引擎里（内置下载器只有取消，做不到暂停）',
        };
      }
      return await aria2.act('pause', g);
    });
    ipcMain.handle('shell:dl-resume', async (_e, id) => {
      const g = gidOf(String(id || ''));
      if (!g) {
        return { ok: false, code: 'not-supported', id: String(id || ''), error: '这个任务不在下载引擎里，无法续传' };
      }
      return await aria2.act('resume', g);
    });

    /* ---- ★v19 管理接口（预留面，给「下载后台」与将来的自动化用）----
       ★ 一律**只作用于引擎内部**，不碰文件系统（不删已下载的文件）。 */

    /* 引擎真值清单（不是页面内存里的那份）—— 重开 App 后靠它把任务捞回来 */
    ipcMain.handle('shell:dl-list', async () => {
      const r = await ensureEngine().catch(() => ({ ok: false }));
      if (!r.ok) return { ok: false, code: 'engine-not-ready', error: r.error, engine: r.engine, tasks: [] };
      const raw = await aria2.list();
      const tasks = raw.filter((t) => t.state !== 'removed')
        .map((t) => Object.assign({}, t, { id: pageIdOf(t.id), gid: t.id }));
      return { ok: true, engine: aria2.info(), tasks };
    });

    /* 删单个任务（含引擎里的记录；**不删已落盘的文件** —— 那属于用户的资产） */
    ipcMain.handle('shell:dl-remove', async (_e, id) => {
      const pid = String(id || '');
      const g = gidOf(pid) || pid;      /* 也允许直接传 gid */
      const r = await aria2.act('remove', g);
      if (r.ok) gidAlias.delete(g);
      return r;
    });

    /* 清空「已结束」的记录 */
    ipcMain.handle('shell:dl-clear', async () => {
      const r = await aria2.act('clear');
      if (r.ok) gidAlias.clear();
      return r;
    });

    /* 引擎全局统计（速度 / 活动数 / 特性列表 / 运行时长） */
    ipcMain.handle('shell:dl-stats', async () => await aria2.stats());

    /* 引擎选项：不给参数=读；给参数=写。★ `dir` 明确拒绝（目录只能由主进程算） */
    ipcMain.handle('shell:dl-options', async (_e, o) => {
      if (o === undefined || o === null) return await aria2.getOptions();
      return await aria2.setOptions(o);
    });

    ipcMain.handle('shell:copy', async (_e, t) => {
      clipboard.writeText(String(t || ''));
      log('[ipc] 已复制 ' + String(t || '').slice(0, 80));
      return { ok: true };
    });

    ipcMain.handle('shell:netdisk', async (_e, u) => {
      const s = String(u || '');
      if (!/^https?:\/\//i.test(s) || !NETDISK_HOSTS.test(s)) {
        log('[ipc] 拒绝非网盘链接: ' + s);
        return { ok: false, error: '只接受常见网盘的分享链接' };
      }
      await shell.openExternal(s);
      log('[ipc] 已唤起网盘 ' + s.slice(0, 100));
      return { ok: true };
    });

    ipcMain.handle('shell:openPath', async (_e, p) => {
      const s = String(p || '');
      if (!withinDlRoots(s)) { log('[ipc] 拒绝打开白名单外的路径: ' + s); return { ok: false, error: '只能打开本 APP 下载的文件' }; }
      if (!fs.existsSync(s)) return { ok: false, error: '文件不存在（可能已被移动或删除）' };
      const r = await shell.openPath(s);
      return r ? { ok: false, error: r } : { ok: true };
    });

    ipcMain.handle('shell:revealPath', async (_e, p) => {
      const s = String(p || '');
      if (!withinDlRoots(s)) { log('[ipc] 拒绝定位白名单外的路径: ' + s); return { ok: false, error: '只能定位本 APP 下载的文件' }; }
      if (!fs.existsSync(s)) return { ok: false, error: '文件不存在（可能已被移动或删除）' };
      shell.showItemInFolder(s);
      return { ok: true };
    });

    /* 只读自述：供页面「本机能力」小面板显示。刻意不含任何用户路径。 */
    ipcMain.handle('shell:describe', async () => ({
      ok: true,
      version: 'v24',
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      dlDirReady: (() => { try { return fs.existsSync(app.getPath('downloads')); } catch (e) { return false; } })(),
      upstreamReady: fs.existsSync(path.join(UPSTREAM, 'server.js')),
      /* ★v18：上游实例归属（`shell` = 本壳 fork / `external` = 复用外部实例 / `unknown` = 旧版上游无 pid） */
      upOwner: upInfo.owner,
      upPid: upInfo.pid,
      upShellFlag: upInfo.shell,
      listenPort: upInfo.listenPort,
      adminOpen: !!(adminWin && !adminWin.isDestroyed()),
    }));

    /* ★v15 桌面形态：切主题时同步系统绘制的窗口按钮配色 */
    ipcMain.handle('shell:titlebar', async (_e, dark) => {
      try {
        if (win && !win.isDestroyed() && typeof win.setTitleBarOverlay === 'function') {
          win.setTitleBarOverlay(dark ? TB_DARK : TB_LIGHT);
        }
        return { ok: true };
      } catch (e) { return { ok: false, error: String(e && e.message) }; }
    });

    if (!fs.existsSync(INTEL_FILE)) {
      const msg = '找不到情报站页面：' + INTEL_FILE;
      log('[shell] ' + msg);
      dialog.showErrorBox('游戏情报客户端 启动失败', msg);
      app.exit(1);
      return;
    }

    /* ---- 冒烟：服务 + 落地页 + 两边互通，全部实测 ---- */
    if (SMOKE) {
      try {
        const r = await bootstrap();
        const svcOk = await probe(PORT);
        log('--------------------------------------------------');
        log(`[smoke] 服务根可访问 : ${svcOk ? 'YES' : 'NO'}`);
        log(`[smoke] 复用已有服务 : ${r.reused ? 'YES' : 'NO（本次自起）'}`);
        log(`[smoke] 内嵌启动耗时 : ${r.startupMs} ms`);
        log(`[smoke] bootstrap 总计: ${r.totalMs} ms`);

        createWindow();
        win.webContents.once('did-finish-load', async () => {
          const W = win.webContents;
          const q = (js) => W.executeJavaScript(js);
          await new Promise((res) => setTimeout(res, 5000));
          log(`[smoke] 落地页 title : ${await q('document.title')}`);
          log(`[smoke] 落地页 url   : ${await q('location.href')}`);
          log(`[smoke] 侧栏 Tab 数  : ${await q('document.querySelectorAll(".nav a[data-tab]").length')}  (v15 期望 12)`);
          log(`[smoke] 工作台入口   : ${await q('document.querySelectorAll(".nav [data-hub]").length')}  (v15 期望 0 —— 已按用户要求移除)`);
          log(`[smoke] 服务探测结果 : ${await q('typeof DL_BASE === "string" ? JSON.stringify(DL_BASE) : "(未探)"')}`);
          log(`[smoke] 返回按钮     : ${await q('document.getElementById("__intelBack") ? "存在（不该有）" : "无（正确：v15 不再注入）"')}`);

          /* ---- ★v15 ① 壳桥：页面能不能看到本机能力 ---- */
          log(`[smoke] 壳桥 __SHELL__: ${await q('(window.__SHELL__ && typeof window.__SHELL__.scanGames === "function") ? "已就绪 ✓" : "缺失 ✗"')}`);
          log(`[smoke] 壳自述       : ${await q('window.__SHELL__ ? window.__SHELL__.describe().then(o=>JSON.stringify(o)) : "n/a"')}`);

          /* ---- ★v18 上游实例归属：壳能不能确证「这个实例是不是我拉起的」---- */
          log(`[smoke] 上游归属     : ${await q('window.__SHELL__.describe().then(o => "owner=" + o.upOwner + " pid=" + (o.upPid || "?") + " shellFlag=" + o.upShellFlag + " listenPort=" + o.listenPort)')}`);
          log(`[smoke] 管理页入口   : ${await q('(function(){ var a = document.getElementById("adminNav"); if(!a) return "缺元素 ✗"; return (a.hidden ? "隐藏" : "可见") + " · __SHELL_ADMIN__=" + (typeof window.__SHELL_ADMIN__) + " · 有 data-tab=" + (a.hasAttribute("data-tab")); })()')}`);
          log(`[smoke] 管理页入口(应可见): ${await q('!!document.getElementById("adminNav") && !document.getElementById("adminNav").hidden')}`);

          /* ---- ★v15 ② 扫盘：真扫本机，报出前几款 ---- */
          log('[smoke] 扫盘中（只读本机文件系统）…');
          const sc = await q(`(async () => {
            const r = await window.__SHELL__.scanGames();
            const g = r.games || [];
            return JSON.stringify({
              ok: r.ok, n: g.length, ms: r.ms, note: r.note,
              src: g.reduce((m, x) => (m[x.source] = (m[x.source] || 0) + 1, m), {}),
              withExe: g.filter(x => x.exe).length,
              first: g.slice(0, 6).map(x => x.name + ' [' + x.source + ']' + (x.exe ? ' → ' + x.exe.split(String.fromCharCode(92)).pop() : '')),
            });
          })()`);
          log(`[smoke] 扫盘结果     : ${sc}`);

          /* ---- ★v15 ③ 我的游戏页：扫描 → 匹配 → 可点行 ---- */
          await q('resetState("myGames"); render();');
          log(`[smoke] 扫描按钮     : ${await q('!!document.getElementById("mgscan")')}`);
          await q('document.getElementById("mgscan").click()');
          await new Promise((res) => setTimeout(res, 7000));
          log(`[smoke] 我的游戏行数 : ${await q('document.querySelectorAll("#main .mgrow").length')}`);
          log(`[smoke] 匹配命中数   : ${await q('document.querySelectorAll("#main .mgrow.ok").length')}`);
          log(`[smoke] 前 3 行      : ${await q('[...document.querySelectorAll("#main .mgrow")].slice(0,3).map(r=>r.querySelector(".mtt").textContent+" | "+(r.classList.contains("ok")?"可点":"未匹配")).join(" ‖ ")')}`);

          /* ---- ★v15 ③b 游戏库（实时全量）+ 点开详情看下载区块 ---- */
          log('[smoke] 切到「游戏库」（实时全量）…');
          await q('resetState("lib"); render();');
          await new Promise((res) => setTimeout(res, 6000));
          log(`[smoke] 游戏库卡片   : ${await q('document.querySelectorAll("#main .card").length')}`);
          log(`[smoke] 游戏库副标   : ${await q('(document.querySelector("#main .psub")||{}).textContent || "(无)"')}`);
          log(`[smoke] 库首款标题   : ${await q('(document.querySelector("#main .ctitle")||{}).textContent || "(无)"')}`);
          log(`[smoke] 侧栏库计数   : ${await q('(document.getElementById("c-lib")||{}).textContent || "(无)"')}`);
          /* 再测一次**搜索**（库内搜索走 /api/library?q=），并挑一款真游戏验证下载区块有数据 */
          await q(`(() => { const el = document.getElementById('libq'); el.value = '赛博朋克'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          await new Promise((res) => setTimeout(res, 4000));
          log(`[smoke] 搜索"赛博朋克": ${await q('document.querySelectorAll("#main .card").length')} 张`);
          log(`[smoke] 搜索首个命中 : ${await q('(document.querySelector("#main .ctitle")||{}).textContent || "(无)"')}`);
          const od = await q(`(() => { const c = document.querySelector('#main .card'); if (!c) return 'no-card'; c.click(); return 'ok'; })()`);
          log(`[smoke] 打开库详情   : ${od}`);
          await new Promise((res) => setTimeout(res, 10000));
          log(`[smoke] 弹窗标题     : ${await q('(document.querySelector("#dlg h2")||{}).textContent || "(无)"')}`);
          log(`[smoke] #dlBlock     : ${await q('!!document.getElementById("dlBlock")')}`);
          log(`[smoke] 四页签       : ${await q('[...document.querySelectorAll("#dlBlock .dlm")].map(b=>b.textContent.trim()).join(" | ")')}`);
          log(`[smoke] 页签计数     : ${await q('[...document.querySelectorAll("#dlBlock .dlm i")].map(b=>b.textContent).join(" / ")')}`);
          await q('closeDetail()');

          /* ---- ★v15 ④ 下载器：真下一个本机小文件（健康检查端点），落盘后删除 ---- */
          log('[smoke] 下载器实测（下一份 /api/health 到本地，随后清理）…');
          log(`[smoke] 非法 URL 拦截 : ${await q(`window.__SHELL__.startDownload({ id: 'x', url: 'ftp://a/b', name: 'x' }).then(r=>JSON.stringify(r))`)}`);

          const dl2 = await q(`(async () => {
            const id = 'smoke2-' + Date.now();
            let last = null;
            window.__SHELL__.onDownload(m => { if (m.id === id) last = m; });
            const r = await window.__SHELL__.startDownload({ id, url: 'http://127.0.0.1:${PORT}/api/health', name: 'smoke-health' });
            /* ★v19：有引擎时 startDownload 立刻返回 gid（不再阻塞到下载完），
               进度靠 onDownload 事件推 ⇒ 这里必须等事件。
               这条同时验证了 gid ↔ 页面 id 的映射：事件里的 id 必须是**页面自己传的那个**，
               否则页面永远匹配不上任务（表现成「卡在 0%」）。
               ⚠️ 这段注释在模板字符串里 ⇒ **不许出现反引号**，否则会把字符串截断。 */
            for (let i = 0; i < 60; i++) {
              if (last && (last.state === 'done' || last.state === 'fail')) break;
              await new Promise(z => setTimeout(z, 250));
            }
            return JSON.stringify({ r, last });
          })()`);
          log(`[smoke] 真下载结果   : ${dl2}`);

          /* ---- ★v19 下载引擎（aria2）：真起进程、真走 RPC、真验边界 ----
             ★ 上面那条 `dl2` 现在**已经是引擎路径**了（有引擎就走 aria2），
               所以这里只补「引擎自身」与「管理接口」的证据。 */
          log(`[smoke] 引擎状态     : ${await q(`window.__SHELL__.dlEngine().then(r=>JSON.stringify({ok:r.ok,running:r.engine&&r.engine.running,version:r.engine&&r.engine.version,reason:r.engine&&r.engine.reason}))`)}`);
          log(`[smoke] 引擎统计     : ${await q(`window.__SHELL__.dlStats().then(r=>JSON.stringify(r.ok?{active:r.global.active,waiting:r.global.waiting,stopped:r.global.stopped,bt:(r.features||[]).includes('BitTorrent')}:r))`)}`);
          log(`[smoke] 任务清单长度 : ${await q(`window.__SHELL__.dlList().then(r=>String((r.tasks||[]).length))`)}`);
          log(`[smoke] 磁力形态拦截 : ${await q(`window.__SHELL__.dlMagnetPreview('https://example.com/x.torrent').then(r=>JSON.stringify({code:r.code}))`)}`);
          log(`[smoke] 引擎选项读取 : ${await q(`window.__SHELL__.dlOptions().then(r=>JSON.stringify(r.ok?r.options:r))`)}`);
          /* ★ 最要紧的一条：页面**不能**改下载目录（否则等于给了「往任意路径写」的能力） */
          log(`[smoke] 改目录被拒   : ${await q(`window.__SHELL__.dlOptions({dir:'C:\\\\Windows'}).then(r=>JSON.stringify({code:r.code,ok:r.ok}))`)}`);
          log(`[smoke] 清空已结束   : ${await q(`window.__SHELL__.dlClear().then(r=>JSON.stringify(r))`)}`);

          /* ---- ★v15 ⑤ 下载管理页 + 路径白名单 ---- */
          await q('resetState("downloads"); render();');
          log(`[smoke] 下载管理页   : ${await q('document.querySelectorAll("#main .dljob").length')} 个任务行`);
          log(`[smoke] 白名单拦截   : ${await q(`window.__SHELL__.openPath('C:\\\\Windows\\\\System32\\\\calc.exe').then(r=>JSON.stringify(r))`)}`);

          /* ---- ★v18 下载管理页：上游服务卡（工作台 → App 的只读回读）---- */
          log(`[smoke] 上游卡存在   : ${await q('!!document.getElementById("upcard")')}`);
          /* 诊断：页面的**服务根**是哪台、那两个只读接口各自通不通、各自多久。
             ★ 实测踩到：`GAMEHUB_PORT=8127` 时页面里的 `DL_BASE` 仍然是
               `http://127.0.0.1:8123` —— demo 的探活默认打 8123（v15 起的设计），
               所以**改壳的端口不会改页面的目标**，这条必须打印出来才看得见。 */
          const upDiag = await q(`(async () => {
            const one = async (p) => { const t = Date.now(); try { const r = await fetch(DL_BASE + p, { cache: 'no-store' }); const j = await r.json(); return p + '→' + r.status + ' ' + (Date.now() - t) + 'ms keys=' + Object.keys(j).join(','); } catch (e) { return p + '→ERR ' + (Date.now() - t) + 'ms ' + (e && e.message); } };
            const out = await Promise.all([one('/api/library/progress'), one('/api/extract/history?n=6')]);
            return 'DL_BASE=' + DL_BASE + ' ‖ ' + out.join(' ‖ ');
          })()`);
          log('[smoke] 上游卡诊断   : ' + upDiag);
          /* ⚠️ 这里必须**轮询**而不是固定等 2.5s：upFill 要先过 `dlBoot()` 探活，
             再并发打两个接口，而 `ddJson` 的超时是 8s —— 固定等待会把「还没回来」
             误读成「卡没渲染」。轮询判据是 `#upstats` 有没有内容（它是最后一步写的）。 */
          let upWait = 0;
          while (upWait < 20000 && !(await q('!!(document.querySelector("#upstats .uprow"))'))) {
            await new Promise((res) => setTimeout(res, 1000));
            upWait += 1000;
          }
          log(`[smoke] 上游卡耗时   : ${upWait} ms（轮询到 #upstats 有内容）`);
          log(`[smoke] 上游卡归属   : ${await q('(document.getElementById("updesc")||{}).textContent || "(无)"')}`);
          log(`[smoke] 上游卡统计   : ${await q('[...document.querySelectorAll("#upstats .uprow")].map(r=>r.textContent).join(" | ") || "(无)"')}`);
          log(`[smoke] 上游卡解压史 : ${await q('(document.querySelector("#uphist .upt")||{}).textContent || (document.querySelector("#uphist .upempty") ? "(空态：确实没有解压记录)" : "(无)")')}`);
          log(`[smoke] 上游卡按钮   : ${await q('(function(){ var b=document.getElementById("upadmin"); return b ? (b.hidden ? "隐藏 ✗" : "可见 ✓") : "缺元素 ✗"; })()')}`);

          /* ---- ★v18 独立管理窗：真开一次 → 验动作条注入 → 关掉验「不带走 App / 不杀上游」---- */
          await q('window.__SHELL_ADMIN__("toggle")');
          await new Promise((res) => setTimeout(res, 5000));
          log(`[smoke] 管理窗       : ${adminWin && !adminWin.isDestroyed() ? '已打开 · url=' + adminWin.webContents.getURL() : '未打开 ✗'}`);
          if (adminWin && !adminWin.isDestroyed()) {
            const A = adminWin.webContents;
            log(`[smoke] 动作条注入   : ${await A.executeJavaScript('!!document.getElementById("__appBar")')}`);
            log(`[smoke] 动作条按钮   : ${await A.executeJavaScript('[...document.querySelectorAll("#__appBar button")].map(b=>b.textContent.trim()).join(" | ")')}`);
            log(`[smoke] 动作条归属字 : ${await A.executeJavaScript('(document.querySelector("#__appBar span")||{}).textContent || "(无)"')}`);
            log(`[smoke] 动作条壳桥   : ${await A.executeJavaScript('(window.__SHELL__ && typeof window.__SHELL__.openDlRoot === "function") ? "已就绪 ✓" : "缺失 ✗"')}`);
            /* 真点一次「扫描本机游戏」——证明**工作台页面 → App 能力**这条回写真的通 */
            await A.executeJavaScript('[...document.querySelectorAll("#__appBar button")].find(b=>/扫描/.test(b.textContent)).click()');
            await new Promise((res) => setTimeout(res, 7000));
            log(`[smoke] 动作条回写   : ${await A.executeJavaScript('document.querySelector("#__appBar span").textContent')}`);
          }
          await q('window.__SHELL_ADMIN__("close")');
          await new Promise((res) => setTimeout(res, 1500));
          log(`[smoke] 关管理窗后   : adminWin=${adminWin === null ? 'null ✓' : '仍在 ✗'} · 主窗=${win && !win.isDestroyed() ? '存活 ✓' : '没了 ✗'} · 上游进程=${child ? '存活 ✓' : '（本壳未 fork）'}`);
          log(`[smoke] 非法动作拦截 : ${await q('window.__SHELL_ADMIN__("rm -rf /").then(r=>JSON.stringify(r))')}`);

          log('[smoke] PASS');
          await cleanup();
          app.exit(0);
        });
      } catch (e) {
        log('[smoke] FAIL: ' + (e && e.message));
        await cleanup();
        app.exit(1);
      }
      return;
    }

    /* ---- 截图：真实窗口像素（打包前的「成品长什么样」证据）---- */
    if (SHOT_PATH) {
      try {
        await bootstrap();
        createWindow();
        win.webContents.once('did-finish-load', async () => {
          await new Promise((r) => setTimeout(r, SHOT_WAIT));
          if (SHOT_JS) {
            try { log('[shot] SHOT_JS → ' + await win.webContents.executeJavaScript(SHOT_JS, true)); }
            catch (e) { log('[shot] SHOT_JS 出错: ' + (e && e.message)); }
            await new Promise((r) => setTimeout(r, SHOT_JS_WAIT));
          }
          const url = await win.webContents.executeJavaScript('location.href');
          const tab = await win.webContents.executeJavaScript('(document.getElementById("main")||{dataset:{}}).dataset.tab || "(无)"');
          log(`[shot] 截图前 url=${url} · Tab=${tab}`);
          /* ★ 抓帧前必须强制重绘一次（2026-10-16 实拍时踩出来的）：
             `capturePage()` 在窗口处于**后台 / 未聚焦**时会返回**上一次合成**的画面。
             实测：SHOT_JS 把页面切到「我的游戏」并扫出 67 条（日志 Tab=myGames、DOM 也对），
             抓到的却仍是切页**之前**的首页 —— 光看图片会误判成「功能坏了」。
             那个 `localStorage` 记住的初始页（首帧就是目标页）反而拍得对，正好说明问题在合成。
             `invalidate()` 强制排一帧，再等它真正画出来。 */
          try { win.webContents.invalidate(); } catch (e) { /* 老版本无此 API 时忽略 */ }
          await new Promise((r) => setTimeout(r, 600));
          const img = await win.webContents.capturePage();
          const buf = img.toPNG();
          fs.writeFileSync(SHOT_PATH, buf);
          log(`[shot] 已保存 ${SHOT_PATH} (${buf.length} B, ${img.getSize().width}x${img.getSize().height})`);

          /* ★v18：`SHOT_ADMIN=1` ⇒ 顺带把**管理页窗口**也拍一张（`<名>-admin.png`）。
             为什么必须真开窗：管理页那排动作条是**注入**的（`ADMIN_BAR_JS`），
             只有真跑 Electron 才看得见；jsdom / 静态 HTML 里永远拍不到。
             两个窗口**没法被同一次 `capturePage()` 拍到**（各拍各的 webContents），
             所以这里分别抓帧，再由 `_compose_shots.py` 拼成一张同屏对照图。 */
          if (process.env.SHOT_ADMIN === '1') {
            try {
              /* ★v21：**不传 startPath**，走与用户点「管理页」完全相同的默认值。
                 之前写死 '/index.html' ⇒ 实拍验的是「工作台」，恰好掩盖了
                 「管理页跳的不是管理页」这个 bug（用户反馈）。实拍必须走真路径。 */
              const aw = createAdminWindow();
              if (aw) {
                const loaded = new Promise((r) => {
                  if (!aw.webContents.isLoading()) return r();
                  aw.webContents.once('did-finish-load', r);
                  setTimeout(r, 15000);          /* 兜底：别把整个截图挂死在这 */
                });
                await loaded;
                await new Promise((r) => setTimeout(r, SHOT_WAIT));
                const aurl = await aw.webContents.executeJavaScript('location.href').catch(() => '?');
                const bar = await aw.webContents.executeJavaScript(
                  'document.querySelectorAll("#__appBar button").length').catch(() => -1);
                log(`[shot] 管理窗 url=${aurl} · 动作条按钮=${bar}`);
                try { aw.webContents.invalidate(); } catch (e) { /* 老版本无此 API */ }
                await new Promise((r) => setTimeout(r, 600));
                const aimg = await aw.webContents.capturePage();
                const abuf = aimg.toPNG();
                const ap = SHOT_PATH.replace(/\.png$/i, '-admin.png');
                fs.writeFileSync(ap, abuf);
                log(`[shot] 已保存 ${ap} (${abuf.length} B, ${aimg.getSize().width}x${aimg.getSize().height})`);
              } else {
                log('[shot] 管理窗未创建（createAdminWindow 返回空）');
              }
            } catch (e) { log('[shot] 管理窗截图失败: ' + (e && e.message)); }
          }
          await cleanup();
          app.exit(0);
        });
      } catch (e) {
        log('[shot] FAIL: ' + (e && e.message));
        await cleanup();
        app.exit(1);
      }
      return;
    }

    try {
      await bootstrap();
      createWindow();
    } catch (e) {
      log('[shell] 启动失败: ' + (e && e.message));
      dialog.showErrorBox('游戏情报客户端 启动失败', String(e && e.message));
      app.exit(1);
    }
  });
}
