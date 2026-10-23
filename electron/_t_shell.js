/**
 * 壳与上游的**静态契约**检查（v18 新增）
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件、而且**不跑 Electron**：
 *   `demo/_t_demo.js` 用 jsdom 跑的是「网页侧」；壳侧（`main.js` / `preload.js`）没法在
 *   纯 Node 里 require（`require('electron')` 直接抛），而它恰恰是**安全边界**所在的那一层 ——
 *   「管理页能干什么、不能干什么」全在这两个文件的**入参校验**上。
 *   ⇒ 这里只做**源码级契约断言**：把「不许出现什么」写成判据（比人眼 review 可靠），
 *     真正的行为验证交给 `--smoke` 实跑与成品窗口实拍（见 PACK §十七）。
 *
 * 覆盖三段：
 *   ① 壳：`shell:admin` / `shell:openDlRoot` / `shell:focusApp` 的入参边界与管理窗纪律；
 *   ② 壳：上游实例归属判定（不许靠猜）；
 *   ③ 上游 `server.js` 的 v18 两处授权改动（监听面 + `/api/health` 实例标识）。
 *
 * 运行：
 *   node _t_shell.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.dirname(HERE);

/* ★ 被测文件支持**环境变量替换** —— 供 `_counterproof_shell.py` 打坏后指向临时文件，
   这样本文件只读、壳源码全程不被写入（与 demo/_counterproof.py 同一套纪律）。 */
const MAIN = fs.readFileSync(process.env.GAMEHUB_MAIN || path.join(HERE, 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(process.env.GAMEHUB_PRELOAD || path.join(HERE, 'preload.js'), 'utf8');
/* ★v19：下载引擎模块也纳入契约检查。它**不 require electron** ⇒ 本来就能单测
   （行为验证见 `_t_aria2.js` 27 条）；这里只守「不许出现什么」这类边界。 */
const ARIA2JS = fs.readFileSync(process.env.GI_ARIA2 || path.join(HERE, 'aria2.js'), 'utf8');
const PACKPY = fs.readFileSync(path.join(HERE, 'pack.py'), 'utf8');
const UPSTREAM = process.env.GAMEHUB_SERVER
  || path.join(path.dirname(ROOT), '2026-09-03-16-11-58', 'game-aggregator', 'server.js');
const hasUpstream = fs.existsSync(UPSTREAM);
const UP = hasUpstream ? fs.readFileSync(UPSTREAM, 'utf8') : '';

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; fails.push(n + (x ? '  → ' + x : '')); } };

/* ---------- 取一个 ipcMain.handle 的整段（从 handle('name' 到下一个 handle( ）---------- */
function handlerBody(src, name) {
  const i = src.indexOf(`ipcMain.handle('${name}'`);
  if (i < 0) return '';
  const next = src.indexOf('ipcMain.handle(', i + 10);
  return src.slice(i, next < 0 ? src.length : next);
}

console.log('=== ★v24 壳 · 上游 契约检查 ===');

/* ============================ ① 壳：管理页的入参边界 ============================ */
const admin = handlerBody(MAIN, 'shell:admin');
ok('v18壳：`shell:admin` 存在', admin.length > 0);
ok('v18壳：只认 open/focus/close/toggle 四个动作',
  /'open' \|\| a === 'toggle'/.test(admin) && /a === 'focus'/.test(admin) && /a === 'close'/.test(admin));
ok('v18壳：未知动作**拒绝并回执**（不是 throw、更不是放行）',
  /拒绝非法管理页动作/.test(admin) && /return \{ ok: false, error: 'action not allowed' \};/.test(admin));
ok('v18壳：起始页在主进程侧过正则 + 禁 `..`（页面拿不到任意 URL）',
  /\\\/\[A-Za-z0-9\._\\-\/\?=&%\]\*\$\/\.test\(String\(startPath \|\| ''\)\)/.test(MAIN)
  && /s\.includes\('\.\.'\)/.test(MAIN));
ok('v18壳：`shell:admin` 的返回值带上游归属（不额外暴露路径）',
  /owner: upInfo\.owner, pid: upInfo\.pid/.test(admin));

const dlRoot = handlerBody(MAIN, 'shell:openDlRoot');
ok('v18壳：`shell:openDlRoot` 存在', dlRoot.length > 0);
ok('v18壳：`shell:openDlRoot` **不接受任何入参**（入参里没有路径，页面上就拿不到「打开任意路径」）',
  /ipcMain\.handle\('shell:openDlRoot', async \(\) =>/.test(dlRoot)
  && !/_e\s*,/.test(dlRoot) && !/l ? p : /.test(dlRoot));
ok('v18壳：`shell:openDlRoot` 的目录由 `dlDir()` 自己算（继续吃 dlRoots 白名单）',
  /const d = dlDir\(\);/.test(dlRoot));

const focus = handlerBody(MAIN, 'shell:focusApp');
ok('v18壳：`shell:focusApp` 无入参且对「主窗不存在」如实回执',
  focus.length > 0 && /ipcMain\.handle\('shell:focusApp', async \(\) =>/.test(focus)
  && /error: '主窗不存在'/.test(focus));

/* ---------- 管理窗纪律：本文件最重要的一节 ---------- */
/* ⚠️ 切片终点用「下一个函数定义」而不是「下一段注释框」——注释里的横线根数一改，
   indexOf 就返回 -1，`slice(i, -1)` 会把**整个文件剩余部分**都圈进来，
   于是 `/app\.quit\(\)/` 必然命中（这条断言自己踩过）。
   ⚠️⚠️ 更关键的第二个坑：**必须先剥掉块注释再判** ——
   我在 `createAdminWindow` 的说明注释里写了「绝不 `app.quit()`」，
   不剥注释的话，一条「禁止出现 app.quit()」的断言会被自己那句解释**判假**
   （与 `_t_demo.js` 里「断言引用了注释文本」是同一个坑，第二次踩）。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const iAdmin = MAIN.indexOf('function createAdminWindow(');
const iNextFn = MAIN.indexOf('\nfunction ', MAIN.indexOf('function createAdminWindow(') + 10);
const adminCode = strip(MAIN.slice(iAdmin, iNextFn > 0 ? iNextFn : MAIN.length));
ok('v18壳：管理窗 `closed` **只置 null** —— 绝不 `app.quit()`（关管理页不能带走 App）',
  /adminWin\.on\('closed', \(\) => \{/.test(adminCode) && !/app\.quit\(\)/.test(adminCode));
ok('v18壳：管理窗 `closed` **不碰上游子进程**（上游归主窗生命周期管）',
  !/child\.kill|cleanup\(\)|childOwned/.test(adminCode));
ok('v18壳：管理窗**单例**（已开则 focus，不再开第二个）',
  /if \(adminWin && !adminWin\.isDestroyed\(\)\) \{ adminWin\.focus\(\); return adminWin; \}/.test(adminCode));
ok('v18壳：管理窗 webPreferences 守住 contextIsolation + 无 nodeIntegration',
  /contextIsolation: true/.test(adminCode) && /nodeIntegration: false/.test(adminCode)
  && /preload: path\.join\(__dirname, 'preload\.js'\)/.test(adminCode));
ok('v18壳：管理窗**自带**一套 setWindowOpenHandler（每 webContents 一套，不会从主窗继承）',
  /adminWin\.webContents\.setWindowOpenHandler/.test(adminCode)
  && /shell\.openExternal\(url\)/.test(adminCode));
ok('v18壳：管理页的动作条是**注入**的（上游 HTML 一个字节不动，同 BACK_BTN_JS 套路）',
  /adminWin\.webContents\.on\('did-finish-load'/.test(adminCode)
  && /executeJavaScript\(ADMIN_BAR_JS, true\)/.test(adminCode));
ok('v18壳：动作条只挂**无页面上下文**的动作（不去猜工作台的 DOM）',
  /S\.openDlRoot\(\)/.test(MAIN) && /S\.scanGames\(\)/.test(MAIN) && /S\.focusApp\(\)/.test(MAIN));

/* ============================ ② 壳：上游实例归属（不许猜） ============================ */
const iRef = MAIN.indexOf('async function refreshUpInfo(');
const refFn = MAIN.slice(iRef, MAIN.indexOf('\n}', MAIN.indexOf('return upInfo;', iRef)) + 2);
ok('v18壳：归属判定用 `child.pid === pid` **比对**，不是「health 有返回就算我的」',
  /const owned = !reused && !!child && child\.pid === pid;/.test(refFn), refFn.slice(0, 0));
ok('v18壳：health 里**没有 pid** ⇒ 归「unknown」（老版上游时如实说不确定）',
  /owner: pid \? \(owned \? 'shell' : 'external'\) : 'unknown'/.test(refFn));
ok('v18壳：复用外部实例时不冒认（`reused` 参与判定）',
  /!reused && !!child/.test(refFn));
ok('v18壳：`/api/health` 的 JSON 解析失败要**吞掉**回 null（旧版上游回的不一定是 JSON）',
  /try \{ resolve\(JSON\.parse\(buf\)\); \} catch \(e\) \{ resolve\(null\); \}/.test(MAIN));
ok("v20壳：`shell:describe` 的版本号已升到 v20（页面靠它判断壳能力）",
  /version: 'v24'/.test(MAIN) && /version: 'v24'/.test(PRELOAD));

/* ============================ ③ preload 暴露面 ============================ */
ok('v18preload：暴露 `__SHELL_ADMIN__`，且只传 `String(act)`',
  /exposeInMainWorld\('__SHELL_ADMIN__', \(act\) =>\s*ipcRenderer\.invoke\('shell:admin', String\(act \|\| 'open'\)\)/.test(PRELOAD));
ok('v18preload：`openDlRoot` / `focusApp` **无入参**转发',
  /openDlRoot: \(\) => ipcRenderer\.invoke\('shell:openDlRoot'\)/.test(PRELOAD)
  && /focusApp: \(\) => ipcRenderer\.invoke\('shell:focusApp'\)/.test(PRELOAD));
ok('v18preload：没有把 `ipcRenderer` 本体暴露出去（contextIsolation 的意义就在这）',
  !/exposeInMainWorld\([^)]*ipcRenderer\s*\)/.test(PRELOAD)
  && /contextIsolation/.test(PRELOAD));

/* ============================ ④ 上游：v18 两处授权改动 ============================ */
if (!hasUpstream) {
  console.log('!! 找不到上游 server.js，跳过第 ④ 段：' + UPSTREAM);
} else {
  ok('v18上游：默认只绑回环 —— `listen(port, HOST,` 而不是 `listen(port,`',
    /app\.listen\(port, HOST, \(\) =>/.test(UP) && !/app\.listen\(port, \(\) =>/.test(UP));
  ok('v18上游：`HOST` 默认 `127.0.0.1`，且保留 `GAMEHUB_HOST` 逃生开关（能力不删，只改默认）',
    /const HOST = process\.env\.GAMEHUB_HOST \|\| '127\.0\.0\.1';/.test(UP));
  ok('v18上游：启动日志打出**真实**监听地址（否则排查时会以为还是 0.0.0.0）',
    /聚合站已启动: http:\/\/\$\{HOST\}:\$\{port\}/.test(UP));
  ok('v18上游：`/api/health` 保留 ok/ts/ttl —— **只增不改**，老调用方零影响',
    /ok: true, ts: Date\.now\(\), ttl: \{ feed: 180, detail: 600 \},/.test(UP));
  ok('v18上游：`/api/health` 新增 pid / startedAt / shell（壳靠它确证实例归属）',
    /pid: process\.pid,/.test(UP) && /startedAt: BOOT_AT,/.test(UP)
    && /shell: process\.env\.GAMEHUB_SHELL === '1',/.test(UP));
  ok('v18上游：`BOOT_AT` 定义在模块级且只取一次（不是每次请求现算）',
    /const BOOT_AT = Date\.now\(\);/.test(UP) && (UP.match(/BOOT_AT = Date\.now\(\)/g) || []).length === 1);
  ok('v18上游：改动**只这两处** —— 除 `HOST`/`BOOT_AT` 外没有新增模块级常量（防越权扩散）',
    (UP.match(/^const (HOST|BOOT_AT) /gm) || []).length === 2);
}

/* ==================== ⑤ v19：下载引擎（aria2）已接入 ====================
   用户口径（2026-10-22）：「先建设好，记得关联和预留管理接口」。
   这一节守两件事：
     ① **关联**：页面只调一个 `startDownload`，主进程按「有没有引擎」决定后端；
        进度事件形状与旧下载器**完全一致**（页面零改动）。
     ② **安全边界**：`dir` 与 RPC secret 永不进页面；页面只能传 magnet 字符串。
   行为验证见 `_t_aria2.js`（27 条，真起进程真下载）；这里只守静态契约。 */

const eng = handlerBody(MAIN, 'shell:dl-engine');
ok('v19壳：`shell:dl-engine` 只接受一个**布尔 force**（强制重探），没有路径 / URL 入参',
  eng.length > 0 && /ipcMain\.handle\('shell:dl-engine', async \(_e, force\) =>/.test(eng)
  && !/\b(dir|path|url)\b\s*[,)]/.test(eng));

const mgPrev = handlerBody(MAIN, 'shell:dl-magnet-preview');
ok('v19壳：`shell:dl-magnet-preview` **只接受 magnet 一个入参**（页面拿不到「指定落盘目录」的能力）',
  mgPrev.length > 0
  && /ipcMain\.handle\('shell:dl-magnet-preview', async \(_e, magnet\) =>/.test(mgPrev)
  && !/\bdir\b\s*[,)]/.test(mgPrev) && !/writeFile|createWriteStream/.test(mgPrev));
ok('v19壳：磁力入参在主进程侧校验形态（`xt=urn:btih:`），不是「有字就收」',
  /xt=urn:btih:\[A-Za-z0-9\]\{32,40\}/.test(mgPrev) && /code: 'bad-magnet'/.test(mgPrev));
ok("v19壳：引擎不可用时回 `code:'engine-not-ready'`（页面据此说「未接入」，而不是笼统「失败」）",
  /code: 'engine-not-ready'/.test(mgPrev));
ok('v19壳：磁力预览的等待时长可由 `GI_MAGNET_PREVIEW_MS` 覆盖（否则烟雾测试只能等满 45s）',
  /process\.env\.GI_MAGNET_PREVIEW_MS/.test(mgPrev));

/* ---- 关联：一个入口、两个后端 ---- */
const startH = handlerBody(MAIN, 'shell:dl-start');
ok('v19关联：`shell:dl-start` 是**唯一入口** —— 先问引擎，成功就交 aria2（页面不知道后端是谁）',
  /ensureEngine\(\)/.test(startH) && /aria2\.add\(/.test(startH));
ok('v19关联：引擎不可用 / 拒绝时**自动回落**内置单连下载器（旧行为不丢）',
  /回落内置下载器/.test(startH) && /await startDownload\(opt\)/.test(startH));
ok('v19关联：磁力在没有引擎时**明确拒绝**而不是悄悄当网盘链处理（`code:engine-required`）',
  /code: 'engine-required'/.test(startH));
ok('v19关联：`gid ↔ 页面任务 id` 有映射（否则页面收不到进度 —— 会表现成「卡在 0%」）',
  /const gidAlias = new Map\(\)/.test(MAIN) && /gidAlias\.set\(String\(r\.id\)/.test(MAIN));
ok('v19关联：进度回推**保持原形状**（只补 `engine` 字段），页面无需改动',
  /shell:dl-progress'/.test(MAIN) && /Object\.assign\(\{\}, t, \{ id: pageIdOf\(t\.id\), engine: 'aria2' \}\)/.test(MAIN));

/* ---- 管理接口（预留面）---- */
for (const name of ['shell:dl-list', 'shell:dl-remove', 'shell:dl-clear', 'shell:dl-stats', 'shell:dl-options']) {
  ok('v19管理：`' + name + '` 存在', handlerBody(MAIN, name).length > 0);
}
ok('v19管理：`shell:dl-list` 返回的是**引擎真值**（用 aria2.list，不是页面内存那份）',
  /aria2\.list\(\)/.test(handlerBody(MAIN, 'shell:dl-list')));
ok('v19管理：删任务**只删记录**、不碰已落盘的文件（不出现 fs 删除调用）',
  !/unlink|rmSync|rimraf/.test(handlerBody(MAIN, 'shell:dl-remove')));

/* ---- 安全边界（写死在引擎模块里）---- */
ok('v19安全：RPC **只绑回环** —— `--rpc-listen-all=false` 与 `--rpc-allow-origin-all=false` 都在启动参数里',
  /'--rpc-listen-all=false'/.test(ARIA2JS) && /'--rpc-allow-origin-all=false'/.test(ARIA2JS));
ok('v19安全：RPC secret **每次启动随机**（`randomBytes`），不是写死常量',
  /P\.secret = crypto\.randomBytes\(16\)\.toString\('hex'\)/.test(ARIA2JS));
/* ★ 必须先剥注释再判：`info()` 里那句注释本身就写着「不报 port / secret」，
   不剥的话断言会被自己的注释判假（这个项目已经踩过三次同类坑）。 */
const ARIA2_CODE = ARIA2JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const infoBody = (ARIA2_CODE.match(/function info\(\)[\s\S]*?\n\}/) || [''])[0];
const infoReturn = (infoBody.match(/return \{[\s\S]*?\};/) || [''])[0];
ok('v19安全：`info()` 的**返回对象**不含 port / secret（内部用 P.port 判活着，但不往外交）',
  infoReturn.length > 0 && !/\bport\b/i.test(infoReturn) && !/secret/i.test(infoReturn),
  infoReturn.replace(/\s+/g, ' ').slice(0, 90));
ok('v19安全：`setOptions()` **明确拒绝改 dir**（`code:dir-locked`）—— 目录只能由主进程算',
  /code: 'dir-locked'/.test(ARIA2JS));
ok('v19安全：`spawn` 一律 `windowsHide` + 不走 shell（无命令注入面）',
  !/spawn\([^)]*shell:\s*true/.test(ARIA2JS) && /windowsHide: true/.test(ARIA2JS));

/* ---- 已知坑必须留在代码里 ---- */
ok('v19坑位：session 文件必须**预建**（否则 aria2 直接异常退出 `download_helper.cc:562`）',
  /if \(!fs\.existsSync\(session\)\) fs\.writeFileSync\(session, ''\)/.test(ARIA2JS));
ok('v19坑位：启动参数**不许带 `--quiet`**（它会把致命错误吞掉，表现成「RPC 起不来」）',
  !/'--quiet=true'/.test(ARIA2JS));
ok('v19坑位：`before-quit` 必须**同步**杀掉引擎（`app.on` 里不能 await）',
  /aria2\.hardKill\(\)/.test(MAIN) && /function hardKill\(\)/.test(ARIA2JS));

/* ---- 打包：二进制与合规件必须进包 ---- */
ok('v19打包：`aria2.js` 在 SHELL_FILES 里（漏了它 = 包内 require 不到）',
  /'aria2\.js'/.test(PACKPY));
ok('v19打包：`vendor/` 有就拷、没有就跳过（将来换版本不用改脚本）',
  /VENDOR_SRC/.test(PACKPY) && /vendor\/ 不存在 ⇒ 跳过/.test(PACKPY));

/* ---- preload 暴露面 ---- */
ok('v19壳：preload 暴露 4 个引擎方法（dlEngine 带 force）',
  /dlEngine: \(force\) => ipcRenderer\.invoke\('shell:dl-engine', !!force\)/.test(PRELOAD)
  && /dlMagnetPreview: \(magnet\) => ipcRenderer\.invoke\('shell:dl-magnet-preview'/.test(PRELOAD)
  && /dlPause: \(id\) => ipcRenderer\.invoke\('shell:dl-pause'/.test(PRELOAD)
  && /dlResume: \(id\) => ipcRenderer\.invoke\('shell:dl-resume'/.test(PRELOAD));
ok('v19壳：preload 暴露 5 个管理方法（dlList / dlRemove / dlClear / dlStats / dlOptions）',
  /dlList: \(\) => ipcRenderer\.invoke\('shell:dl-list'\)/.test(PRELOAD)
  && /dlRemove: \(id\) => ipcRenderer\.invoke\('shell:dl-remove'/.test(PRELOAD)
  && /dlClear: \(\) => ipcRenderer\.invoke\('shell:dl-clear'\)/.test(PRELOAD)
  && /dlStats: \(\) => ipcRenderer\.invoke\('shell:dl-stats'\)/.test(PRELOAD)
  && /dlOptions: \(o\) => ipcRenderer\.invoke\('shell:dl-options'/.test(PRELOAD));

/* ==================== ⑥ v20：借鉴迅雷的两项壳层能力 ====================
   ① 下载期间阻止系统休眠  ② 关窗前先问一句（还在下载时）
   两条都不是「好看」，而是**长任务不被打断**。 */

ok('v20壳：`powerSaveBlocker` 已从 electron 取用',
  /powerSaveBlocker\s*\}\s*=\s*require\('electron'\)/.test(MAIN));
ok('v20壳：用的是 `prevent-app-suspension`（**只防应用被挂起，屏幕照常可关**）—— 不是 display-sleep',
  /powerSaveBlocker\.start\('prevent-app-suspension'\)/.test(MAIN)
  && !/powerSaveBlocker\.start\('prevent-display-sleep'\)/.test(MAIN));
ok('v20壳：活跃下载集合跟着**进度事件**维护（不额外轮询 RPC）',
  /const activeDlIds = new Set\(\)/.test(MAIN)
  && /t\.state === 'running' \|\| t\.state === 'waiting'\) activeDlIds\.add/.test(MAIN));
ok('v20壳：取消任务时把它从活跃集合摘掉（否则休眠抑制永远不释放）',
  /activeDlIds\.delete\(pid\); activeDlIds\.delete\(g\); syncSleepBlocker\(\)/.test(MAIN)
  || /activeDlIds\.delete\(pid\); syncSleepBlocker\(\)/.test(MAIN));

ok('v20壳：关窗前有**拦截时机**（`win.on(\'close\'`）—— `closed` 里已经来不及拦',
  /win\.on\('close', \(e\) => \{ confirmQuitWithDownloads\(e\); \}\)/.test(MAIN));
ok('v20壳：确实用原生询问（`showMessageBoxSync`）+ `preventDefault()`，不是硬杀',
  /showMessageBoxSync\(win, \{/.test(MAIN) && /e\.preventDefault\(\);/.test(MAIN));
ok('v20壳：确认文案如实提到**续传**（aria2 session 已保存），不空口承诺',
  /session）已保存，下次启动可以接着下/.test(MAIN));
ok('v20壳：`forceQuit` 闸门存在（用户选「仍然退出」后不再重复弹窗）',
  /let forceQuit = false;/.test(MAIN) && /if \(forceQuit \|\| !win\) return false;/.test(MAIN));

/* ---- v21：管理窗默认页修正 ---- */
ok('v21壳：管理窗默认打开 /admin.html（上游 public 下 index.html 是工作台、admin.html 才是管理后台）',
  /String\(startPath \|\| ''\)\) \? startPath : '\/admin\.html'/.test(MAIN));
ok('v21壳：起始页仍由主进程**正则校验**（页面拿不到任意 URL 的能力，这条没放松）',
  /\^\\\/\[A-Za-z0-9\._\\-\/\?=&%\]\*\$/.test(MAIN) && /\.includes\('\.\.'\)/.test(MAIN));

/* ---- v22：网盘直链的 `header` 透传 ---- */
ok('v22壳：`shell:dl-start` 把 `opt.header` 交给引擎（网盘直链常要特定 UA/Referer）',
  /header: opt\.header,/.test(handlerBody(MAIN, 'shell:dl-start')));
ok('v22壳：`aria2.add` 把 header **归一化成字符串数组**（aria2 的 `header` 选项要求数组，传字符串会报错）',
  /Array\.isArray\(o\.header\) \? o\.header : String\(o\.header\)\.split\(\/\\r\?\\n\/\)/.test(ARIA2JS)
  && /if \(clean\.length\) opts\.header = clean;/.test(ARIA2JS));
ok('v22壳：header 由**上游（OpenList）给**，代码里不出现自造的 UA/Cookie 常量',
  !/(User-Agent|user-agent):\s*['"][^'"]{10,}['"]\s*,?\s*\/\/\s*网盘/.test(ARIA2JS));

console.log('==========================================');
console.log(`通过 ${pass} / ${pass + fail}`);
if (fails.length) { console.log('--- FAIL ---'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('全部通过 ✓');
console.log('==========================================');
process.exit(fail ? 1 : 0);
