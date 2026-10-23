'use strict';
/* electron/_t_aria2.js —— 下载引擎模块的**独立测试**（不跑 Electron）
   ============================================================================
   为什么能单测：`aria2.js` **不 require('electron')`，只依赖 node 内置模块。
   （壳层的 `main.js` 则必须靠源码级契约 + 成品 smoke，见 _t_shell.js）

   跑法：node _t_aria2.js
   依赖：本机 8123（只用来取一个真实的小文件当下载目标）；BT 预览需要出站。
   ============================================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const aria2 = require('./aria2');

const HERE = __dirname;
const BIN = path.join(HERE, 'vendor', 'aria2', process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-aria2-'));
const STATE = path.join(TMP, 'state');
const DL = path.join(TMP, 'dl');
const TARGET = 'http://127.0.0.1:8123/api/health';
const MAGNET = 'magnet:?xt=urn:btih:7ACF8FB590B2060DD9C3146EF770169D593433B0'
  + '&dn=debian-13.7.0-amd64-netinst.iso'
  + '&tr=http%3A%2F%2Fbttracker.debian.org%3A6969%2Fannounce';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (detail ? '  → ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== ★v19 下载引擎（aria2.js）独立测试 ===');
  console.log('bin   = ' + BIN);
  console.log('tmp   = ' + TMP);
  ok('aria2c 存在', fs.existsSync(BIN));

  const events = [];
  const seenStates = new Set();

  /* ---------- ① 启动 ---------- */
  const t0 = Date.now();
  let inf = null;
  try { inf = await aria2.start({ bin: BIN, stateDir: STATE, dir: DL, onProgress: (m) => { events.push(m); seenStates.add(m.state); } }); }
  catch (e) { ok('引擎启动', false, String(e && e.message)); }
  console.log('  启动耗时 ' + (Date.now() - t0) + ' ms');
  ok('引擎启动成功', !!(inf && inf.running));
  ok('版本号拿到了（1.37.x）', !!(inf && /^1\.3\d\./.test(inf.version)), inf && inf.version);
  ok('**session 文件被预建**（不预建的话 aria2 会直接异常退出 —— 实测坑）',
    fs.existsSync(path.join(STATE, 'aria2.session')));
  ok('info() **不泄露 port / secret**',
    inf && inf.port === undefined && inf.secret === undefined, JSON.stringify(inf));

  /* ---------- ② HTTP 直链：真下一个 ----------
     ★ 为什么要先限速：144 B 的本机文件不到 700 ms 就完了，而轮询周期是 700 ms
       ⇒ **根本观察不到 `active`（running）** 这一态。
       这是我第一版断言写错的原因（不是引擎的 bug）——
       测「能推出 running」必须让下载**活得比一个轮询周期长**。 */
  const lim = await aria2.setOptions({ speedLimitKB: 40 });
  ok('先设全局限速 40KB/s（制造可观察的 running）', !!(lim && lim.ok), JSON.stringify(lim));

  const before = new Set(fs.readdirSync(DL));
  const add = await aria2.add({ url: 'http://127.0.0.1:8123/api/mods/list?limit=60', out: 't-mods.json' });
  ok('addUri 接单（返回 gid）', !!(add && add.ok && /^[0-9a-f]{16}$/.test(String(add.id))), JSON.stringify(add));

  for (let i = 0; i < 120; i++) {
    const list = await aria2.list();
    const t = list.find((x) => x.id === add.id);
    if (t && (t.state === 'done' || t.state === 'fail')) break;
    await sleep(300);
  }
  /* ★ 竞态：上面用 `list()` 看到 done 就跳出，但**轮询**（700 ms）可能还没推完最后那一帧。
     不是我方 bug，是测试太急 —— 等两个轮询周期再断言。 */
  await sleep(1600);
  const fp = path.join(DL, 't-mods.json');
  ok('文件真的落盘', fs.existsSync(fp), fp);
  let modsTotal = 0;
  if (fs.existsSync(fp)) {
    const raw = fs.readFileSync(fp, 'utf8');
    let j = null; try { j = JSON.parse(raw); } catch (e) { /* */ }
    modsTotal = (j && Number(j.total)) || 0;
    ok('落盘内容是合法 JSON 且 total > 0（不是 0 字节壳）', !!(j && j.ok === true && modsTotal > 0), raw.slice(0, 60));
  }
  ok('进度事件真的推出来了（能观察到 running，最后是 done）',
    events.length >= 2 && seenStates.has('running') && seenStates.has('done'),
    'events=' + events.length + ' states=' + [...seenStates].join(','));
  /* 轮询是 700 ms 一次 + 变化才推 ⇒ 事件数必须远少于「文件字节数/64K」这种粒度 */
  ok('进度是**节流**过的（事件数很少，不会把 IPC 打满）', events.length <= 40, 'events=' + events.length);
  await aria2.setOptions({ speedLimitKB: 0 });

  /* ---------- ③ 清单 / 统计 / 选项（管理接口） ---------- */
  const list1 = await aria2.list();
  ok('list() 能拿到任务', list1.length >= 1, 'n=' + list1.length);
  const st = await aria2.stats();
  ok('stats() 返回全局统计（含 active/waiting/stopped）',
    !!(st && st.ok && st.global && typeof st.global.stopped === 'number'), JSON.stringify(st.global || {}));
  ok('stats() 带出 enabledFeatures 且**含 BitTorrent**',
    !!(st && st.features && st.features.indexOf('BitTorrent') >= 0), (st && st.features || []).join(','));

  const opts = await aria2.getOptions();
  ok('getOptions() 能读（含 dir / maxConcurrent）',
    !!(opts && opts.ok && opts.options && opts.options.maxConcurrent >= 1), JSON.stringify(opts.options || {}));
  ok('getOptions() 的 dir = 我们指定的下载目录', opts && opts.options && path.resolve(opts.options.dir) === path.resolve(DL));

  const setOk = await aria2.setOptions({ maxConcurrent: 2, speedLimitKB: 0 });
  ok('setOptions() 能写（范围校验通过）', !!(setOk && setOk.ok), JSON.stringify(setOk));
  const after = await aria2.getOptions();
  ok('写入真的生效（maxConcurrent 3 → 2）', after && after.options && after.options.maxConcurrent === 2,
    'got=' + (after && after.options && after.options.maxConcurrent));

  const badRange = await aria2.setOptions({ split: 999 });
  ok('setOptions() 拒绝越界值（split=999）', !!(badRange && !badRange.ok && badRange.code === 'bad-option'), JSON.stringify(badRange));
  const badDir = await aria2.setOptions({ dir: 'C:\\Windows' });
  ok('★ setOptions() **明确拒绝改 dir**（页面拿不到「往任意路径写」的能力）',
    !!(badDir && !badDir.ok && badDir.code === 'dir-locked'), JSON.stringify(badDir));

  /* ---------- ④ 磁力：只取元数据出清单 ---------- */
  const pv = await aria2.preview(MAGNET, { timeout: 60000 });
  ok('preview() 拿到文件清单', !!(pv && pv.ok && pv.files && pv.files.length >= 1),
    JSON.stringify({ ok: pv && pv.ok, code: pv && pv.code, err: pv && pv.error, n: (pv && pv.files || []).length }));
  if (pv && pv.ok) {
    ok('清单里每条都有 path 与 length', pv.files.every((f) => f.path && f.length > 0));
    ok('totalBytes = 各文件长度之和',
      pv.totalBytes === pv.files.reduce((s, f) => s + f.length, 0), String(pv.totalBytes));
    console.log('    → ' + pv.files.length + ' 个文件 · 共 ' + (pv.totalBytes / 1048576).toFixed(1) + ' MB · 首个 ' + pv.files[0].path);
  }
  /* ★ 预览**不许**顺手把正文下起来：列表里不应残留「正在下」的种子任务 */
  const listAfterPreview = await aria2.list();
  const stillRunning = listAfterPreview.filter((t) => t.state === 'running' && t.kind === 'magnet');
  ok('★ 预览后**没有**残留的磁力任务在偷偷下载（预览只出清单）',
    stillRunning.length === 0, 'running=' + stillRunning.length);

  /* ---------- ⑤ 收尾 ---------- */
  const cl = await aria2.act('clear');
  ok('clear() 能清已结束记录', !!(cl && cl.ok), JSON.stringify(cl));
  const badAct = await aria2.act('nuke', 'x');
  ok('act() 拒绝未知动作', !!(badAct && !badAct.ok && badAct.code === 'bad-action'), JSON.stringify(badAct));

  await aria2.stop();
  await sleep(500);
  ok('stop() 之后 info() 报未运行', aria2.info().running === false);

  console.log('');
  console.log('==========================================');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach((f) => console.log('  ✗ ' + f)); }
  else console.log('全部通过 ✓');
  console.log('==========================================');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('!! 测试崩溃：' + (e && e.stack || e));
  try { aria2.hardKill(); } catch (_) { /* */ }
  process.exit(2);
});
