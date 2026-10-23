/**
 * 下载与资源 · 联网行为探针（**需要本机 8123 服务在跑**）
 * ---------------------------------------------------------------------------
 * 为什么与 _t_demo.js 分开：
 *   _t_demo.js 是**离线**回归（跑在不联网的 jsdom 里；条数随版本增长，
 *   **以运行时打印的「通过 N / M」为准** —— 这里刻意不写死数字，免得每版都过期），
 *   这条链路要真打上游接口，混进去会让主套件变慢且依赖网络。
 *
 * ★v15 覆盖：详情弹窗四页签与下载入口 / **实时层真的换了全量数据** /
 *            **游戏库页真拉分页（>10000 款）** / 无壳态的优雅降级。
 *
 * 运行：
 *   NODE_PATH="C:/Users/komo/.workbuddy/binaries/node/workspace/node_modules" \
 *   "C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" _t_dl.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = __dirname;
const htmlRaw = fs.readFileSync(path.join(DIR, 'index.html'), 'utf-8');
const dataJs = fs.readFileSync(path.join(DIR, 'data.js'), 'utf-8');
const html = htmlRaw.replace(
  /<script src="data\.js"><\/script>/,
  '<script>' + dataJs.replace(/<\/script/gi, '<\\/script') + '</script>'
);

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

/* jsdom 不带 fetch / AbortController ⇒ 必须在**页面脚本执行之前**补上。
   ★v14 教训：改到 `beforeParse` 里注入。
     原来是在 `new JSDOM(...)` 之后才赋 `win.fetch`，那时页面尾部的
     「PC 工作台导航」IIFE 已经跑完 `dlBoot()` 并把「无服务」的结论缓存进了 `DL_BOOT`,
     于是后面所有探测都直接拿到空结果 —— 探针自己把被测对象毒死了。 */
const { VirtualConsole } = require('jsdom');
const navAttempts = [];   /* jsdom 拦下的「跳转到别的文档」—— 就是点击入口的取证 */
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (/navigation/i.test(e.message || '')) navAttempts.push(e.message); });
vc.on('error', () => {});
vc.on('warn', () => {});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://127.0.0.1:8123/',
  beforeParse(w) {
    w.fetch = (u, o) => fetch(u, o);
    if (!w.AbortController) w.AbortController = AbortController;
  },
});
const win = dom.window, doc = win.document;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== ★v14 下载与资源 · 联网探针 ===');
  // 等探测 Promise
  const base = await win.eval('dlBoot()');
  console.log('探测结果 DL_BASE =', JSON.stringify(base));
  ok('1) 探测到本机服务', base === 'http://127.0.0.1:8123' || base === win.location.origin, base);

  // 打开「赛博朋克2077」的详情（pcHot 里命中率最高的一款）
  const D = win.__DEMO_DATA__;
  const idx = (D.pcHot || []).findIndex(a => String(a.title).includes('赛博朋克'));
  console.log('   pcHot 里赛博朋克的下标 =', idx);
  ok('2) 找到测试样本', idx >= 0);

  win.eval(`resetState('pcHot'); render();`);
  win.eval(`openDetail('pcHot', ${idx})`);
  await sleep(400);
  let box = doc.getElementById('dlBlock');
  ok('3) 弹窗里出现 #dlBlock', !!box);
  ok('4) 四个页签齐', doc.querySelectorAll('#dlBlock .dlm').length === 4,
     String(doc.querySelectorAll('#dlBlock .dlm').length));
  const tabsTxt = [...doc.querySelectorAll('#dlBlock .dlm')].map(b => b.textContent.trim()).join(' | ');
  console.log('   页签:', tabsTxt);

  // 等 Mod / 修改器 / 存档 三个便宜接口回来
  await sleep(2500);
  const badges = [...doc.querySelectorAll('#dlBlock .dlm')].map(b => b.textContent.trim());
  console.log('   带计数:', badges.join(' | '));
  ok('5) Mod 页签拿到条数', /Mod\s*\d+/.test(badges[1] || ''), badges[1]);
  ok('6) 存档页签拿到条数', /存档\s*\d+/.test(badges[3] || ''), badges[3]);

  // 切到 Mod 页签 → 应出现带真链接的行
  doc.querySelector('[data-dlm="mod"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  const modLinks = doc.querySelectorAll('#dlBlock .dlbody .lk a[href^="http"]');
  console.log('   Mod 页签可点链接数 =', modLinks.length);
  ok('7) Mod 页签有可点的真链接', modLinks.length > 0);
  const firstHref = modLinks[0] && modLinks[0].getAttribute('href');
  console.log('   首个链接:', firstHref);
  ok('8) 首个链接是网盘/下载域', /^https?:\/\//.test(firstHref || ''), firstHref);

  // 展开全部
  const more = doc.querySelector('#dlBlock [data-dlmore]');
  console.log('   展开按钮:', more ? more.textContent.trim() : '（无，条数未超上限）');
  if (more) {
    more.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    const after = doc.querySelectorAll('#dlBlock .dlbody .dlrow').length;
    console.log('   展开后可点行数 =', after);
    ok('9) 展开后行数增加', after > 8, String(after));
  }

  // 本体页签（最贵，跟随 302）
  doc.querySelector('[data-dlm="body"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  console.log('   本体页签 → 等待抓取…');
  await sleep(20000);
  const bodyTxt = (doc.querySelector('#dlBlock .dlbody') || {}).textContent || '';
  const bodyLinks = doc.querySelectorAll('#dlBlock .dlbody .lk a[href^="http"]').length;
  console.log('   本体可点链接数 =', bodyLinks);
  console.log('   本体区文案:', bodyTxt.replace(/\s+/g, ' ').slice(0, 140));
  ok('10) 本体页签给出「链接」或「明确原因」', bodyLinks > 0 || /没有|登录|权限|失败/.test(bodyTxt));

  // 关弹窗 → 会话作废
  win.eval('closeDetail()');
  await sleep(100);
  const st = win.eval('dlSt');
  ok('11) 关弹窗后 dlSt 作废', st === null, JSON.stringify(st));

  /* ---- ★v15 本机三页：游戏库（实时全量）/ 我的游戏 / 下载管理 ----
     v14 那批「PC 工作台入口」断言随 `#hubNav` 整块下线一起退场（用户口径：
     工作台是单独的项目）。这里换成 v15 新增能力的**联网**断言 ——
     它们必须真打 8123 才能验，所以放在本探针而不是离线回归里。 */
  ok('12) 侧栏的工作台外部入口已整块移除',
     !doc.getElementById('hubNav') && doc.querySelectorAll('.nav [data-hub]').length === 0,
     doc.querySelectorAll('.nav [data-hub]').length);

  /* 实时层：启动时 refreshLive() 并发拉 6 路，等它落地 */
  await sleep(7000);
  const live = JSON.parse(win.eval(`JSON.stringify({
    pcNew: D.pcNew.length, pcHot: D.pcHot.length, pcMod: D.pcMod.length,
    pcTrainer: D.pcTrainer.length, mPlay: D.mPlay.length, pcRank: D.pcRank.length,
  })`));
  console.log('   实时覆盖条数:', JSON.stringify(live));
  /* pcNew / pcHot 各翻 3 页 = 300 条（上游 `/api/library/browse` 的 limit 上限实测是 100，
     传 300/500 都只回 100，所以必须靠 offset 翻页 —— 见 refreshLive 里的 livePage）。 */
  ok('13) 五个 Tab 都被实时数据覆盖（pcNew/pcHot 翻 3 页，其余单次 300）',
     live.pcNew >= 250 && live.pcHot >= 250 && live.pcMod >= 250 &&
     live.pcTrainer >= 250 && live.mPlay >= 250 && live.pcRank > 0,
     JSON.stringify(live));
  ok('13b) 实时数据确实换了源（条数远超快照上限 80）',
     live.pcNew > 80 && live.pcMod > 80 && live.pcTrainer > 80);

  /* 游戏库页：真拉 /api/library/browse 分页 */
  await win.eval('libLoad(true)');
  await sleep(2000);
  const lib = JSON.parse(win.eval('JSON.stringify({ t: LOCAL.lib.total, n: LOCAL.lib.items.length })'));
  console.log('   游戏库:', JSON.stringify(lib));
  ok('14) 游戏库页拿到全量总数（>10000 款）', lib.t > 10000, String(lib.t));
  /* ★v16-A 口径变化：用户「一页显示 50 个」⇒ 页长由 v15 的 60 改成 50
     （页面 `PAGE_SIZES=[20,50,100]`、`PG_DEF=50`，且**各 Tab 统一**，游戏库页也在内）。
     期望值 60 → 50 **是随口径改的，不是「改断言迁就实现」** ——
     判据仍是「首屏恰好载入一整页」（`lib.items.length === PG_DEF`），只是那一页变短了。 */
  ok('14b) 游戏库页首屏载入 50 条（v16 起一页 50）', lib.n === 50, String(lib.n));

  /* 下载入口：两态文案必须分得清（这是「全都直链」与「如实说边界」的分界） */
  const bDirect = win.eval(`dlBtns('https://a.com/p.zip', 'n')`);
  const bPan = win.eval(`dlBtns('https://pan.xunlei.com/s/x', 'n')`);
  ok('15) 直链给「下载」按钮、网盘给「复制链接」（无壳态文案）',
     /⬇ 下载/.test(bDirect) && /☁️ 复制链接/.test(bPan), bDirect.slice(0, 50) + ' | ' + bPan.slice(0, 50));
  ok('15b) 源码里带值写成 data-dlstart="1"（空属性会让按钮点了没反应）',
     /data-dlstart="1"/.test(htmlRaw));

  /* 无壳态：我的游戏必须给原因，且不留死按钮 */
  win.eval('resetState("myGames"); render();');
  const mgHtml = doc.getElementById('main').innerHTML;
  ok('16) 无壳态「我的游戏」明说需要桌面版，且不给「开始扫描」假按钮',
     /扫盘需要桌面版/.test(mgHtml) && !/id="mgscan"/.test(mgHtml));

  console.log('==========================================');
  console.log(`通过 ${pass} / ${pass + fail}`);
  console.log(fail ? '有未通过项 ✗' : '全部通过 ✓');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
