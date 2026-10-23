'use strict';
/* electron/aria2.js —— App 自带的下载引擎（aria2 JSON-RPC 封装）
   ============================================================================
   为什么是这个形态（不是自己写多线程下载）：
     · 用户要的是「具备 aria2 的功能」：多连接分段、断点续传、限速、
       **磁力 / BT / DHT**、批量、JSON-RPC 控制。
       HTTP 那部分自己写得出，**BT 自研不现实** ⇒ 只能是 aria2c 本体。
     · 二进制是 **GPLv2** ⇒ 随包附 COPYING + SOURCE-OFFER.txt（见 vendor/aria2/），
       并以**独立进程 + 回环 JSON-RPC** 调用（聚合，不是链接）。

   ★★ 三条安全边界（写死在这里，不是配置项）：
     ① `--rpc-listen-all=false` + 只绑 127.0.0.1 —— 一旦被局域网够到，
        等于把「往任意目录写文件」公开（aria2 的 `dir` 可以指任何路径）；
     ② `--rpc-secret` **每次启动随机**，且**永不离开主进程**（不进 preload、不进页面）；
     ③ `--rpc-allow-origin-all=false`。
     本模块把 `port`/`secret` 只留在内部状态里，对外只给 `info()` 的**非敏感摘要**。

   ★ 实测踩到的坑（必须保留这几行逻辑）：
     `--input-file=` 指向**不存在**的文件时，aria2 会**直接异常退出**：
       Exception: [download_helper.cc:562] errorCode=1 Failed to open the file …, cause: File not found
     ⇒ 首次启动前**必须先建一个空的 session 文件**（见 ensureState）。
     另外别用 `--quiet`：它会把这条错误吞掉，表现成「RPC 一直起不来」。
   ============================================================================ */

const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const RPC_TIMEOUT = 10000;
const START_TIMEOUT = 25000;
const POLL_MS = 700;
const MAX_POLL_ERR = 5;
const SHUTDOWN_GRACE = 3000;

/* aria2 的 status → 页面已在用的那套词（见 demo 的 renderDownloads） */
const STATE_MAP = {
  active: 'running', waiting: 'waiting', paused: 'pause',
  error: 'fail', complete: 'done', removed: 'removed',
};

const P = {
  proc: null, port: 0, secret: '', bin: '', stateDir: '', dir: '',
  version: '', starting: null, readyAt: 0, lastLog: '', reason: '',
  pollTimer: null, pollErr: 0, onProgress: null,
  seen: new Map(),      /* gid → 上次指纹（只推变化，别把 IPC 打满） */
  log: () => {},
};

/* ---------- 小工具 ---------- */

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function tail(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const lines = t.split(/\r?\n/).filter(Boolean);
  return lines.slice(-3).join(' | ').slice(0, 400);
}

/* 状态目录里那两个文件必须存在（session 的坑见文件头 ★） */
function ensureState() {
  fs.mkdirSync(P.stateDir, { recursive: true });
  const session = path.join(P.stateDir, 'aria2.session');
  if (!fs.existsSync(session)) fs.writeFileSync(session, '');
  return session;
}

/* ---------- JSON-RPC ---------- */

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!P.port || !P.secret) return reject(new Error('引擎未启动'));
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 'gi', method,
      params: ['token:' + P.secret].concat(params || []),
    });
    const req = http.request({
      host: '127.0.0.1', port: P.port, path: '/jsonrpc', method: 'POST',
      timeout: RPC_TIMEOUT,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try {
          const o = JSON.parse(b);
          if (o && o.error) return reject(new Error((o.error && o.error.message) || 'RPC 错误'));
          resolve(o && o.result);
        } catch (e) { reject(new Error('RPC 返回非 JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('RPC 超时')); });
    req.on('error', reject);
    req.end(body);
  });
}

/* ---------- 生命周期 ---------- */

function info() {
  const running = !!(P.proc && !P.proc.killed && P.port);
  return {
    available: running,
    running,
    version: P.version || '',
    dir: P.dir || '',
    /* ★ 只报「有没有起来」，**不报 port / secret** —— 那两个东西不进页面上下文。 */
    reason: running ? '' : (P.reason || '引擎未启动'),
  };
}

async function start(opt) {
  const o = opt || {};
  if (P.proc && P.port) return info();
  if (P.starting) return P.starting;

  P.bin = String(o.bin || P.bin || '');
  P.stateDir = String(o.stateDir || P.stateDir || '');
  P.dir = String(o.dir || P.dir || '');
  if (o.log) P.log = o.log;
  if (o.onProgress) P.onProgress = o.onProgress;

  P.starting = (async () => {
    P.reason = '';
    if (!P.bin) throw new Error('未指定 aria2c 路径');
    let st = null;
    try { st = fs.statSync(P.bin); } catch (e) { st = null; }
    if (!st || !st.isFile()) throw new Error('aria2c 不存在：' + P.bin);

    const session = ensureState();
    if (!P.dir) throw new Error('未指定下载目录');
    fs.mkdirSync(P.dir, { recursive: true });

    P.port = await freePort();
    P.secret = crypto.randomBytes(16).toString('hex');   /* 32 位，每次启动都换 */

    const args = [
      '--enable-rpc=true',
      '--rpc-listen-all=false',           /* ★ 只绑回环 */
      '--rpc-allow-origin-all=false',     /* ★ 不允许跨源 */
      '--rpc-listen-port=' + P.port,
      '--rpc-secret=' + P.secret,
      '--dir=' + P.dir,
      '--continue=true',
      '--max-concurrent-downloads=3',
      '--split=8',
      '--max-connection-per-server=8',
      '--min-split-size=1M',
      /* `none` 而不是 `falloc`：NTFS 上预分配会让「点了没反应」持续好几秒 */
      '--file-allocation=none',
      '--auto-file-renaming=false',
      '--allow-overwrite=true',
      '--seed-time=0',
      '--bt-save-metadata=true',
      '--follow-torrent=true',
      '--input-file=' + session,
      '--save-session=' + session,
      '--save-session-interval=15',
      '--console-log-level=warn',
      /* ★ 不加 `--quiet`：它会把启动期的致命错误吞掉（见文件头） */
    ];

    P.proc = spawn(P.bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const grab = (c) => { buf = (buf + c.toString()).slice(-8000); P.lastLog = tail(buf); };
    if (P.proc.stdout) P.proc.stdout.on('data', grab);
    if (P.proc.stderr) P.proc.stderr.on('data', grab);
    P.proc.on('exit', (code, sig) => {
      P.log('[aria2] 进程退出 code=' + code + ' sig=' + sig + (P.lastLog ? ' · ' + P.lastLog : ''));
      P.proc = null; P.port = 0; P.secret = ''; P.version = ''; P.readyAt = 0;
      stopPoll();
    });
    P.proc.on('error', (e) => {
      P.reason = 'aria2c 启动失败：' + String((e && e.message) || e);
      P.log('[aria2] ' + P.reason);
    });

    /* 等 RPC 起来：轮询 getVersion（比 sleep 固定秒数可靠） */
    const t0 = Date.now();
    let ver = null;
    while (Date.now() - t0 < START_TIMEOUT) {
      if (!P.proc) break;                       /* 进程已经退了 ⇒ 不用再等 */
      try { ver = await rpc('aria2.getVersion'); break; } catch (e) { /* 继续等 */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ver) {
      P.reason = '下载引擎启动失败' + (P.lastLog ? '：' + P.lastLog : '（RPC 未就绪）');
      try { if (P.proc) P.proc.kill(); } catch (e) { /* */ }
      P.proc = null; P.port = 0; P.secret = '';
      throw new Error(P.reason);
    }

    P.version = String((ver && ver.version) || '');
    P.readyAt = Date.now();
    P.log('[aria2] 引擎就绪 v' + P.version + ' · 端口 ' + P.port + '（仅 127.0.0.1）· 下载目录 ' + P.dir);
    startPoll();
    return info();
  })();

  try {
    return await P.starting;
  } finally {
    P.starting = null;
  }
}

async function stop() {
  stopPoll();
  if (!P.proc) return { ok: true };
  try { await rpc('aria2.shutdown'); } catch (e) { /* 关不掉就强杀 */ }
  const t0 = Date.now();
  while (P.proc && Date.now() - t0 < SHUTDOWN_GRACE) {
    await new Promise((r) => setTimeout(r, 120));
  }
  if (P.proc) { try { P.proc.kill(); } catch (e) { /* */ } }
  P.proc = null; P.port = 0; P.secret = ''; P.version = ''; P.readyAt = 0;
  return { ok: true };
}

/* ★ 同步强杀：`app.on('before-quit')` / `process.on('exit')` 里**不能 await**，
   所以必须留一个同步出口，否则退出时会把 aria2c 留在后台。 */
function hardKill() {
  stopPoll();
  if (P.proc) { try { P.proc.kill(); } catch (e) { /* 已退出 */ } }
  P.proc = null; P.port = 0; P.secret = ''; P.version = ''; P.readyAt = 0;
}

/* ---------- 轮询：aria2 是「拉」模型，页面要的是「推」 ---------- */

function mapTask(t) {
  const st = STATE_MAP[String(t.status || '')] || String(t.status || '');
  const files = Array.isArray(t.files) ? t.files : [];
  const first = files[0] || {};
  const name = (first.path ? path.basename(first.path) : '') || t.bittorrentName || t.gid;
  const isTorrent = !!(t.bittorrent || (t.followedBy && t.followedBy.length));
  return {
    id: String(t.gid),
    name,
    kind: isTorrent ? 'magnet' : 'file',
    state: st,
    got: Number(t.completedLength) || 0,
    total: Number(t.totalLength) || 0,
    speed: Number(t.downloadSpeed) || 0,
    dest: first.path || '',
    url: String((files[0] && files[0].uris && files[0].uris[0] && files[0].uris[0].uri) || ''),
    err: t.errorMessage || '',
    files: files.length,
  };
}

async function list() {
  if (!P.proc) return [];
  const out = [];
  const push = (arr) => { for (const t of (arr || [])) out.push(mapTask(t)); };
  try {
    push(await rpc('aria2.tellActive'));
    push(await rpc('aria2.tellWaiting', [0, 200]));
    push(await rpc('aria2.tellStopped', [0, 200]));
  } catch (e) {
    return out;
  }
  /* `removed` 不该继续占着列表 —— 但要不要删记录由调用方决定，这里只标出来 */
  return out;
}

function fingerprint(t) {
  /* running 时按 64KB 粒度算指纹：既能看到变化，又不会每 700ms 都推一次逐字节变动 */
  const g = t.state === 'running' ? Math.floor(t.got / 65536) : t.got;
  return t.state + '|' + t.total + '|' + g;
}

function startPoll() {
  stopPoll();
  P.pollErr = 0;
  P.pollTimer = setInterval(async () => {
    if (!P.proc) return stopPoll();
    let tasks = [];
    try {
      tasks = await list();
      P.pollErr = 0;
    } catch (e) {
      if (++P.pollErr >= MAX_POLL_ERR) stopPoll();
      return;
    }
    if (typeof P.onProgress !== 'function') return;
    for (const t of tasks) {
      if (t.state === 'removed') continue;
      const fp = fingerprint(t);
      if (P.seen.get(t.id) === fp) continue;
      P.seen.set(t.id, fp);
      try { P.onProgress(t); } catch (e) { /* 单个回调出错不影响轮询 */ }
    }
  }, POLL_MS);
  if (P.pollTimer.unref) P.pollTimer.unref();
}

function stopPoll() {
  if (P.pollTimer) { clearInterval(P.pollTimer); P.pollTimer = null; }
}

/* ---------- 磁力：先「只取元数据」出文件清单（不下载正文） ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 极小 bencode 解码器（只够读 .torrent 的 info 段）。
   为什么不解析 `aria2c --show-files` 的表格输出：那是**给人看的排版**，
   字段顺序/单位随版本变；`.torrent` 是**二进制规范**，解析它才稳。 */
function bdecode(buf) {
  let i = 0;
  function val() {
    const c = buf[i];
    if (c === 0x69) {                       /* 'i' → 整数 */
      i++;
      const s = i;
      while (buf[i] !== 0x65) i++;
      const n = Number(buf.toString('ascii', s, i));
      i++;
      return n;
    }
    if (c === 0x6c) {                       /* 'l' → 数组 */
      i++;
      const a = [];
      while (buf[i] !== 0x65) a.push(val());
      i++;
      return a;
    }
    if (c === 0x64) {                       /* 'd' → 字典（键转字符串） */
      i++;
      const o = {};
      while (buf[i] !== 0x65) {
        const k = val();
        o[Buffer.isBuffer(k) ? k.toString('utf8') : String(k)] = val();
      }
      i++;
      return o;
    }
    const s = i;                            /* '<len>:<bytes>' → Buffer */
    while (buf[i] !== 0x3a) i++;
    const len = Number(buf.toString('ascii', s, i));
    i++;
    const out = buf.slice(i, i + len);
    i += len;
    return out;
  }
  return val();
}

const bstr = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v == null ? '' : v));

/* 把 .torrent 的 info 段摊平成「文件清单」，idx 从 1 起（aria2 的 `select-file` 是 1 基） */
function filesFromTorrent(buf) {
  const t = bdecode(buf);
  const info = (t && t.info) || null;
  if (!info) throw new Error('不是合法的种子文件');
  const base = bstr(info.name);
  if (Array.isArray(info.files)) {
    return info.files.map((f, i) => {
      const seg = Array.isArray(f.path) ? f.path.map(bstr) : [bstr(f.path)];
      return { idx: i + 1, path: base + '/' + seg.join('/'), length: Number(f.length) || 0, selected: true };
    });
  }
  return [{ idx: 1, path: base, length: Number(info.length) || 0, selected: true }];
}

/* ★★ 为什么用「独立进程」而不是 RPC：
   实测踩到的坑 —— RPC 的 `aria2.addUri` **不认 `bt-metadata-only`**
   （那是**全局**选项，不是 per-download 选项）⇒ 传进去被忽略 ⇒
   aria2 直接把**整个正文**开下（测试里是 756 MB 的 ISO），
   于是 `followedBy` 永远不出现、60 s 后判超时，还在后台白下几百兆。
   ⇒ 改成：起一个**短命 aria2c 进程**，用命令行全局参数 `--bt-metadata-only=true`，
     拿到 `.torrent` 就杀掉。这条路实测 **6 s** 出清单。 */
async function preview(magnet, opt) {
  const mg = String(magnet || '').trim();
  if (!/^magnet:\?/i.test(mg)) return { ok: false, code: 'bad-magnet', error: '不是磁力链', files: [] };
  if (!P.bin) return { ok: false, code: 'engine-not-ready', error: '未指定 aria2c 路径', files: [] };
  const waitMs = (opt && opt.timeout) || 45000;

  const dir = path.join(P.stateDir, 'preview');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  fs.mkdirSync(dir, { recursive: true });

  const args = [
    '--bt-metadata-only=true',
    '--bt-save-metadata=true',
    '--dir=' + dir,
    '--seed-time=0',
    '--file-allocation=none',
    '--console-log-level=notice',
    mg,
  ];
  let p = null;
  let logText = '';
  try {
    p = spawn(P.bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const grab = (c) => { logText = (logText + c.toString()).slice(-4000); };
    if (p.stdout) p.stdout.on('data', grab);
    if (p.stderr) p.stderr.on('data', grab);
  } catch (e) {
    return { ok: false, code: 'spawn-failed', error: String((e && e.message) || e), files: [] };
  }

  const t0 = Date.now();
  let torrentPath = '';
  while (Date.now() - t0 < waitMs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    const hit = names.find((n) => /\.torrent$/i.test(n));
    if (hit) { torrentPath = path.join(dir, hit); break; }
    if (p.exitCode !== null) break;         /* 进程退了还没产出 ⇒ 不用再等 */
    await sleep(300);
  }
  try { if (p && p.exitCode === null) p.kill(); } catch (e) { /* */ }

  if (!torrentPath) {
    const hint = /no peer|not found|error/i.test(logText) ? '（' + tail(logText).slice(0, 160) + '）' : '';
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
    return {
      ok: false, code: 'preview-timeout',
      error: '取元数据超时（' + Math.round(waitMs / 1000) + 's）—— 可能是死种 / 无 peer，或本机 BT 出站被挡' + hint,
      files: [],
    };
  }

  /* 文件可能还没写完 ⇒ 小重试（读到合法种子为止） */
  let files = [];
  let lastErr = '';
  for (let k = 0; k < 10; k++) {
    try {
      files = filesFromTorrent(fs.readFileSync(torrentPath));
      if (files.length) break;
    } catch (e) { lastErr = String((e && e.message) || e); }
    await sleep(200);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }

  if (!files.length) {
    return { ok: false, code: 'preview-parse', error: '种子读出来了但解析失败' + (lastErr ? '：' + lastErr : ''), files: [] };
  }
  return {
    ok: true,
    files,
    totalBytes: files.reduce((s, f) => s + f.length, 0),
    name: files.length === 1 ? files[0].path : path.basename(files[0].path.split('/')[0]),
  };
}

/* ---------- 加任务 ---------- */

async function add(o) {
  if (!P.proc) return { ok: false, code: 'engine-not-ready', error: '引擎未启动' };
  const src = String(o.url || '').trim();
  if (!/^(https?|ftp|magnet):/i.test(src)) {
    return { ok: false, code: 'bad-url', error: '只接受 http(s) / ftp 直链或 magnet 磁力链' };
  }
  const opts = {};
  if (o.out) opts.out = String(o.out).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  /* 选文件用 aria2 的 `select-file`（1 基、逗号分隔）—— 只有种子/磁力有意义 */
  if (o.selectFile) opts['select-file'] = String(o.selectFile);
  if (o.referer) opts.referer = String(o.referer);
  /* ★v22：`header` 来自 OpenList 的 `data.header`（某些网盘驱动要求特定 UA/Referer/Cookie）。
     我们**原样透传**，不自己拼。aria2 要求这里是**字符串数组**，所以两种形态都归一化。 */
  if (o.header) {
    const h = Array.isArray(o.header) ? o.header : String(o.header).split(/\r?\n/);
    const clean = h.map((x) => String(x).trim()).filter(Boolean);
    if (clean.length) opts.header = clean;
  }

  try {
    const gid = await rpc('aria2.addUri', [[src], opts]);
    return { ok: true, id: String(gid), engine: 'aria2' };
  } catch (e) {
    return { ok: false, code: 'add-failed', error: String((e && e.message) || e) };
  }
}

/* ---------- 管理动作（预留：给「下载后台」与将来的自动化用） ---------- */

async function act(a, gid) {
  if (!P.proc) return { ok: false, code: 'engine-not-ready', error: '引擎未启动' };
  const id = String(gid || '');
  try {
    if (a === 'pause') { if (!id) return { ok: false, error: '缺少任务 id' }; await rpc('aria2.pause', [id]); return { ok: true, id }; }
    if (a === 'resume') { if (!id) return { ok: false, error: '缺少任务 id' }; await rpc('aria2.unpause', [id]); return { ok: true, id }; }
    if (a === 'remove') { if (!id) return { ok: false, error: '缺少任务 id' }; await rpc('aria2.forceRemove', [id]); await rpc('aria2.removeDownloadResult', [id]); P.seen.delete(id); return { ok: true, id }; }
    if (a === 'pauseAll') { await rpc('aria2.pauseAll'); return { ok: true }; }
    if (a === 'resumeAll') { await rpc('aria2.unpauseAll'); return { ok: true }; }
    if (a === 'clear') {
      /* 只清「已结束」的记录，不碰活动/等待中的任务 */
      const stopped = await rpc('aria2.tellStopped', [0, 500]);
      for (const t of (stopped || [])) {
        try { await rpc('aria2.removeDownloadResult', [String(t.gid)]); } catch (e) { /* */ }
        P.seen.delete(String(t.gid));
      }
      return { ok: true, removed: (stopped || []).length };
    }
    return { ok: false, code: 'bad-action', error: '不支持的动作：' + a };
  } catch (e) {
    return { ok: false, code: 'action-failed', error: String((e && e.message) || e) };
  }
}

/* 引擎全局统计 + 选项（「管理接口」的读侧） */
async function stats() {
  if (!P.proc) return { ok: false, code: 'engine-not-ready', error: '引擎未启动' };
  try {
    const g = await rpc('aria2.getGlobalStat');
    const ver = await rpc('aria2.getVersion');
    return {
      ok: true,
      engine: info(),
      global: {
        speed: Number(g && g.downloadSpeed) || 0,
        uploadSpeed: Number(g && g.uploadSpeed) || 0,
        active: Number(g && g.numActive) || 0,
        waiting: Number(g && g.numWaiting) || 0,
        stopped: Number(g && g.numStopped) || 0,
      },
      features: (ver && ver.enabledFeatures) || [],
      uptime: P.readyAt ? Math.round((Date.now() - P.readyAt) / 1000) : 0,
    };
  } catch (e) {
    return { ok: false, code: 'stats-failed', error: String((e && e.message) || e) };
  }
}

async function getOptions() {
  if (!P.proc) return { ok: false, code: 'engine-not-ready', error: '引擎未启动' };
  try {
    const raw = await rpc('aria2.getGlobalOption');
    return {
      ok: true,
      options: {
        dir: raw.dir || '',
        maxConcurrent: Number(raw['max-concurrent-downloads']) || 3,
        split: Number(raw.split) || 8,
        maxPerServer: Number(raw['max-connection-per-server']) || 8,
        speedLimitKB: Math.round((Number(raw['max-overall-download-limit']) || 0) / 1024),
        seedTime: Number(raw['seed-time']) || 0,
      },
      /* ★ 只给「可以改的那几个」；dir 由主进程说了算，**不接受页面改** */
      editable: ['maxConcurrent', 'split', 'maxPerServer', 'speedLimitKB', 'seedTime'],
    };
  } catch (e) {
    return { ok: false, code: 'options-failed', error: String((e && e.message) || e) };
  }
}

const LIMITS = {
  maxConcurrent: [1, 10],
  split: [1, 16],
  maxPerServer: [1, 16],
  speedLimitKB: [0, 1048576],
  seedTime: [0, 1440],
};

async function setOptions(o) {
  if (!P.proc) return { ok: false, code: 'engine-not-ready', error: '引擎未启动' };
  const apply = {};
  const src = o || {};
  for (const k of Object.keys(LIMITS)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const n = Number(src[k]);
    if (!isFinite(n)) return { ok: false, code: 'bad-option', error: k + ' 不是数字' };
    const [lo, hi] = LIMITS[k];
    if (n < lo || n > hi) return { ok: false, code: 'bad-option', error: k + ' 超出范围 [' + lo + ',' + hi + ']' };
    apply[k] = n;
  }
  if (src.dir !== undefined) {
    /* ★ 明确拒绝：目录只能由主进程算（否则页面就能往任意路径写） */
    return { ok: false, code: 'dir-locked', error: '下载目录由 App 决定，页面不能修改' };
  }
  const map = {
    maxConcurrent: ['max-concurrent-downloads', String],
    split: ['split', String],
    maxPerServer: ['max-connection-per-server', String],
    speedLimitKB: ['max-overall-download-limit', (v) => String(v * 1024)],
    seedTime: ['seed-time', String],
  };
  try {
    for (const k of Object.keys(apply)) {
      const [name, conv] = map[k];
      await rpc('aria2.changeGlobalOption', [{ [name]: conv(apply[k]) }]);
    }
    return { ok: true, applied: apply };
  } catch (e) {
    return { ok: false, code: 'set-option-failed', error: String((e && e.message) || e) };
  }
}

module.exports = {
  start, stop, hardKill, info, rpc, list, preview, add, act, stats, getOptions, setOptions,
  STATE_MAP, POLL_MS,
};
