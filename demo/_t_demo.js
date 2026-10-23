/**
 * jsdom 端到端行为回归 —— 游戏情报客户端 demo
 * 运行：
 *   NODE_PATH="C:/Users/komo/.workbuddy/binaries/node/workspace/node_modules" \
 *   "C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" _t_demo.js
 *
 * 覆盖（v5）：
 *   0) 数据层：三源白名单、同游戏合并、封面修复
 *   1) 结构：9 个 Tab、侧栏计数
 *   2) 筛选栏 / 排序 pills / 搜索
 *   3) 图片系统：referrerpolicy、比例自适应、方形图模糊铺底
 *   4) 卡片固定布局 + ★ 骨架统一（PC 5 Tab + 可玩端游）
 *   5) ★ 手游新游卡（参考图版式）：icon + 游戏名·状态 🔥 + 标签 + 绿色时效行 + 右侧大号评分
 *   6) ★ 弹窗详情：全 Tab 覆盖、内容正确、三路关闭
 *   7) 全 Tab 遍历不报错（原「7) ★ 报告可折叠列表」已于 v12 随模块移除）
 *   8) ★v13 搜索重做（字段白名单 + 五档加权）/ 列表局部刷新 / 3 档响应式断点
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = __dirname;
/* ★ 被测文件可由环境变量指定 —— `_counterproof.py` 打坏点时写的是 `_mut.html`，
   这样反证**永远不碰 index.html**。
   （踩过的坑：反证脚本原先「打坏 → 写回快照 → 再跑」，一旦中途被打断，
      index.html 就会停在打坏版上；而且它启动时快照的是那一刻的内容，
      跑的过程中若有人编辑 index.html，还原那一步会把编辑一起抹掉。） */
const TARGET = process.env.T_DEMO_HTML || 'index.html';
const htmlRaw = fs.readFileSync(path.join(DIR, TARGET), 'utf-8');
const dataJs = fs.readFileSync(path.join(DIR, 'data.js'), 'utf-8');

// ★ 把 <script src="data.js"> 内联替换掉：jsdom 默认不加载外部脚本，
//   若不内联，页面脚本里的 `const D = window.__DEMO_DATA__ || {}` 会求值成空对象。
const html = htmlRaw.replace(
  /<script src="data\.js"><\/script>/,
  '<script>' + dataJs.replace(/<\/script/gi, '<\\/script') + '</script>'
);

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  → ' + extra : '')); }
}

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window, doc = win.document;
const D = win.__DEMO_DATA__;
if (!D) { console.error('!! 数据注入失败：window.__DEMO_DATA__ 为空'); process.exit(2); }

const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
const main = () => doc.getElementById('main');
const cards = () => $$('#main .card');
/* 侧栏导航项一律认 `[data-tab]`（`data-hub` 那组外部跳转入口已于 v15 整块移除）。 */
const navs = () => $$('.nav a[data-tab]');
/* ★v16-A：`go(k)` 现在**顺带把该 Tab 的页长拉到极大**（= 用户能选的最大档位的极限）。
   为什么这不是「改断言迁就实现」：
     · 分页后的渲染条数 = min(数据条数, 页长)，而「卡片结构 / 每张卡都有 .mt」这类
       断言测的是**骨架**，不是分页；把页长调大 ≈ 用户在 UI 上选「100 条/页」的极限用法，
       走的是**真实接口**，不是绕过实现（把 PG_DEF 常量改成 100000 才是绕过）。
     · 分页本身另有一组独立断言（§v16分页），那里会显式复位到默认页长再验。 */
const go = k => win.eval(`pgOf("${k}").size = 100000; pgOf("${k}").page = 1; resetState("${k}"); render();`);
/* 复位成默认页长（验分页行为时用） */
const pgReset = k => win.eval(`pgOf("${k}").size = ${win.eval('PG_DEF')}; pgOf("${k}").page = 1; render();`);
const mask = doc.getElementById('mask');
/* ★v8：卡片标题现在是「中文名<span class="en">（英文名）</span>」——
   比对时要取「去掉 .en 之后的主名」，否则永远匹配不上数据里的 title */
const ctitleMain = () => {
  const e = $('#main .ctitle');
  if (!e) return '';
  const c = e.cloneNode(true);
  c.querySelectorAll('.en').forEach(x => x.remove());
  return c.textContent.trim();
};
const npOf = t => win.eval('nameParts')(t);
/* ★v8：**剥掉注释**再做「源码里有没有某条规则」的断言。
   起因：v8 新增的说明性注释里写了 `.cv img{opacity:0}`（用来解释旧做法为什么错），
   结果把「不得再用 opacity:0 控制可见性」这条断言直接判红了 ——
   断言要查的是**生效的样式**，不是注释里的反面教材。凡正则类样式断言都用 code。 */
const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

/* ================= 0. 数据层（★v5 核心） ================= */
ok('数据：顶层 >=12 个 key', Object.keys(D).length >= 12, Object.keys(D).length);
ok('数据：PC 排行榜 >=60', (D.pcRank || []).length >= 60, (D.pcRank || []).length);
ok('数据：每张卡片带 ts / srcKey（排序+筛选用）', 'ts' in D.pcNew[0] && 'srcKey' in D.mNew[0]);

// 0a. 手游来源白名单 = TapTap + 好游快爆 + 小七
const WL = ['taptap', 'haoyou', 'x7'];
const srcKeysOfMNew = [...new Set(D.mNew.flatMap(x => x.srcKeys || []))];
ok('白名单：mNew 来源键全部在白名单内',
   srcKeysOfMNew.every(k => WL.includes(k)), srcKeysOfMNew.join(','));
ok('白名单：mNew 确实含「小七」源（此前整源丢失）', srcKeysOfMNew.includes('x7'), srcKeysOfMNew.join(','));
ok('白名单：mNew 已排除游民星空 / 机核',
   !srcKeysOfMNew.includes('gamersky') && !srcKeysOfMNew.includes('gcores'), srcKeysOfMNew.join(','));
ok('白名单：元数据声明了三源', JSON.stringify(D.meta.mobWhitelist) === JSON.stringify(['TapTap', '好游快爆', '小七']),
   JSON.stringify(D.meta.mobWhitelist));
ok('白名单：三源实测条数均 >0',
   D.mStats.srcIds['ref-taptap'] > 0 && D.mStats.srcIds['ref-haoyou'] > 0 && D.mStats.srcIds['ref-x7'] > 0,
   JSON.stringify(D.mStats.srcIds));

// 0b. 同游戏合并
const mkeys = D.mNew.map(x => x.key);
ok('合并：合并后游戏 key 唯一（同游戏只剩一条）', new Set(mkeys).size === mkeys.length,
   `${mkeys.length} -> ${new Set(mkeys).size}`);
ok('合并：合并后条数 <= 合并前原始条数', D.mNew.length <= D.mStats.rawNew,
   `${D.mNew.length} <= ${D.mStats.rawNew}`);
const multi = D.mNew.filter(x => (x.sources || []).length > 1);
ok('合并：存在「多平台同款」游戏', multi.length >= 1, multi.length);
ok('合并：多平台卡片的 sources 与 srcKeys 长度一致',
   multi.every(x => x.sources.length === x.srcKeys.length));

// 0c. 补字段
const fill = k => D.mNew.filter(x => x[k] !== undefined && x[k] !== null && x[k] !== '').length;
ok('补字段：每张新游卡都有上线状态 status', fill('status') === D.mNew.length, `${fill('status')}/${D.mNew.length}`);
ok('补字段：每张新游卡都有状态后缀 suffix', fill('suffix') === D.mNew.length, `${fill('suffix')}/${D.mNew.length}`);
ok('补字段：每张新游卡都有绿色时效行 note', fill('note') === D.mNew.length, `${fill('note')}/${D.mNew.length}`);
ok('补字段：每张新游卡都有标签 tags', fill('tags') === D.mNew.length, `${fill('tags')}/${D.mNew.length}`);
// ★ 上游脏标签：好游快爆的 tags 偶发抓到「猜你喜欢」整段文案（实测修复过 3 条）
const dirtyTags = D.mNew.flatMap(x => x.tags || [])
  .filter(t => /\s/.test(t) || /[\d.]+\s*(分|万|热度|下载|预约)/.test(t) || t.length > 14);
ok('补字段：标签已过滤上游脏标签（推荐位整段文案）', dirtyTags.length === 0, dirtyTags.slice(0, 3).join(' ;; '));
ok('补字段：多数卡有热度 hot', fill('hot') >= D.mNew.length * 0.9, `${fill('hot')}/${D.mNew.length}`);
ok('补字段：上线时间有对应的可读文案',
   D.mNew.filter(x => x.launchTs).every(x => /\d+月\d+日/.test(x.launchText)),
   (D.mNew.find(x => x.launchTs) || {}).launchText);
ok('补字段：status 取值在允许集合内',
   D.mNew.every(x => ['已上线', '定档', '测试招募', '预约中'].includes(x.status)),
   [...new Set(D.mNew.map(x => x.status))].join(','));

// 0d. PC 封面修复（52jidi 小图 + Steam 默认分享图）
const pc55 = [...D.pcNew, ...D.pcHot, ...D.pcRank];
ok('封面：52jidi 全部已升级为 /sz/420（不再是 /sz/src）',
   pc55.filter(x => x.cover.includes('52jidi')).every(x => x.cover.endsWith('/sz/420')),
   (pc55.find(x => x.cover.includes('52jidi')) || {}).cover);
ok('封面：52jidi 封面数量 >0（说明确实在取材）', pc55.filter(x => x.cover.includes('52jidi')).length > 0);
ok('封面：无 Steam 默认分享图（steam_share_image）',
   pc55.every(x => !/steam_share_image/.test(x.cover)));
ok('封面：pcHot 无空封面', D.pcHot.every(x => !!x.cover));

/* ================= 1. 结构 ================= */
/* ★v15：9 → 12。新增的三个**不是普通列表 Tab**，而是「本机」分组下的三个功能页
   （游戏库 / 我的游戏 / 下载管理），各自有独立渲染函数（renderLib/renderMyGames/renderDownloads），
   不走 D[tab] 快照数组。期望值 +3 是**随新增模块一起报账**，不是改断言去迁就实现。
   ★v26：12 → 11 —— 用户 2026-10-23 口径「排行榜放在首页下（移除排行榜的独立入口）」。
   ⚠️ 这里减的是**入口**，不是页面：`TABS.pcRank` 与 rankBoard 渲染分支都还在（深链兜底），
   所以下面 6c/10c 那两组 `go('pcRank')` 断言一条都不用改。 */
ok('结构：侧栏 11 个 Tab（v12 移除报告 → 9；v15 新增本机三页 → 12；v26 排行榜入口下沉首页 → 11）',
   navs().length === 11, navs().length);
ok('v26：侧栏不再有「排行榜」独立入口（入口已下沉到首页底部）',
   !navs().some(a => a.dataset.tab === 'pcRank'),
   navs().map(a => a.dataset.tab).join(','));
ok('v26：排行榜 Tab 本身仍保留（深链 / 旧调用仍可用，入口消失 ≠ 页面消失）',
   win.eval("!!TABS.pcRank && TABS.pcRank.rankBoard === true"), win.eval("!!TABS.pcRank"));
ok('结构：v8 默认落地在「首页」', $('#main h2').textContent.includes('首页'), $('#main h2').textContent);
ok('结构：存在「首页」导航项', navs().some(a => a.dataset.tab === 'home'));
const cnt = id => doc.getElementById(id).textContent;
ok('结构：侧栏计数 pcNew = 数据条数', cnt('c-pcNew') === String(D.pcNew.length), cnt('c-pcNew'));
ok('结构：侧栏计数 mNew = 合并后条数', cnt('c-mNew') === String(D.mNew.length), cnt('c-mNew'));
ok('结构：侧栏计数 mEvent 已更新', cnt('c-mEvent') === String(D.mEvent.length), cnt('c-mEvent'));

/* ================= 1b. ★v8 首页 + 大图轮播 ================= */
const heroItemsOf = () => win.eval('heroItems()');
const heroes = heroItemsOf();
ok('首页：轮播条目数 >=6（PC 热游+PC 新游+手游新游）', heroes.length >= 6, heroes.length);
ok('首页：轮播条目来自三个板块',
   new Set(heroes.map(h => h.tab)).size >= 3, [...new Set(heroes.map(h => h.tab))].join(','));
ok('首页：每条轮播都带 (tab, 下标) 且能定位到真实记录',
   heroes.every(h => TABSOK(h)),
   heroes.filter(h => !TABSOK(h)).map(h => h.tab + ':' + h.i).join(',') || '全部可定位');
function TABSOK(h) { return !!(h && (D[h.tab] || [])[h.i]); }
ok('首页：轮播条目互不重复（同 Tab 内下标不重复）',
   heroes.length === new Set(heroes.map(h => h.tab + ':' + h.i)).size);
go('home');
ok('首页：渲染出 .hero 轮播容器', !!$('#main #hero'));
const slides = $$('#main #heroSlides .hslide');
ok('首页：轮播渲染出 >=6 张 slide', slides.length >= 6, slides.length);
ok('首页：默认只有第 1 张 .on（不是全部显示）',
   slides.filter(s => s.classList.contains('on')).length === 1,
   slides.filter(s => s.classList.contains('on')).length);
ok('首页：第 1 张是 .on 且为索引 0', slides[0].classList.contains('on'));
ok('首页：指示点数量 = slide 数量', $$('#main #heroDots i').length === slides.length,
   `${$$('#main #heroDots i').length} vs ${slides.length}`);
ok('首页：指示点默认第 1 个高亮', $$('#main #heroDots i')[0].classList.contains('on'));
ok('首页：存在自动轮播计时器', win.eval('typeof heroTimer !== "undefined" && heroTimer !== null'));
/* 手写一次翻页：验证 heroGo 真的切换 slide（不是只切了 class 名字） */
win.eval('heroGo(1)');
ok('首页：heroGo(1) 后第 2 张成为 .on',
   $$('#main #heroSlides .hslide')[1].classList.contains('on') &&
   !$$('#main #heroSlides .hslide')[0].classList.contains('on'));
win.eval(`heroGo(${slides.length - 1})`);
win.eval('heroGo(heroIdx + 1)');
ok('首页：翻到末尾再下一张会回到第 1 张（循环）',
   $$('#main #heroSlides .hslide')[0].classList.contains('on'));
go('home');
ok('首页：轮播图带 no-referrer 且走 reveal', $$('#main .hpic img').every(i =>
   i.getAttribute('referrerpolicy') === 'no-referrer' &&
   (i.getAttribute('onload') || '') === 'reveal(this)'));
ok('首页：轮播条目有「查看详情」按钮（走同一弹窗）',
   $$('#main #heroSlides .hslide [data-hero-d]').length === slides.length,
   $$('#main #heroSlides .hslide [data-hero-d]').length);
/* ★v9：Hero 改「1 大 + 2 小」—— 右侧每组两张预览小卡，同样可点开详情 */
ok('v9首页：右侧预览小卡 = 条目数 × 2（1 大 + 2 小）',
   $$('#main #heroSide .hsitem[data-hero-d]').length === slides.length * 2,
   `${$$('#main #heroSide .hsitem[data-hero-d]').length} vs ${slides.length * 2}`);
ok('首页：轮播有上一张 / 下一张按钮', $$('#main [data-hero-nav]').length === 2);
/* 点「查看详情」应打开弹窗，且标题 = 该轮播条目的游戏名 */
const hBtn = $('#main #heroSlides .hslide [data-hero-d]');
hBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('首页：点轮播「查看详情」能打开弹窗（跨 Tab 取数）', mask.classList.contains('on'));
ok('首页：弹窗标题 = 轮播条目对应的游戏名',
   ($('#dlg .dhtitle h2') || {}).textContent ===
   (heroes[0].a.title || heroes[0].a.game || '').split('/')[0].trim(),
   `${($('#dlg .dhtitle h2') || {}).textContent} vs ${(heroes[0].a.title || heroes[0].a.game || '').split('/')[0].trim()}`);
win.eval('closeDetail()');
/* ★v26：首页多了第 4 块「排行榜」（`.hsec.hrank`），但**精选仍是 3 块** ——
   判据改成数 `.hseclist`（精选块的标志）而不是数 `.hsec`，
   否则「加一块新内容」这件事会无条件把这条打成假红。 */
ok('首页：三块精选区块齐全（PC 新游 / PC 热游 / 手游新游；v26 起另有第 4 块「排行榜」不带 .hseclist）',
   $$('#main .hsec').length === 4 && $$('#main .hsec .hseclist').length === 3,
   $$('#main .hsec').length + ' 个 .hsec / ' + $$('#main .hsec .hseclist').length + ' 个 .hseclist');
ok('首页：每个精选区块都有「查看全部」入口（排行榜块**不该**有）',
   $$('#main .hsechd .more').length === 3, $$('#main .hsechd .more').length);
$$('#main .hsechd .more')[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('首页：点「查看全部」切到对应 Tab', $('#main h2').textContent.includes('PC 热游'),
   $('#main h2').textContent);
ok('首页：切走后自动轮播已停止（不留后台计时器）', win.eval('heroTimer === null'));
go('home');
ok('首页：区块卡片也走弹窗（data-d 指向自己所属 Tab，不是 home）',
   $$('#main .hsec .card[data-d]').every(c => c.dataset.d !== 'home'),
   [...new Set($$('#main .hsec .card[data-d]').map(c => c.dataset.d))].join(','));

/* ================= 2. 筛选栏 / 排序 / 搜索 ================= */
go('pcNew');   /* ★v8：默认页已是首页，这里要先切到列表页再断言筛选栏 */
ok('UI：存在筛选栏 .filter-bar', !!$('.filter-bar'));
ok('UI：存在排序 pills', $$('.pill-b').length >= 4, $$('.pill-b').length);
ok('UI：存在筛选 toggles', $$('.tg').length >= 2, $$('.tg').length);
ok('UI：存在搜索框与结果计数', !!$('#kw') && !!$('#fcount'));

/* ================= 3. 图片系统（★v7：容器定比 + 一律 cover / 废弃按比例分叉） ================= */
go('pcNew');
const imgs = $$('#main .cv img');
ok('图片：已渲染出图片节点', imgs.length > 0, imgs.length);
ok('图片：全部带 referrerpolicy=no-referrer',
   imgs.every(i => i.getAttribute('referrerpolicy') === 'no-referrer'));
ok('v7图片：CSS 定义了统一容器比例 --th-ar', /--th-ar:\s*16\s*\/\s*9/.test(html));
ok('v7图片：所有图容器带 aspect-ratio', /\.cv\{[^}]*aspect-ratio:var\(--th-ar\)/.test(html));
ok('v7图片：.cv img 一律 object-fit:cover（铺满，不做 contain 分叉）',
   /\.cv img\{[^}]*object-fit:cover/.test(html));
ok('v7图片：旧 contain 分支 .cv img.fit-c 已删除', !/\.cv img\.fit-c/.test(html));
ok('v7图片：旧模糊铺底 .cv.blurbg::before 已删除（用户反馈「很奇怪」的就是它）',
   !/\.cv\.blurbg::before/.test(html) && !/--bgi/.test(html));
ok('v7图片：旧 fitImg（读 naturalWidth 判比例）已删除', !/function fitImg/.test(html));
ok('v7图片：卡片 onload 改走无比例判断的 reveal',
   /onload="reveal\(this\)"/.test(html) && !/onload="fitImg/.test(html));
/* 造一张带容器的图（.cv > .ph + img），验证 reveal 的副作用 */
function feedImg() {
  const box = doc.createElement('div'); box.className = 'cv';
  const ph = doc.createElement('div'); ph.className = 'ph'; box.appendChild(ph);
  const im = doc.createElement('img'); im.setAttribute('src', 'https://example.com/a.jpg'); box.appendChild(im);
  doc.body.appendChild(box);
  win.eval('reveal')(im);
  return im;
}
const anyImg = feedImg();
ok('v7图片：reveal → 图标记 .ready（★v8 起仅为标记，不再控制可见性）',
   anyImg.classList.contains('ready'));
ok('v7图片：reveal → 占位 .ph 被藏掉（否则占位一直压在图上面）',
   anyImg.previousElementSibling.classList.contains('gone'));
ok('v7图片：方图/宽图走同一套处理，不再按比例分叉',
   (() => { const a = feedImg(); return !a.classList.contains('fit-c') &&
                                             !a.parentElement.classList.contains('blurbg'); })());
ok('v7图片：渲染产物里没有任何 .cv.blurbg 容器',
   $$('#main .cv.blurbg').length === 0);
ok('v7图片：渲染出来的卡片 img 确实挂的是 reveal（不是源码正则，是产物）',
   [...$$('#main .cv img')].every(i => (i.getAttribute('onload') || '') === 'reveal(this)'),
   [...$$('#main .cv img')].slice(0, 1).map(i => i.getAttribute('onload')).join(''));

/* ★v8 核心修复：**图片可见性交给 CSS，不再依赖 onload 回调**。
   修的是「图加载完了却一直透明」——命中缓存时 `load` 可能早于节点入树 ⇒ `reveal()`
   不执行 ⇒ `.ready` 永远不加 ⇒ `opacity` 卡在 0（实测 mEvent 98 张全部如此）。
   这些断言的作用是**不许有人把可见性再绑回回调**。 */
ok('v8图片：.cv img 无 opacity:0（可见性不再依赖 onload 加 .ready）',
   !/\.cv img\{[^}]*opacity\s*:\s*0/.test(code));
ok('v8图片：.cv img 有 z-index:1 压在占位 .ph 之上',
   /\.cv img\{[^}]*z-index:1/.test(code));
ok('v8图片：.mth img 直接可见且有 z-index:1',
   /\.mth img\{[^}]*z-index:1/.test(code) && !/\.mth img\{[^}]*opacity\s*:\s*0/.test(code));
ok('v8图片：.hpic img（首页大图）无 opacity:0',
   !/\.hpic img\{[^}]*opacity\s*:\s*0/.test(code));
ok('v8图片：没有任何 .ready{opacity:...} 这类「靠回调点亮」的残留规则',
   !/\.ready\s*\{[^}]*opacity/.test(code));
ok('v8图片：PC 卡片 img 不带 loading="lazy"（无头截图会整片空白）',
   $$('#main .cv img').length > 0 && $$('#main .cv img').every(i => !i.hasAttribute('loading')));
go('mNew');
ok('v8图片：手游卡片 img 不带 loading="lazy"',
   $$('#main .mth img').length > 0 && $$('#main .mth img').every(i => !i.hasAttribute('loading')));

/* ================= 4. 卡片固定布局 + 骨架统一 ================= */
go('pcNew');
ok('卡片：标题受 --cd-t2 固定高度约束', /--cd-t2:\s*2\.8em/.test(html));
ok('卡片：元信息区 .cmeta 存在', !!$('#main .cmeta'));
ok('卡片：底部行 .crow.bottom 存在（等高对齐）', !!$('#main .crow.bottom'));
function shapeOf(card) {
  const cs = [...card.children].map(e => e.className.replace(/\s+/g, ' ').trim());
  const body = card.querySelector('.cbody');
  const bs = body ? [...body.children].map(e => e.className.replace(/\s+/g, ' ').trim()) : [];
  return cs.join(' | ') + '  >>  ' + bs.join(' | ');
}
const EXPECT = 'cv | cbody  >>  ctitle | cmeta | crow bottom';
/* ★v8：pcRank 已改为「列表分榜」，不再产出 .card 卡片，故从统一骨架集合中移除 */
const UNI = ['pcNew', 'pcHot', 'pcTrainer', 'pcMod', 'mPlay'];
const badShape = [];
UNI.forEach(k => {
  go(k);
  cards().forEach(c => { const s = shapeOf(c); if (s !== EXPECT) badShape.push(`${k}: ${s}`); });
});
ok('统一：5 个卡片型 Tab 全部骨架一致', badShape.length === 0, badShape.slice(0, 2).join(' ;; '));
const emptyTabs = UNI.filter(k => { go(k); return cards().length === 0; });
ok('统一：5 个卡片型 Tab 均有卡片渲染', emptyTabs.length === 0, emptyTabs.join(','));
UNI.forEach(k => {
  go(k);
  const n = cards().length;
  const withTag = cards().filter(c => c.querySelector('.cv .tag')).length;
  const colored = cards().filter(c => {
    const tg = c.querySelector('.cv .tag');
    return tg && tg.className.replace(/\btag\b/, '').trim().length > 0;
  }).length;
  ok(`统一：${k} 每张卡都有左上角标签`, n > 0 && withTag === n, `${withTag}/${n}`);
  ok(`统一：${k} 标签均带配色类`, n > 0 && colored === n, `${colored}/${n}`);
});
go('mPlay');
ok('统一：可玩端游用 PC 网格(.grid.pc)与端游一致', !!$('.grid.pc') && !$('.grid.mb'));
ok('统一：可玩端游档位标签为 .tag.tier', !!$('#main .card .tag.tier'));
ok('统一：可玩端游底栏长文本带 .ell 单行省略', $$('#main .card .crow.bottom .ell').length > 0);
ok('统一：fpsShort 提取区间 "30-45"', win.eval('fpsShort')('30-45') === '30-45');
ok('统一：fpsShort 长句不提取区间返回空', win.eval('fpsShort')('帧数不显示，轻微卡顿') === '');

/* ================= 5. 排序 / 筛选 / 搜索 ================= */
go('pcNew');
const beforeSort = cards().length;
const firstBefore = ctitleMain();
const scoreBtn = $$('.pill-b').find(b => b.textContent.includes('评分最高'));
ok('排序：找到「评分最高」按钮', !!scoreBtn);
if (scoreBtn) {
  scoreBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('排序：切到评分后首条发生变化', ctitleMain() !== firstBefore);
  const sc = D.pcNew.map(x => x.scoreV).sort((a, b) => b - a);
  const hit = D.pcNew.find(x => npOf(x.title).main === ctitleMain());
  ok('排序：首条确为最高分', hit && hit.scoreV === sc[0],
     `${hit && hit.scoreV} vs ${sc[0]}`);
}
ok('排序：条数未因排序变化', cards().length === beforeSort);

go('pcNew');
const totalAll = cards().length;
const jidiBtn = $$('.tg').find(b => b.textContent.trim() === '机地');
ok('筛选：存在来源「机地」按钮', !!jidiBtn);
if (jidiBtn) {
  jidiBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const expect = D.pcNew.filter(x => x.srcKey === 'jidi').length;
  ok('筛选：机地筛选后条数正确', cards().length === expect, `${cards().length} vs ${expect}`);
  ok('筛选：计数文案已更新', /显示 \d+ \/ 共 \d+ 条/.test($('#fcount').textContent), $('#fcount').textContent);
  $$('.tg').find(b => b.textContent.trim() === '机地').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('筛选：取消后恢复全量', cards().length === totalAll, `${cards().length} vs ${totalAll}`);
}

// ★ 数组字段筛选（手游多平台 srcKeys）
go('mNew');
const x7Btn = $$('.tg').find(b => b.dataset.fv === 'x7');
ok('筛选：手游新游存在「小七」来源按钮', !!x7Btn);
if (x7Btn) {
  x7Btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const expect = D.mNew.filter(x => (x.srcKeys || []).includes('x7')).length;
  ok('筛选：数组字段(srcKeys)筛选生效', $$('#main .mcard').length === expect,
     `${$$('#main .mcard').length} vs ${expect}`);
  ok('筛选：小七筛选后仍有结果', $$('#main .mcard').length > 0);
}
go('pcNew');
const inp = $('#kw');
inp.value = '绝不可能匹配的词ZZZ';
inp.dispatchEvent(new win.Event('input', { bubbles: true }));
ok('搜索：无关词 → 空态', !!$('#main .empty') && cards().length === 0);
go('pcNew');
const inp2 = $('#kw');
inp2.value = (D.pcNew[0].title || '').slice(0, 2);
inp2.dispatchEvent(new win.Event('input', { bubbles: true }));
ok('搜索：关键词能命中', cards().length > 0, cards().length);

/* ================= 6. ★ 手游新游卡（参考图版式） ================= */
go('mNew');
ok('新游卡：用 .grid.mb 网格', !!$('.grid.mb'));
ok('新游卡：不再渲染旧 .card 骨架', cards().length === 0);
const mn = $$('#main .mcard');
ok('新游卡：渲染条数 = 数据条数', mn.length === D.mNew.length, `${mn.length} vs ${D.mNew.length}`);
ok('新游卡：全部带 .nw 新骨架类', mn.every(c => c.classList.contains('nw')));
ok('新游卡：每张都有方形 icon(.mth.sq)', $$('#main .mth.sq').length === mn.length);
ok('新游卡：每张都有标题行 .mrow', $$('#main .mrow').length === mn.length);
ok('新游卡：每张都有游戏名 .mt', $$('#main .mrow .mt').length === mn.length);
ok('新游卡：每张都有状态后缀 .mst', $$('#main .mrow .mst').length === mn.length);
ok('新游卡：游戏名不含资讯标题的《》符号', $$('#main .mrow .mt').every(e => !e.textContent.includes('《')),
   ($('#main .mrow .mt') || {}).textContent);
ok('新游卡：每张都有标签行 .mtags', $$('#main .mtags').length === mn.length);
ok('新游卡：标签行至少 1 个 pill（游戏标签；来源标签已移走）',
   $$('#main .mtags').every(e => e.querySelectorAll('.pill').length >= 1));
/* ★v8：平台标签从标签行移到卡片右上角 .mtop（用户需求③「平台标签放右上角」） */
ok('新游卡：每张都有右上角平台标签区 .mtop', $$('#main .mtop').length === mn.length,
   `${$$('#main .mtop').length}/${mn.length}`);
ok('新游卡：标签行里不再混入来源标签（.mtags 内无 src-* 类）',
   $$('#main .mtags .pill').every(e => !/src-\w+/.test(e.className)),
   $$('#main .mtags .pill').map(e => e.className).join('|'));
ok('新游卡：每张都有绿色时效行 .msub.gn', $$('#main .msub.gn').length === mn.length);
ok('新游卡：绿色时效行均有文案', $$('#main .msub.gn').every(e => e.textContent.trim().length > 0));
/* ★v8：时间只出现一次 —— 标题行后缀只留状态词，不再拼 `定档 10/9` */
ok('新游卡：状态后缀只含状态词、不含日期（时间只在标签下出现一次）',
   $$('#main .mrow .mst').every(e => !/\d{1,2}\s*[\/月]\s*\d{1,2}/.test(e.textContent)),
   $$('#main .mrow .mst').map(e => e.textContent).slice(0, 6).join('|'));
ok('新游卡：状态后缀取值均来自 status 字段（不再是含日期的 suffix）',
   $$('#main .mrow .mst').every(e => D.mNew.some(x => x.status === e.textContent.trim())));
const mscore = $$('#main .mscore');
ok('新游卡：右侧数字覆盖率 100%（上游无数据也用「—」占位，不留空）',
   mscore.length === mn.length, `${mscore.length}/${mn.length}`);
ok('新游卡：右侧数字均有值（占位符「—」也算有值）', $$('#main .mscore').every(e => e.textContent.trim().length > 0));
ok('新游卡：右侧数字要么评分(绿★)、要么热度(橙🔥)、要么占位(灰—)',
   mscore.every(e => e.classList.contains('hm') || e.classList.contains('none') || e.textContent.includes('★')));
// 来源标签配色（含新增的 x7）—— ★v8 起在右上角 .mtop 里
const srcPillSet = new Set($$('#main .mtop .pill[class*="src-"]').map(e => e.textContent.trim()));
ok('新游卡：右上角来源标签出现 >=3 种', srcPillSet.size >= 3, [...srcPillSet].join(','));
ok('新游卡：来源 pill 均带配色类（无裸 pill）',
   $$('#main .mtop .pill[class*="src-"]').every(e => /src-\w+/.test(e.className)));
ok('新游卡：存在小七配色类 src-x7', html.includes('.pill.src-x7') && html.includes('.tag.src-x7'));
// 多平台卡片：右上角并列多个来源标签，超过上限折叠为 +N
const multiIdx = D.mNew.findIndex(x => (x.sources || []).length > 1);
if (multiIdx >= 0) {
  const c = mn[multiIdx], ns = D.mNew[multiIdx].sources.length;
  const want = Math.min(ns, 2) + (ns > 2 ? 1 : 0);
  ok('新游卡：多平台卡片右上角并列来源标签（上限 2 个，超出折叠为 +N）',
     c.querySelectorAll('.mtop .pill').length === want,
     `${c.querySelectorAll('.mtop .pill').length} vs ${want}（该卡 ${ns} 个平台）`);
}
ok('新游卡：平台标签超过 2 个时确实出现 +N 折叠标',
   $$('#main .mtop .pill.more').length === D.mNew.filter(x => (x.sources || []).length > 2).length,
   `${$$('#main .mtop .pill.more').length} vs ${D.mNew.filter(x => (x.sources || []).length > 2).length}`);
// 排序项口径
ok('新游卡：排序项含「上线时间」（补的上线时间可排）', $$('.pill-b').some(b => b.textContent.includes('上线时间')));
ok('新游卡：已移除「相关度」这一含混口径', !$$('.pill-b').some(b => b.textContent.includes('相关度')));
// 上线时间排序真能生效
const launchBtn = $$('.pill-b').find(b => b.textContent.includes('上线时间'));
if (launchBtn) {
  launchBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const first = $$('#main .mcard')[0].querySelector('.mt').textContent;
  const maxTs = Math.max(...D.mNew.map(x => x.launchTs || 0));
  ok('新游卡：上线时间排序首条为最晚上线', D.mNew.find(x => x.game === first).launchTs === maxTs,
     `${D.mNew.find(x => x.game === first).launchTs} vs ${maxTs}`);
}

/* ================= 6b. 手游活动卡（★v8：补上线时间 + 类目移到右上角） ================= */
go('mEvent');
const mEvCards = $$('#main .mcard');
ok('活动卡：渲染条数 = 数据条数', mEvCards.length === D.mEvent.length, `${mEvCards.length} vs ${D.mEvent.length}`);
ok('活动卡：每张都有 banner(.mth.wd)', $$('#main .mth.wd').length === mEvCards.length);
ok('活动卡：每张都有活动标题 .msub', $$('#main .msub').length === mEvCards.length);
ok('活动卡：活动卡不加 .nw（与发行动态卡区分）', mEvCards.every(c => !c.classList.contains('nw')));
const ev0 = mEvCards[0], raw0 = D.mEvent[0];
ok('活动卡：首卡游戏名 = 数据 game 字段', ev0.querySelector('.mt').textContent === raw0.game,
   `${ev0.querySelector('.mt').textContent} vs ${raw0.game}`);
ok('活动卡：活动标题已剥掉重复的《游戏名》',
   ev0.querySelector('.msub').textContent !== raw0.title &&
   !ev0.querySelector('.msub').textContent.startsWith('《' + raw0.game + '》'),
   ev0.querySelector('.msub').textContent);
/* ★v8：用户需求④「手游的活动卡片我需要上线时间」 */
const evTime = D.mEvent.map(x => x.launchText || x.dateText || x.tlDate || '');
ok('活动卡：每张都有上线 / 开始时间 .mtime', $$('#main .mtime').length === mEvCards.length,
   `${$$('#main .mtime').length}/${mEvCards.length}`);
ok('活动卡：上游能给出时间的记录全部覆盖到',
   $$('#main .mtime').length === evTime.filter(Boolean).length,
   `${$$('#main .mtime').length} vs ${evTime.filter(Boolean).length}`);
ok('活动卡：时间文案全部来自数据字段（launchText > dateText > tlDate）',
   $$('#main .mtime').every(e => evTime.includes(e.textContent.trim())),
   $$('#main .mtime').slice(0, 3).map(e => e.textContent).join('|'));
ok('活动卡：时间形如「N月N日 HH:MM」（不是原始时间戳）',
   $$('#main .mtime').every(e => /\d{1,2}月\d{1,2}日(\s+\d{1,2}:\d{2})?/.test(e.textContent)),
   $$('#main .mtime').slice(0, 3).map(e => e.textContent).join('|'));
ok('活动卡：类目已移到右上角 .mtop',
   $$('#main .mcard .mtop').length === mEvCards.length,
   `${$$('#main .mcard .mtop').length}/${mEvCards.length}`);
ok('活动卡：类目标签用裸 pill（沿用类目样式）',
   $$('#main .mcard .mtop .pill').every(e => !/src-\w+/.test(e.className)));
/* 时间只出现一次：卡上除 .mtime 外不应再有第二处日期（活动标题里的日期除外，
   那属于活动名称本身，不是独立时间字段） */
ok('活动卡：卡上独立时间字段只有 .mtime 一处',
   mEvCards.every(c => c.querySelectorAll('.mtime').length === 1));
ok('subOf：能正确剥离《游戏名》前缀', win.eval('subOf')({ game: '弈仙牌', title: '《弈仙牌》第十一赛季' }) === '第十一赛季');
ok('subOf：不匹配时原样返回', win.eval('subOf')({ game: 'A', title: '《B》某活动' }) === '《B》某活动');

/* ================= 6c. ★v10 排行榜：4 个分榜（用户口径：不要搜索 / 不要品类筛选） ================= */
go('pcRank');
ok('排行：不再渲染网格卡片（改为列表）', cards().length === 0, cards().length);
ok('排行：不提供排序按钮（榜单本身就是排序）', $$('.pill-b').length === 0, $$('.pill-b').length);
/* ★v10 用户口径：本页**不要搜索、不要品类筛选**。不能只验「看不到」——
   还要验「整条筛选栏压根没渲染（不是被 CSS 藏起来）」，否则改天有人把 filterBar 加回来也测不出来。 */
ok('排行：★没有搜索框（用户口径：不需要搜索）', !$('#kw'));
ok('排行：★没有筛选按钮（用户口径：不需要品类筛选）', $$('#main .tg').length === 0, $$('#main .tg').length);
ok('排行：★整条筛选栏都没渲染（不是隐藏）', !$('#main .filter-bar'));
ok('排行：不渲染结果计数 #fcount（本页不参与筛选）', !$('#fcount'));

ok('排行：渲染出 4 个榜块', $$('#main .rankboard').length === 4, $$('#main .rankboard').length);
const rbNames = $$('#main .rbhead h3').map(e => e.textContent);
ok('排行：四榜依次为「PC 新游榜 / PC 热游榜 / 手机新游榜 / 手机热游榜」',
   rbNames.join(',') === 'PC 新游榜,PC 热游榜,手机新游榜,手机热游榜', rbNames.join(','));
ok('排行：每榜都有口径说明', $$('#main .rbsub').length === 4, $$('#main .rbsub').length);
const rRows = $$('#main .rrow');
ok('排行：总行数 = 四榜 TopN 之和（12 × 4 = 48）', rRows.length === 48, rRows.length);
ok('排行：每行都有名次 + 缩略图 + 名称 + 指标',
   rRows.length > 0 && rRows.every(r => r.querySelector('.rno') && r.querySelector('.rth img') &&
                    r.querySelector('.rgname') && r.querySelector('.rval')));
ok('排行：每行缩略图带 no-referrer',
   $$('#main .rrow .rth img').length > 0 &&
   $$('#main .rrow .rth img').every(i => i.getAttribute('referrerpolicy') === 'no-referrer'));
/* ★v8 健壮性：元素查不到时**返回空数组 / null**，让断言精确报红 —— 不要让它抛错。
   抛错会让整个脚本终止（跑出 `通过 None/None`），此时「哪条断言没守住」完全看不出来。
   ⚠️ 另一面：空数组 `every()` 恒为真 ⇒ 凡用 every 校验序列的断言，都必须先加 `xxx.length > 0 &&`。 */
const rowsOf = n => { const el = $$('#main .rlist')[n]; return el ? [...el.querySelectorAll('.rrow')] : []; };
const rnoOf = r => (r && r.querySelector('.rno')) || null;
/* ★v10：行改为按**各自 Tab 的下标**取数 —— data-d 就是那个 Tab，不再是统一的 pcRank。
   这正是 4 榜能正确弹窗的关键：openDetail 走 D[tab][i]。 */
const RANK_TABS = ['pcNew', 'pcHot', 'mNew', 'mNew'];
/* ⚠️ 必须**取不到就返回 {}**、不能返回 undefined：
   否则一旦 data-d 写错（比如写死 pcRank，而 mNew 的下标远超 pcRank 的 80 条），
   `rowRec(r).srcKey` 会当场抛错 ⇒ 整个脚本终止、跑出 `通过 None/None`，
   反证就没法判定这条断言到底红没红（这正是反证 M20 第一次跑出来的现象）。
   ——「断言必须报红，不能崩」是本文件开头的硬约定，新加的 helper 也要守住。 */
const rowRec = r => (D[r.dataset.d] || [])[Number(r.dataset.i)] || {};
const fmtHotPage = win.eval('fmtHot');

ok('排行：四榜的行 data-d 依次指向 pcNew / pcHot / mNew / mNew（不再是 pcRank）',
   [0, 1, 2, 3].every(k => {
     const rs = rowsOf(k);
     return rs.length > 0 && rs.every(r => r.dataset.d === RANK_TABS[k]);
   }),
   [0, 1, 2, 3].map(k => (rowsOf(k)[0] ? rowsOf(k)[0].dataset.d : '—')).join(','));
/* ★v10 新增：每行的 (data-d, data-i) 必须能**真的取到记录** ——
   这是「跨 Tab 下标不错位」的直接证明；只验 data-d 字符串是验不出越界的。 */
ok('排行：每行 (data-d, data-i) 都能在所属 Tab 的池子里取到记录（下标不越界）',
   rRows.length > 0 && rRows.every(r => {
     const a = (D[r.dataset.d] || [])[Number(r.dataset.i)];
     return !!a && typeof a === 'object';
   }),
   (() => {
     const bad = rRows.filter(r => !(D[r.dataset.d] || [])[Number(r.dataset.i)]);
     return bad.length ? `${bad.length} 行取不到记录，如 ${bad[0].dataset.d}#${bad[0].dataset.i}` : '';
   })());
ok('排行：每榜名次都依次为 1..N',
   [0, 1, 2, 3].every(k => { const rs = rowsOf(k);
     return rs.length > 0 && rs.every((r, i) => (rnoOf(r) || {}).textContent === String(i + 1)); }));
ok('排行：每榜都满 12 行（Top 12）',
   [0, 1, 2, 3].every(k => rowsOf(k).length === 12), [0, 1, 2, 3].map(k => rowsOf(k).length).join(','));

/* ① PC 新游榜：上架日期降序 */
const nRows = rowsOf(0);
ok('排行：PC 新游榜内 ts 单调不增',
   nRows.length > 0 && nRows.every((r, i) => i === 0 ||
     String(rowRec(nRows[i - 1]).ts || '') >= String(rowRec(r).ts || '')));
ok('排行：PC 新游榜第 1 行 = pcNew 池内上架日期最新',
   nRows.length > 0 &&
   String(rowRec(nRows[0]).ts) === String(D.pcNew.map(x => x.ts || '').sort().pop()));

/* ② PC 热游榜：热度降序 */
const hRows = rowsOf(1);
ok('排行：PC 热游榜内 hot 单调不增',
   hRows.length > 0 && hRows.every((r, i) => i === 0 ||
     Number(rowRec(hRows[i - 1]).hot) >= Number(rowRec(r).hot)));
ok('排行：PC 热游榜第 1 行 = pcHot 池内热度最高',
   hRows.length > 0 &&
   Number(rowRec(hRows[0]).hot) === Math.max(...D.pcHot.map(x => Number(x.hot) || 0)),
   `${hRows.length ? Number(rowRec(hRows[0]).hot) : '—'} vs ${Math.max(...D.pcHot.map(x => Number(x.hot) || 0))}`);

/* ③ 手机新游榜：上线时间降序 */
const mbRows = rowsOf(2);
ok('排行：手机新游榜内 launchTs 单调不增',
   mbRows.length > 0 && mbRows.every((r, i) => i === 0 ||
     (Number(rowRec(mbRows[i - 1]).launchTs) || 0) >= (Number(rowRec(r).launchTs) || 0)));
ok('排行：手机新游榜行内带类目标签 .rpill',
   mbRows.length > 0 && mbRows.every(r => !!r.querySelector('.rpill')));

/* ④ 手机热游榜：★按源归一化后混排（这是本轮唯一有「口径设计」的榜，验得细一点） */
const pctMap = (() => {
  const g = {};
  (D.mNew || []).forEach(a => {
    if (!(Number(a.hot) > 0)) return;
    const k = a.srcKey || '?';
    (g[k] = g[k] || []).push(a);
  });
  const m = new Map();
  Object.keys(g).forEach(k => {
    const arr = g[k].slice().sort((x, y) => Number(x.hot) - Number(y.hot));
    const n = arr.length;
    arr.forEach((a, i) => m.set(a, n <= 1 ? 1 : i / (n - 1)));
  });
  return m;
})();
const hp = a => pctMap.get(a) || 0;
const zRows = rowsOf(3);
ok('排行：手机热游榜内「源内百分位」单调不增（= 确实按归一化排序，不是按原始 hot）',
   zRows.length > 0 && zRows.every((r, i) => i === 0 || hp(rowRec(zRows[i - 1])) >= hp(rowRec(r))));
ok('排行：手机热游榜是**跨源**混合（三源都有代表，不是单一源榜单）',
   zRows.length > 0 && new Set(zRows.map(r => rowRec(r).srcKey)).size >= 3,
   [...new Set(zRows.map(r => rowRec(r).srcKey))].join(','));
ok('排行：手机热游榜顺序 ≠ 纯 hot 降序（证明归一化真的改变了排序）',
   zRows.length > 0 &&
   JSON.stringify(zRows.map(r => rowRec(r).game)) !==
   JSON.stringify((D.mNew || []).filter(a => Number(a.hot) > 0).slice()
     .sort((a, b) => Number(b.hot) - Number(a.hot)).slice(0, 12).map(a => a.game)));
ok('排行：手机热游榜每行标注原始口径（hotLabel，如 TapTap 关注 / 好游快爆预约）',
   zRows.length > 0 && zRows.every(r => {
     const c = r.querySelector('.rpill');
     return !!c && /关注|预约|评论/.test(c.textContent);
   }));
ok('排行：★归一化不篡改原始数值（行内热度仍是该条的 fmtHot(hot)）',
   zRows.length > 0 && zRows.every(r =>
     r.querySelector('.rval').textContent === fmtHotPage(rowRec(r).hot)));
ok('排行：每行 data-i 都落在所属 Tab 池子的长度内（不越界）',
   rRows.length > 0 && rRows.every(r =>
     Number(r.dataset.i) >= 0 && Number(r.dataset.i) < (D[r.dataset.d] || []).length));

/* 行 → 弹窗（★v10：跨 Tab 取数，data-d = 该榜自己的 Tab） */
go('pcRank');
const r0 = $$('#main .rrow')[0];
const tab0 = r0 ? r0.dataset.d : '';
const i0 = r0 ? Number(r0.dataset.i) : -1;
ok('排行：首行 data-d 指向 pcNew（不是 pcRank）', !!r0 && tab0 === 'pcNew', tab0);
ok('排行：行名称与 D[tab][data-i] 一致（不会点第 1 行开第 7 条）',
   !!r0 && r0.querySelector('.rgname').textContent.replace(/\s+/g, '').startsWith(
     npOf((D[tab0][i0] || {}).title).main.replace(/\s+/g, '')),
   `${r0 ? r0.querySelector('.rgname').textContent : '—'} vs ${npOf((D[tab0] && D[tab0][i0] || {}).title || '').main}`);
if (r0) r0.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('排行：点行能打开弹窗', mask.classList.contains('on'));
ok('排行：弹窗标题 = 该行游戏主名',
   mask.classList.contains('on') &&
   ($('#dlg .dhtitle h2') || {}).textContent === npOf((D[tab0][i0] || {}).title).main,
   `${($('#dlg .dhtitle h2') || {}).textContent} vs ${npOf((D[tab0][i0] || {}).title || '').main}`);
win.eval('closeDetail()');
/* ★v10 新增：手机热游榜的行取自 mNew（另一个 Tab、且名称字段是 game 不是 title），
   必须单独验一次「点它也能开对弹窗」，否则跨 Tab 取数写错了也看不出来。 */
const zRow0 = rowsOf(3)[0];
const zRec0 = zRow0 ? (D.mNew[Number(zRow0.dataset.i)] || {}) : {};
ok('排行：手机热游榜行 data-d = mNew', !!zRow0 && zRow0.dataset.d === 'mNew');
if (zRow0) zRow0.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('排行：点手游榜行 → 弹窗标题含该游戏名（跨 Tab 取数正确）',
   mask.classList.contains('on') &&
   ($('#dlg .dhtitle h2') || {}).textContent.includes(zRec0.game || '\u0000'),
   `${($('#dlg .dhtitle h2') || {}).textContent} vs ${zRec0.game || '—'}`);
win.eval('closeDetail()');

/* ★v10：侧栏计数必须是「榜上实际行数」，不能继续显示已停用的 pcRank 池（80 条）
   ★v26：侧栏「排行榜」入口已移除 ⇒ `#c-pcRank` 这个计数位必须**一起消失**，
   否则就是「入口删了、计数还挂着」的半拆状态。
   真正的口径校验挪到本节末尾（在**首页**上数实际榜行 = 48），判据没放宽。 */
ok('v26：侧栏取消排行榜入口后，`#c-pcRank` 计数位不再存在（不留半拆状态）',
   doc.getElementById('c-pcRank') === null);

/* ★v10：说明块必须写清「4 个榜 + 不设搜索筛选 + 手机热游为何要归一化」 */
const rankNotice = ($('#main .notice') || {}).textContent || '';
ok('排行：说明块写明「4 个分榜」', rankNotice.includes('4 个分榜'));
ok('排行：说明块写明「本页不设搜索与筛选」', rankNotice.includes('不设搜索与筛选'));
ok('排行：说明块写明手机热游榜的归一化口径与跨源数量级差',
   rankNotice.includes('归一化') && rankNotice.includes('数量级'));
ok('排行：不再出现旧的三榜名（最新上架榜 / 容量榜）',
   !rankNotice.includes('最新上架榜') && !rankNotice.includes('容量榜'));
ok('排行：每榜条数不超过各自 top 上限',
   [0, 1, 2, 3].every(k => { const rs = rowsOf(k); return rs.length > 0 && rs.length <= 12; }));

/* ===== ★v26：排行榜下沉到首页底部（用户 2026-10-23 口径）=====
   口径没变（4 榜 × Top 12 = 48 行），变的是**落点**：从「独立 Tab」变成「首页底部」。
   这组断言守三件事：① 四个榜一个不漏地搬过去；② 行数口径与独立页一致（48）；
   ③ 分节头**不许再挂 `data-go`** —— 榜的独立入口已删，按钮放出去只会把用户送回无入口页。 */
go('home');
const homeRank = $('#main .rankboards');
ok('v26：首页底部出现排行榜区块', !!homeRank);
ok('v26：首页 4 个分榜齐全（一个都没漏搬）', $$('#main .rankboard').length === 4,
   $$('#main .rankboard').length);
ok('v26：首页排行榜共 48 行（4 榜 × Top 12；v27 起默认隐藏 6~12 名，DOM 仍 48 行）',
   $$('#main .rrow').length === 48, $$('#main .rrow').length);
ok('v26：首页排行榜分节头不挂「查看全部」跳转（入口已删，不能再把用户送去无入口页）',
   doc.querySelectorAll('#main .hrank [data-go]').length === 0);
ok('v26：首页榜行的 data-d 仍指向各自 Tab（不是写死 pcRank）',
   $$('#main .rrow').every(r => r.dataset.d !== 'pcRank'));

/* ===== ★v27：首页榜单默认只露 Top 5，其余折叠 =====
   起因是 v26 落地后的副作用：首页 26 张精选卡 + 48 行榜，榜首几条与上方精选本来就是同一批游戏，
   页面被拉得很长。折叠的**判据必须落在「显隐状态」上**，不能只看行数 ——
   行数在折叠前后完全一样（都是 48），只数行数等于什么都没验。
   因此：① 数「未挂 .rb 的行」= 5；② 数「挂 .rb 的行」= 该榜总数 - 5；
   ③ 真点一下按钮，验 class 与文案都翻转（走真实 click，不读内部变量）。 */
ok('v27：首页每榜默认只露 Top 5（超出部分挂 .rb 隐藏类，不是靠删行）',
   $$('#main .rankboard').every(bd => {
     const all = [...bd.querySelectorAll('.rrow')];
     const vis = all.filter(r => !r.classList.contains('rb'));
     return all.length === 0 ||
       (vis.length === Math.min(5, all.length) && all.slice(5).every(r => r.classList.contains('rb')));
   }));
ok('v27：4 个榜各有一个「展开全部」按钮', $$('#main .rbmore').length === 4, $$('#main .rbmore').length);
const _rb = $$('#main .rbmore')[0];
const _rbBd = _rb ? _rb.closest('.rankboard') : null;
const _rbTotal = _rbBd ? _rbBd.querySelectorAll('.rrow').length : 0;
ok('v27：按钮文案 =「展开全部 N 条」，N 是该榜真实行数',
   !!_rb && _rb.textContent === ('展开全部 ' + _rbTotal + ' 条'), _rb && _rb.textContent);
if (_rb) _rb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v27：点「展开全部」→ 该榜加 .open、7 行被折叠行全部放出来、文案变「收起」',
   !!_rbBd && _rbBd.classList.contains('open') &&
   _rbBd.querySelectorAll('.rrow.rb').length === _rbTotal - 5 &&
   _rb.textContent === '收起（只显示 Top 5）',
   _rb && _rb.textContent);
if (_rb) _rb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v27：再点一次收起 → .open 摘掉、文案还原（同一按钮自反）',
   !!_rbBd && !_rbBd.classList.contains('open') && _rb.textContent === ('展开全部 ' + _rbTotal + ' 条'),
   _rb && _rb.textContent);
ok('v27：折叠靠「隐藏类 + 容器状态」实现，两条 CSS 都在',
   /\.rankboard \.rrow\.rb\{display:none\}/.test(code) &&
   /\.rankboard\.open \.rrow\.rb\{display:flex\}/.test(code));
ok('v27：深链页 goTab("pcRank") 不传 fold ⇒ 仍是全量 48 行可见、且无折叠按钮（深链行为不被改）',
   (() => { go('pcRank'); const n = $$('#main .rrow.rb').length, f = $$('#main .rbmore').length; go('home'); return n === 0 && f === 0; })());

/* ================= 7. ★ 弹窗详情（全站卡片） ================= */
ok('弹窗：DOM 存在 #mask/#dlg', !!mask && !!$('#dlg'));
ok('弹窗：默认关闭', !mask.classList.contains('on'));

// 每张卡都不再带 onclick 跳转
const onclickCards = ['pcNew', 'pcHot', 'pcRank', 'pcTrainer', 'pcMod', 'mNew', 'mEvent', 'mPlay']
  .flatMap(k => { go(k); return $$('#main .card, #main .mcard, #main .rrow'); })
  .filter(c => c.hasAttribute('onclick'));
ok('弹窗：卡片 / 排行行已无 onclick 直接跳转', onclickCards.length === 0, onclickCards.length);
ok('弹窗：卡片改带 data-d/data-i 定位数据',
   (() => { go('pcNew'); const c = cards()[0]; return c.hasAttribute('data-d') && c.hasAttribute('data-i'); })());
ok('弹窗：排行行也带 data-d/data-i 定位数据',
   (() => { go('pcRank'); const r = $$('#main .rrow')[0]; return !!r && r.hasAttribute('data-d') && r.hasAttribute('data-i'); })());

// 逐 Tab 打开弹窗，校验内容
const MODAL_TABS = ['pcNew', 'pcHot', 'pcRank', 'pcTrainer', 'pcMod', 'mNew', 'mEvent', 'mPlay'];
const badModal = [];
MODAL_TABS.forEach(k => {
  go(k);
  const c = $('#main .card, #main .mcard, #main .rrow');
  if (!c) { badModal.push(k + ':无卡片/行'); return; }
  c.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const on = mask.classList.contains('on');
  const title = ($('#dlg .dhtitle h2') || {}).textContent || '';
  const kvN = $$('#dlg .dkv .it').length;
  const hasClose = !!$('#dlg .dclose');
  const imgN = $$('#dlg .dtop img').length;
  if (!on || !title || kvN < 2 || !hasClose || !imgN) {
    badModal.push(`${k}: on=${on} title="${title}" kv=${kvN} close=${hasClose} img=${imgN}`);
  }
  win.eval('closeDetail()');
});
ok('弹窗：8 个 Tab 逐一点击均能正确打开（含标题/KV/图/关闭钮）',
   badModal.length === 0, badModal.slice(0, 3).join(' ;; '));

// 内容正确性：手游新游弹窗
go('mNew');
const target = D.mNew.find(x => (x.sources || []).length > 1) || D.mNew[0];
const targetIdx = D.mNew.indexOf(target);
$$('#main .mcard')[targetIdx].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('弹窗：标题 = 游戏名', $('#dlg .dhtitle h2').textContent === target.game,
   `${$('#dlg .dhtitle h2').textContent} vs ${target.game}`);
const kvText = $$('#dlg .dkv .k').map(e => e.textContent).join(',');
ok('弹窗：字段含「上线时间」', kvText.includes('上线时间'), kvText);
ok('弹窗：字段含「收录来源」', kvText.includes('收录来源'), kvText);
ok('弹窗：多平台卡片的跳转按钮数 = 来源数',
   $$('#dlg .dlinks a').length === target.sources.length,
   `${$$('#dlg .dlinks a').length} vs ${target.sources.length}`);
ok('弹窗：跳转按钮文案带来源名',
   $$('#dlg .dlinks a').every(a => /打开 .+ 原页/.test(a.textContent)),
   $$('#dlg .dlinks a').map(a => a.textContent).join('|'));
ok('弹窗：跳转链接均为 http(s)', $$('#dlg .dlinks a').every(a => /^https?:\/\//.test(a.getAttribute('href'))));
ok('弹窗：口径提示条说明合并口径', ($('#dlg .dnotice') || {}).textContent.includes('合并'));

// 三路关闭
win.eval('closeDetail()');
ok('弹窗：ESC 前先打开', (() => {
  $$('#main .mcard')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return mask.classList.contains('on');
})());
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok('弹窗：ESC 可关闭', !mask.classList.contains('on'));
$$('#main .mcard')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
$('#dlg .dclose').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('弹窗：关闭按钮可关闭', !mask.classList.contains('on'));
$$('#main .mcard')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
mask.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('弹窗：点击遮罩可关闭', !mask.classList.contains('on'));
ok('弹窗：关闭后内容已清空（不留残影）', $('#dlg').innerHTML.trim() === '');
ok('弹窗：关闭后 aria-hidden=true', mask.getAttribute('aria-hidden') === 'true');
ok('弹窗：关闭后 body 滚动已恢复', (doc.body.getAttribute('style') || '').indexOf('hidden') === -1);

// 点击卡片内部元素（如图片）也应能打开
go('pcHot');
const imgEl = $('#main .card .cv img');
if (imgEl) {
  imgEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('弹窗：点卡片内的图片同样打开', mask.classList.contains('on'));
  win.eval('closeDetail()');
}
// 弹窗内点击不应误关
$$('#main .card')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
$('#dlg .dbody').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('弹窗：点击弹窗内部不会误关', mask.classList.contains('on'));
win.eval('closeDetail()');

/* ★v12：原「8. ★ 报告可折叠列表」段落（13 条断言）已随报告模块一并移除 ——
   用户 2026-10-15 明确要求先下线报告模块，故这些断言**失去了被测对象**，
   属于「随模块一起下线」，**不是**「改断言去迁就实现」。断言总数 358 → 345。 */

/* ================= 8b. ★v6 数据层补字段（全部取自原项目既有字段） ================= */
/* ★ 判空必须把 0 也算空 —— 第一版只排除了 ''/null/undefined，
   结果反证时把 appid 全置 0，断言依然「全绿」（0 被判成有值）。这种「断言自己漏判」
   比业务 bug 更隐蔽：它会让后续所有反证失去意义。 */
const pcHotFill = k => D.pcHot.filter(x => x[k] !== undefined && x[k] !== null && x[k] !== '' && x[k] !== 0).length;
ok('v6数据：pcHot 全部带库内记录 ID recId', pcHotFill('recId') === D.pcHot.length, `${pcHotFill('recId')}/${D.pcHot.length}`);
ok('v6数据：pcHot 全部带源更新时间 updated', pcHotFill('updated') === D.pcHot.length, `${pcHotFill('updated')}/${D.pcHot.length}`);
ok('v6数据：pcHot 多数带 Steam appid（拼商店直链用）', pcHotFill('appid') >= D.pcHot.length * 0.8, `${pcHotFill('appid')}/${D.pcHot.length}`);
ok('v6数据：pcHot appid 均为正整数', D.pcHot.filter(x => x.appid).every(x => Number.isInteger(x.appid) && x.appid > 0));
ok('v6数据：pcHot 存在跨源机地 ID', pcHotFill('jidiId') > 0, pcHotFill('jidiId'));
ok('v6数据：mNew 补了好游时间轴日期 tlDate', D.mNew.filter(x => x.tlDate).length > 0, D.mNew.filter(x => x.tlDate).length);
ok('v6数据：mNew 补了发行商 publisher', D.mNew.filter(x => x.publisher).length > 0, D.mNew.filter(x => x.publisher).length);
ok('v6数据：tlDate 形如「N月N日」（不推算年份，避免造假时间戳）',
   D.mNew.every(x => !x.tlDate || /^\d{1,2}月\d{1,2}日$/.test(x.tlDate)),
   (D.mNew.find(x => x.tlDate) || {}).tlDate);
// 那两条「上游无评分无热度」的记录（好游快爆独家）必须已由原项目字段补出可用兜底
const noEng = D.mNew.filter(x => !x.hot && !x.score);
ok('v6数据：无评分/热度的记录已补出时效行与状态',
   noEng.every(x => (x.note || '').length > 0 && !!x.status),
   JSON.stringify(noEng.map(x => [x.game, x.note])));
ok('v6数据：无评分/热度的记录确实来自好游快爆独家单源',
   noEng.every(x => (x.srcKeys || []).length === 1 && x.srcKeys[0] === 'haoyou'),
   JSON.stringify(noEng.map(x => x.srcKeys)));

/* ================= 8c. ★v6 弹窗版式（对齐 PC 游戏工作台详情抽屉） ================= */
ok('v6弹窗：hero 结构完整（模糊底 + 主图 + 渐变 + 标题 + 关闭 + 来源徽标）',
   /\.dtop\{/.test(html) && /\.dbg\{/.test(html) && /\.dfg\{/.test(html) &&
   /\.dgrad\{/.test(html) && /\.dhtitle/.test(html) && /\.dclose\{/.test(html) && /\.dsrc\{/.test(html));
/* ★ 关键回归：hero 大图**不许再用「固定高度 + cover」**——这正是用户截图里「图片被截了」的根因。
   现在改为纯 CSS：宽图 width:100%+height:auto 铺满且不裁；方图 / 竖图靠 max-height 触发 contain 完整显示。 */
ok('v6弹窗：hero 主图 object-fit:contain（不裁切）', /\.dfg\{[^}]*object-fit:contain/.test(html));
ok('v6弹窗：hero 主图带 max-height 限高（方图不会被撑成巨图）', /\.dfg\{[^}]*max-height/.test(html));
ok('v6弹窗：hero 主图 width:100% + height:auto（宽图铺满整宽）', /\.dfg\{[^}]*width:100%[^}]*height:auto/.test(html));
ok('v6弹窗：旧「固定高度 196px」的 hero 规则已删除', !/\.dtop\{[^}]*height:196px/.test(html));
ok('v6弹窗：不存在「.dtop img 全部 cover」这类会裁图的规则', !/\.dtop img\{[^}]*object-fit:cover/.test(html));
ok('v6弹窗：已删除依赖 onload 判比例的 fitTop',
   !/function fitTop/.test(html) && !/onload="fitTop/.test(html));
ok('v6弹窗：KV 为恒 3 列卡片网格', /\.dkv\{[^}]*grid-template-columns:repeat\(3,1fr\)/.test(html));
ok('v6弹窗：存在大号数字样式 .sbig', /\.sbig\{/.test(html));
ok('v6弹窗：存在平台直达按钮组样式 .dlinks', /\.dlinks a\{/.test(html));
ok('v6弹窗：hero 图与卡片图共用 no-referrer 策略', /referrerpolicy="no-referrer"/.test(html));

// 逐 Tab 校验弹窗字段充实度
go('pcNew');
$('#main .card').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v6弹窗：PC 端游字段 >=8 格（v5 只有 6 格）', $$('#dlg .dkv .it').length >= 8, $$('#dlg .dkv .it').length);
ok('v6弹窗：PC 端游字段含 Steam AppID',
   $$('#dlg .dkv .k').map(e => e.textContent).join(',').includes('Steam AppID'));
ok('v6弹窗：PC 端游有「平台直达」区块', $$('#dlg .dblock h4').some(h => h.textContent.includes('平台直达')));
ok('v6弹窗：PC 端游直达入口 >=2', $$('#dlg .dlinks a').length >= 2, $$('#dlg .dlinks a').length);
ok('v6弹窗：PC 端游有大号评分/热度数字', !!$('#dlg .sbig'));
win.eval('closeDetail()');

go('pcHot');
const withApp = D.pcHot.findIndex(x => x.appid);
if (withApp >= 0) {
  $$('#main .card')[withApp].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const hrefs = $$('#dlg .dlinks a').map(a => a.getAttribute('href')).join(' ');
  ok('v6弹窗：带 appid 的记录给出 Steam 商店页直链',
     hrefs.includes('store.steampowered.com/app/' + D.pcHot[withApp].appid), hrefs);
  win.eval('closeDetail()');
}

go('mEvent');
$('#main .mcard').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v6弹窗：活动弹窗无大号数字行（本就没有量化指标，不硬凑）', !$('#dlg .sbig'));
ok('v6弹窗：活动弹窗有「活动标题」区块', $$('#dlg .dblock h4').some(h => h.textContent.includes('活动标题')));
win.eval('closeDetail()');

go('mPlay');
$('#main .card').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v6弹窗：可玩端游大数字不是半截句子（<=12 字）',
   !$('#dlg .sbig') || $('#dlg .sbig').textContent.trim().length <= 12,
   ($('#dlg .sbig') || {}).textContent);
win.eval('closeDetail()');

/* ================= 8d. ★v6 卡片位置固定（不随名称/标题/标签长度变化） ================= */
ok('v6卡片：手游卡整卡定高（.mcard 有 height）', /\.mcard\{[^}]*height:\s*\d+px/.test(html));
ok('v6卡片：新游卡同样定高 .mcard.nw', /\.mcard\.nw\{[^}]*height:\s*\d+px/.test(html));
ok('v6卡片：新游卡标题行定高 .mrow', /\.mrow\{[^}]*height:20px/.test(html));
ok('v6卡片：新游卡标签行定高 .mtags（标签个数不影响高度）', /\.mtags\{[^}]*height:20px/.test(html));
ok('v6卡片：新游卡时效行定高 .msub.gn', /\.msub\.gn\{[^}]*height:18px/.test(html));
ok('v6卡片：右侧数字列定宽 .mscore（数字位数不影响左侧宽度）', /\.mscore\{[^}]*width:76px/.test(html));
ok('v6卡片：状态词超长时省略（.mst 有 max-width + ellipsis）',
   /\.mst\{[^}]*max-width[^}]*text-overflow:ellipsis/.test(html));
ok('v6卡片：PC 卡片标题固定预留两行（--cd-t2）', /--cd-t2:\s*2\.8em/.test(html));
go('mNew');
const mn2 = $$('#main .mcard');
ok('v6卡片：新游卡右侧数字位 100% 存在（不留空）', $$('#main .mscore').length === mn2.length,
   `${$$('#main .mscore').length}/${mn2.length}`);
ok('v6卡片：右侧数字位要么有值(.ic+.v)要么是占位「—」',
   $$('#main .mscore').every(e => (e.querySelector('.ic') && e.querySelector('.v')) ||
                                   (e.classList.contains('none') && e.textContent.trim() === '—')));
ok('v6卡片：占位数 = 上游确无 engagement 的记录数',
   $$('#main .mscore.none').length === noEng.length,
   `${$$('#main .mscore.none').length} vs ${noEng.length}`);

/* ================= 8e. ★v8 标题拆分工具（原 splitName → nameParts） ================= */
/* ★v8 把 v6 的 splitName（只认第一个 `/`）升级为 nameParts：
   title 实际是「中文名/英文名/中文别名」的自由拼接，只认第一个 `/` 会把
   `侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy` 整串当成别名而不拆。
   新规则按「段是否含 CJK」分类，并带两条防误拆护栏。 */
ok('nameParts：中文名 / 英文名正确拆分',
   npOf('生化危机9：安魂曲/Resident Evil Requiem').main === '生化危机9：安魂曲' &&
   npOf('生化危机9：安魂曲/Resident Evil Requiem').en === 'Resident Evil Requiem');
ok('nameParts：无斜杠时整串作主名且 changed=false',
   npOf('剑星').main === '剑星' && npOf('剑星').en === '' && npOf('剑星').changed === false);
ok('nameParts：第二段含中文时视为别名、不拆（红色警戒2/红警2）',
   npOf('红色警戒2/红警2').changed === false && npOf('红色警戒2/红警2').main === '红色警戒2/红警2');
ok('nameParts：多段中英混合 → 中文段按原序拼接、英文段合并进括号',
   npOf('侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy').main === '侠盗猎车手5传承版 / GTA5传承版' &&
   npOf('侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy').en === 'Grand Theft Auto V Legacy',
   JSON.stringify(npOf('侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy')));
ok('nameParts：斜杠落在中文词内部时不拆（【mod】…果/体+动态x器官）',
   npOf('【mod】极致细致的果/体+动态x器官').changed === false,
   JSON.stringify(npOf('【mod】极致细致的果/体+动态x器官')));
ok('nameParts：全是英文段也不拆（否则会输出 AAA/BBB（AAA / BBB）这种重复）',
   npOf('GTA V/Enhanced').changed === false && npOf('GTA V/Enhanced').main === 'GTA V/Enhanced');
ok('titleHTML：把英文名包进中文全角括号（）',
   win.eval('titleHTML')('生化危机9：安魂曲/Resident Evil Requiem') ===
   '生化危机9：安魂曲<span class="en">（Resident Evil Requiem）</span>',
   win.eval('titleHTML')('生化危机9：安魂曲/Resident Evil Requiem'));
ok('titleHTML：不需要拆分时原样转义返回（不产生空括号）',
   win.eval('titleHTML')('剑星') === '剑星');
ok('syncImgs：存在「渲染后补跑」函数（防缓存命中漏跑 onload）', typeof win.eval('syncImgs') === 'function');
ok('syncImgs：对 .cv img 与 .mth img 都补跑 reveal', /querySelectorAll\('\.cv img, \.mth img[,)]/.test(html));
ok('v9：syncImgs 也覆盖首页主图与右侧小卡（.hpic img / .hsitem img）',
   /querySelectorAll\('\.cv img, \.mth img, \.hpic img, \.hsitem img'\)/.test(html));
ok('reveal：容器缺失/空节点时不抛错（缓存命中时序防护）',
   (() => { try { const im = doc.createElement('img'); win.eval('reveal')(im); return im.classList.contains('ready'); } catch (e) { return false; } })());

/* ================= 8f. ★v8 卡片标题：英文名用（）包含（用户需求①） ================= */
go('pcNew');
ok('v8标题：.ctitle .en 样式存在（英文名小半号、灰度降一档）', /\.ctitle \.en\{/.test(html));
ok('v8标题：PC 卡片里确实有英文名被括号包起来（>=10 张）',
   $$('#main .ctitle .en').length >= 10, $$('#main .ctitle .en').length);
ok('v8标题：括号内一律是纯英文（不含中日韩汉字）',
   $$('#main .ctitle .en').every(e => !/[\u4e00-\u9fff]/.test(e.textContent)),
   $$('#main .ctitle .en').map(e => e.textContent).slice(0, 3).join('|'));
ok('v8标题：括号为中文全角括号（）',
   $$('#main .ctitle .en').every(e => e.textContent.startsWith('（') && e.textContent.endsWith('）')),
   $$('#main .ctitle .en').map(e => e.textContent).slice(0, 2).join('|'));
ok('v8标题：主名（去掉括号）与数据 title 的中文段一致',
   (() => {
     const c = $$('#main .card')[0];
     const t = D.pcNew.find(x => npOf(x.title).main === c.querySelector('.ctitle').cloneNode(true)
       .textContent.replace(/（[^）]*）$/, '').trim());
     return !!t;
   })());
ok('v8标题：不需要拆分的标题原样显示（不多出空括号）',
   $$('#main .ctitle').every(e => !e.textContent.includes('（）')));
go('pcRank');
ok('v8标题：排行榜行名同样按（）规则渲染', $$('#main .rgname .en').length > 0, $$('#main .rgname .en').length);
go('home');
ok('v8标题：首页轮播标题同样按（）规则渲染',
   $$('#main .hname').length > 0 &&
   $$('#main .hname').every(e => !e.textContent.includes('（）')));

/* ================= 8g. ★v8 首页 / 轮播样式（用户需求⑤） ================= */
ok('v8首页：.hero 轮播容器样式存在', /\.hero\{/.test(html));
ok('v8首页：slide 默认 display:none，.on 才显示（不是全部叠在一起）',
   /\.hslide\{display:none\}/.test(html) && /\.hslide\.on\{display:flex\}/.test(html));
ok('v8首页：图片区定比（切换不同比例的图也不会抖）', /\.hpic\{[^}]*aspect-ratio/.test(html));
ok('v8首页：轮播图 cover 满幅（与卡片同一决策）', /\.hpic img\{[^}]*object-fit:cover/.test(html));
ok('v8首页：存在自动切换间隔常量 HERO_MS', /const HERO_MS = \d+;/.test(html));
ok('v8首页：悬停暂停已实现（不要在看某条时被切走）',
   /addEventListener\('mouseenter', stopHero\)/.test(html));
ok('v8首页：切页前会停掉计时器（不留后台 interval）',
   /stopHero\(\);/.test(html) && /function stopHero\(\)/.test(html));
ok('v8首页：指示点高亮态 .hdots i.on 有独立样式', /\.hdots i\.on\{/.test(html));
ok('v8首页：精选区块沿用两套列宽（PC 窄 / 手游宽）',
   /\.hseclist\.pc\{/.test(html) && /\.hseclist\.mb\{/.test(html));
ok('v8首页：轮播「打开原页」用 <a target=_blank rel=noopener>',
   /class="sec" href="[^"]*" target="_blank" rel="noopener"/.test(html) ||
   /<a class="sec" href="\$\{esc\(m\.url\)\}" target="_blank" rel="noopener">/.test(html));

/* ================= 8h. ★v8 卡片位置固定（右上角标签区不挤动正文） =================
   ★v16-F 口径更新（**用户驱动的规格变更，不是改断言迁就实现**）：
     用户 2026-10-16 ⑦ 明确要求「根据游戏活动图片进行适配优化…放大一点图片和标题」，
     于是活动卡（`.mcard` 基类）106 → **118px**、活动 banner 宽 88 → 112px。
     下面两条守的**语义从来没变**：卡高是 CSS **定死**的（不是被内容撑出来的），
     所以标签个数、标题长短都不会改变卡片高度。变的只是那个定死的具体数值，
     所以判据从「等于 106」改成「有确定的 px 高度」并额外钉住新值 118。
     （新游卡 `.mcard.nw` 不受影响，仍是 106px —— 它两个类、优先级更高。） */
ok('v16F卡片：手游活动卡高度由 CSS 定死（★v16-F 起 118px；用户 ⑦ 要求放大）',
   /\.mcard\{height:118px;padding-top:26px\}/.test(html), /\.mcard\{[^}]*\}/.exec(html));
ok('v16F卡片：活动卡标题放大到 14.5px（用户 ⑦「标题放大一点」）',
   /\.mcard\.ev \.mt\{font-size:14\.5px/.test(html));
ok('v16F卡片：活动 banner 宽 88 → 112px（图片放大）',
   /--mb-tw:112px/.test(html) && !/--mb-tw:88px/.test(html));
ok('v8卡片：新游卡仍是 106px 高（与活动卡各自定高，互不影响）',
   /\.mcard\.nw\{[^}]*height:106px/.test(html));
ok('v8卡片：平台标签区 .mtop 绝对定位在右上角',
   /\.mcard \.mtop\{[^}]*position:absolute[^}]*right:12px/.test(html));
ok('v8卡片：平台标签区有 max-width 限宽（标签过长被裁而不是撑宽）',
   /\.mcard \.mtop\{[^}]*max-width:calc\(/.test(html),
   /\.mcard \.mtop\{[^}]*\}/.exec(html));
ok('v8卡片：平台标签区 overflow:hidden + nowrap（一行裁掉，不换行）',
   /\.mcard \.mtop\{[^}]*overflow:hidden/.test(html) &&
   /\.mcard \.mtop\{[^}]*flex-wrap:nowrap/.test(html));
ok('v8卡片：平台标签区脱离文档流（绝对定位 ⇒ 标签个数不影响卡片高度）',
   /\.mcard \.mtop\{[^}]*position:absolute/.test(html));
go('mNew');
ok('v8卡片：标签区不参与正常流 ⇒ 卡高与标签数无关（同一 Tab 内 .mcard 高度一致由 CSS 定死）',
   /\.mcard\{height:\d+px/.test(html) && $$('#main .mcard').every(c => c.querySelector('.mtop')));

/* ================= 9. 全 Tab 遍历 ================= */
let travErr = null;
try {
  ['home', 'pcNew', 'pcHot', 'pcRank', 'pcTrainer', 'pcMod', 'mNew', 'mEvent', 'mPlay'].forEach(k => {
    go(k);
    if (!main().innerHTML.length) throw new Error(k + ' 渲染为空');
  });
  /* 首页计时器必须能被停掉，否则每次切回首页都会叠一个 interval */
  go('home'); win.eval('stopHero()');
  ok('计时器：stopHero 后 heroTimer 归零', win.eval('heroTimer === null'));
  go('pcNew');
} catch (e) { travErr = e.message; }
ok('全 Tab 遍历无异常（含 v8 新增首页）', !travErr, travErr);

/* ================= 10. ★v9 双主题（深色/浅色可切换）+ TapTap 化版式 ================= */

/* ---- 10a. 主题 token ---- */
ok('v9主题：浅色根 token 未动（--bg 仍是 #f4f6fb ⇒ 浅色零退化）',
   /:root\{[^}]*--bg:#f4f6fb/.test(code));
ok('v9主题：存在 html[data-theme="dark"] 覆盖块', /html\[data-theme="dark"\]\{/.test(code));
ok('v25主题：深色主色 = games.gg 品牌绿 #23db8c（v9 青绿 #00d9c5 作废）',
   /html\[data-theme="dark"\]\{[^}]*--accent:#23db8c/.test(code) &&
   /html\[data-theme="dark"\]\{[^}]*--bg:#060d17/.test(code));
ok('v25主题：深色覆盖了 页面底/面板/文字/次级文字/分割线（games.gg slate 阶）',
   ['--bg:#060d17', '--card:#101828', '--txt:#f9fafb', '--sub:#99a1af', '--line:#1e2939']
     .every(t => code.includes(t)));
/* ★ 意图断言：深色底必须是「冷色深底」（蓝通道 > 红通道），而不是 v9 的中性灰。
   这样下一轮换具体色号时本条仍有效，只有「不再蓝」时才变红 —— 比锁死 #060d17 更能表达设计意图。 */
ok('v25主题：深色底是冷色（蓝通道 > 红通道），不是 v9 的中性灰',
   (()=>{ const m=code.match(/html\[data-theme="dark"\]\{[^}]*--bg:#([0-9a-f]{6})/);
          if(!m) return false;
          const r=parseInt(m[1].slice(0,2),16), b=parseInt(m[1].slice(4,6),16);
          return b > r + 16; })());
ok('v25主题：新增 --on-accent（主色底文字色；品牌绿是亮色 ⇒ 深色下反成深墨绿）',
   /--on-accent:#ffffff/.test(code) && /--on-accent:#04170e/.test(code));
ok('v9主题：--hdr 与标题色已拆开（否则深色下大标题会变纯黑）',
   /--title-strong:#1e3a6e/.test(code) && /--title-strong:#ffffff/.test(code) &&
   !/\.hname\{[^}]*color:var\(--hdr\)/.test(code));
ok('v9主题：来源 pill 有深色专属覆盖（浅底深字在深色下会两头失效）',
   /html\[data-theme="dark"\] \.pill\.src-xd\{/.test(code));
ok('v9主题：半透明叠色保留原 α（换成纯色会造成可测色差）',
   /--code-bg:rgba\(255,255,255,\.6\)/.test(code) && /--badge-bg:rgba\(255,255,255,\.95\)/.test(code));
ok('v9主题：.notice 与 .dnotice 各自保留原棕色（不强行统一）',
   /--warn-tx:#7c4a03/.test(code) && /--note-tx:#8a5b00/.test(code));

/* ---- 10a-2. ★v25 圆角级差 + 胶囊折叠 ---- */
ok('v25：定义了 6 级圆角级差（xs/sm/md/m/lg/xl）',
   ['--r-xs:', '--r-sm:', '--r-md:', '--r-m:', '--r-lg:', '--r-xl:'].every(t => code.includes(t)));
/* 反证：全仓不许再出现 ad-hoc 的中大号裸 px 圆角（2/3px 微件与 36px 胶囊槽豁免）。
   这条是「级差真的在用」的证据 —— 变量定义得再全，只要有人继续写裸 px 就等于没收敛。 */
ok('v25：中大号圆角已全部走变量（无 4~16px 裸值残留）',
   !/border-radius: *(4|5|6|7|8|9|10|11|12|14|16)px/.test(code));
ok('v25：游戏卡用最大级差 --r-xl（对齐参考站 1rem 卡片）',
   /^\.card\{[\s\S]{0,120}?border-radius:var\(--r-xl\)/m.test(code));
ok('v25：foldMeta 已定义，并在 bindMain 末尾调用（靠 clientWidth，必须布局后量）',
   /function foldMeta\(root\)\{/.test(code) &&
   /[^a-zA-Z]foldMeta\(main\);/.test(code));
/* 反证防「半夜被删」：折叠必须在 jsdom（clientWidth=0）里天然不生效，
   否则会改变卡片里 pill 的个数，把一堆既有断言打成假红。 */
ok('v25：foldMeta 以 clientWidth 作守卫（jsdom 无布局 ⇒ 不折，既有断言不受影响）',
   /if\(!box\.clientWidth\) return;/.test(code));
ok('v25：折叠计数胶囊 .pill.foldn 有独立样式（虚描边 + 主色字，才看得出是交互提示）',
   /\.pill\.foldn\{[\s\S]{0,140}?border-style:dashed[\s\S]{0,80}?color:var\(--accent\)/.test(code));
ok('v25：给了 resize 重算（列数随宽度变，折叠结果必须跟着变）',
   /addEventListener\('resize'[\s\S]{0,120}?foldMeta/.test(code));

/* ---- 10b. 切换机制 ---- */
ok('v9主题：<head> 有防闪脚本（先定 data-theme，再解析 CSS）',
   code.indexOf("getItem('gi-theme')") > 0 && code.indexOf("getItem('gi-theme')") < code.indexOf('<style>'));
ok("v9主题：首访默认 dark", /var t = 'dark';/.test(code));
ok('v9主题：html 元素已带 data-theme 属性', !!doc.documentElement.getAttribute('data-theme'));
const tb = $('#themeBtn');
ok('v9主题：顶栏存在切换按钮 #themeBtn', !!tb);
if (tb) {
  const b4 = doc.documentElement.getAttribute('data-theme');
  tb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const af = doc.documentElement.getAttribute('data-theme');
  ok('v9主题：点按钮能切换 data-theme', b4 !== af, `${b4} → ${af}`);
  ok('v9主题：按钮文案随主题改名（夜间 / 日间）', /夜间|日间/.test(tb.textContent), tb.textContent);
  tb.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('v9主题：再点一次切回原主题', doc.documentElement.getAttribute('data-theme') === b4);
}

/* ---- 10c. ★v10 排行榜：4 榜 · 固定 2 列 ----
   ⚠️ 这一块**推翻了 v9 的口径**：v9 是「三个榜 + minmax(340px) 自适应列」，
   在 1424 宽下排成 3 列刚好；v10 变成 4 个榜后，同样的规则会排成 **3+1 孤行**。
   所以列数改为固定 2 列，并且 .rpill 的用途也变了（见下）。 */
go('pcRank');
ok('v10排行：4 榜被收进 .rankboards 并排容器', !!$('#main .rankboards'));
ok('v10排行：.rankboards 用 grid + **固定 2 列**（不再是 minmax(340px) 自适应）',
   /\.rankboards\{[^}]*display:grid/.test(code) &&
   /\.rankboards\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(code) &&
   !/\.rankboards\{[^}]*minmax\(340px/.test(code));
ok('v10排行：4 个榜块', $$('#main .rankboard').length === 4, $$('#main .rankboard').length);
ok('v10排行：仍无比例条 .rbarwrap（排序已由榜名 + 数值表达）',
   $$('#main .rrow .rbarwrap').length === 0);
/* ★v9 曾断言 `.rrow .rpill` 数量为 0（340px 窄列塞不下 6 个元素）。
   v10 列宽回到 ~590px，.rpill 被**复用为「热度口径标签」**（TapTap 关注 / 好游预约…），
   所以这条断言的**前提本身变了**：不是「全页为 0」，而是「只在跨源归一化的手机两榜出现」。
   断言跟着改成更精确的形态 —— 比原来更能守住东西（PC 两榜混进 chip 也会红）。 */
ok('v10排行：.rpill 只出现在手机两榜（PC 两榜必须为 0）',
   (() => {
     const rl = $$('#main .rlist');
     const cnt = n => rl[n] ? rl[n].querySelectorAll('.rrow .rpill').length : -1;
     return cnt(0) === 0 && cnt(1) === 0 && cnt(2) === 12 && cnt(3) === 12;
   })(),
   (() => {
     const rl = $$('#main .rlist');
     return [0, 1, 2, 3].map(n => rl[n] ? rl[n].querySelectorAll('.rrow .rpill').length : -1).join(',');
   })());
ok('v10排行：行仍保留 名次/缩略图/名称/数值 四件套',
   $$('#main .rrow').length > 0 && $$('#main .rrow').every(r => r.querySelector('.rno') && r.querySelector('.rth') &&
                               r.querySelector('.rgname') && r.querySelector('.rval')));
ok('v10排行：.rankboard 不再自带 margin-bottom（间距交给 grid gap）',
   /\.rankboard\{background:var\(--card\)/.test(code));

/* ---- 10e. ★v10 MOD 页三处修复（由用户提问「获取源是哪些」暴露） ---- */
go('pcMod');
ok('v10MOD：数据层已补来源字段（src=机地 / srcKey=jidi）',
   (D.pcMod || []).length > 0 && D.pcMod.every(a => a.src === '机地' && a.srcKey === 'jidi'));
ok('v10MOD：数据层已补机地**原帖** postUrl（原来只有被覆盖成库页面的 url）',
   (D.pcMod || []).length > 0 && D.pcMod.every(a => /^https:\/\/jidiyouxi\.com\/post\/detail\//.test(a.postUrl || '')),
   (D.pcMod[0] || {}).postUrl);
ok('v10MOD：libUrl / libSrc 成对且域名正确（xdgame 或 jidiyouxi）',
   (D.pcMod || []).every(a => !a.libUrl ||
     (a.libSrc && /xdgame\.com|jidiyouxi\.com/.test(a.libUrl))));
ok('v10MOD：源数据仍保留旧字段 url（向后兼容，不把老字段删掉）',
   (D.pcMod || []).every(a => typeof a.url === 'string'));
/* ① 死筛选已删 */
ok('v10MOD：★「类型」筛选组已删除（原来点「修改器」必然筛出空集）',
   $$('#main .filter-bar .tg').length === 0, $$('#main .filter-bar .tg').length);
ok('v10MOD：池子里确实全是 MOD（所以那个「修改器」选项根本无处可筛）',
   (D.pcMod || []).length > 0 && D.pcMod.every(a => a.kindKey === 'mod'));
/* ② 卡片左上角改成来源 */
ok('v10MOD：★卡片左上角挂的是**来源**（机地），不再是类型「MOD」',
   $$('#main .card .tag').length > 0 && $$('#main .card .tag').every(t => t.textContent.trim() === '机地'),
   $$('#main .card .tag').length ? $$('#main .card .tag')[0].textContent : '—');
/* ③ 弹窗：原帖与游戏页分开给 */
const modCard0 = $$('#main .card')[0];
if (modCard0) modCard0.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const dlinks = $$('#dlg .dlinks a').map(a => ({ t: a.textContent.trim(), h: a.getAttribute('href') || '' }));
ok('v10MOD：弹窗给出「打开原帖（机地）」且指向 jidiyouxi 帖子',
   dlinks.some(l => l.t.includes('打开原帖（机地）') && /jidiyouxi\.com\/post\/detail\//.test(l.h)),
   JSON.stringify(dlinks.map(l => l.t)));
ok('v10MOD：弹窗给出「打开游戏页（XD / 机地）」且指向库页面',
   dlinks.some(l => /打开游戏页（(XD|机地)）/.test(l.t) && /xdgame\.com\/game\/|jidiyouxi\.com\/game\//.test(l.h)),
   JSON.stringify(dlinks.map(l => l.t)));
ok('v10MOD：★「原帖」与「游戏页」是两个不同 URL（原来被合成一个、且指向了错的那个）',
   (() => {
     const p = dlinks.find(l => l.t.includes('打开原帖（机地）'));
     const g = dlinks.find(l => /打开游戏页/.test(l.t));
     return !!p && !!g && p.h !== g.h;
   })());
ok('v10MOD：弹窗来源徽标写「机地」', ($('#dlg .dsrc') || {}).textContent === '机地',
   ($('#dlg .dsrc') || {}).textContent);
win.eval('closeDetail()');
ok('v10MOD：来源说明写明真实来源站（jidiyouxi.com/modify/list）与「单一来源」',
   ($('#main .notice') || {}).textContent.includes('jidiyouxi.com/modify/list') &&
   ($('#main .notice') || {}).textContent.includes('单一来源'));
/* ★v13：原断言把「7,825」与「79.1%」**写死在正则里** —— 那是 2026-10-08 快照的实测值。
   2026-10-15 重跑 _build_data.py 后 modMatched.rate 由 79.1 → **96.1**（匹配率真的提高了），
   而页面文案本来就是**从 D.totals 动态生成**的 ⇒ 该改的是断言，不是文案。
   ⚠️ 这是「**随数据更新**」不是「改断言迁就实现」：被守护的行为（文案含构成 + 匹配率）没变，
      变的只是期望值来源 —— 从硬编码改成与页面同源。 */
const _mk = (D.totals && D.totals.modByKind) || {}, _mm = (D.totals && D.totals.modMatched) || {};
const _thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
ok('v10MOD：来源说明写明 MOD / 修改器构成与匹配率（不再只写一个 8,943）',
   new RegExp('MOD\\s*' + _thousands(_mk.mod)).test(($('#main .notice') || {}).textContent) &&
   new RegExp(String(_mm.rate) + '%').test(($('#main .notice') || {}).textContent),
   `期望 MOD ${_mk.mod} / ${_mm.rate}% ｜实际：` + (($('#main .notice') || {}).textContent || '').slice(0, 160));

/* ---- 10f. ★v10 首页精选块：固定列数，消除孤行 ---- */
go('home');
ok('v10首页：.hseclist.pc 用**固定 5 列**（auto-fill 会排成 5+1 孤行）',
   /\.hseclist\.pc\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/.test(code) &&
   !/\.hseclist\.pc\{[^}]*auto-fill/.test(code));
ok('v10首页：.hseclist.mb 用**固定 3 列**',
   /\.hseclist\.mb\{[^}]*repeat\(3,minmax\(0,1fr\)\)/.test(code) &&
   !/\.hseclist\.mb\{[^}]*auto-fill/.test(code));
ok('v10首页：PC 两块各 10 张卡（5 列 × 2 行 = 排满，不留孤行）',
   (() => {
     const secs = $$('#main .hseclist.pc');
     return secs.length === 2 && secs.every(s => s.querySelectorAll('.card').length === 10);
   })(),
   $$('#main .hseclist.pc').map(s => s.querySelectorAll('.card').length).join(','));
ok('v10首页：手游块 6 张卡（3 列 × 2 行 = 排满）',
   (() => {
     const s = $$('#main .hseclist.mb')[0];
     return !!s && s.querySelectorAll('.mcard').length === 6;
   })(),
   $$('#main .hseclist.mb').map(s => s.querySelectorAll('.mcard').length).join(','));
ok('v10首页：区块副标题写明 Top 数量（Top 10 / Top 6）',
   $$('#main .hsechd .sub').map(e => e.textContent).join('|').includes('Top 10') &&
   $$('#main .hsechd .sub').map(e => e.textContent).join('|').includes('Top 6'),
   $$('#main .hsechd .sub').map(e => e.textContent).join('|'));

/* ---- 10d. 首页 Hero：1 大 + 2 小 ---- */
go('home');
ok('v9首页：Hero 分左右两栏（.hmain + .hside）',
   !!$('#main .hero .hmain') && !!$('#main .hero .hside'));
ok('v9首页：主图区仍是 #heroSlides，控件挂在它内部',
   !!$('#main #heroSlides') && !!$('#main #heroSlides .hctrl'));
ok('v9首页：右侧 9 组预览、同时只显示 1 组',
   $$('#main .hside .hside-set').length === 9 && $$('#main .hside .hside-set.on').length === 1);
ok('v9首页：小卡带压字标题 .cap', $$('#main .hside .hsitem .cap').length > 0);
ok('v9首页：切到第 2 张后右侧仍只有 1 组显示且跟着换', (() => {
  win.eval('heroGo')(1);
  const on = $$('#main .hside .hside-set.on');
  const good = on.length === 1 && on[0].dataset.set === '1';
  win.eval('heroGo')(0);
  return good;
})());
ok('v9首页：小卡用 opacity 切换而非 display:none（display:none 会让图不预加载）',
   /\.hside-set\{[^}]*opacity:0/.test(code) && /\.hside-set\.on\{opacity:1/.test(code));
ok('v9首页：.hpic 主图占比提到 52%（1 大 2 小后主图区变窄）',
   /\.hpic\{[^}]*flex:0 0 52%/.test(code));
go('pcNew');

/* ================= 11. ★v13 搜索重做 / 列表局部刷新 / 响应式断点 =================
   本组守的是本轮才确立的 4 件事，**不涉及任何既有断言的改口径**：
     ① 搜索只查**字段白名单** —— 旧实现是 JSON.stringify(整条) 子串匹配，
        记录里的 url / cover 也参与，搜 "http" 会命中每一条；
     ② 搜索命中**加权**（主名 > 英文名 > 厂商 > 品类 > 简介），结果按得分降序；
     ③ 输入时**只重刷结果列表**，不重建 #main 外壳 ⇒ 搜索框节点身份不变、焦点与光标不丢
        （旧的 focus + setSelectionRange hack 因此整段删除）；
     ④ 全站补了 3 档响应式断点，且**断点都在 1424 以下** —— 默认窗口 1424×861 的观感不变。
   注意：11a 直接测纯函数 searchScore()，不去赌数据里恰好有没有 "http" 这种词。 */

/* ---- 11a. 搜索：字段白名单 + 五档加权 ---- */
const sscore = win.eval('searchScore');
const s5 = t => sscore(t, '赛博');
ok('v13搜索：URL / 封面地址不再参与匹配（旧实现搜 "http" 会命中每一条）',
   sscore({ title: '别的游戏', url: 'https://a/b', cover: 'http://a/b.jpg' }, 'http') === 0);
ok('v13搜索：五档加权 —— 主名 5 / 英文名 4 / 厂商 3 / 品类 2 / 简介 1 / 其他字段 0',
   s5({ title: '赛博朋克2077' }) === 5 && s5({ en: '赛博' }) === 4 &&
   s5({ publisher: '赛博' }) === 3 && s5({ genre: '赛博' }) === 2 &&
   s5({ intro: '赛博' }) === 1 && s5({ url: '赛博' }) === 0,
   [s5({ title: '赛博朋克2077' }), s5({ en: '赛博' }), s5({ publisher: '赛博' }),
    s5({ genre: '赛博' }), s5({ intro: '赛博' }), s5({ url: '赛博' })].join(','));
ok('v13搜索：数组字段（tags / alias 等）也能命中并计分',
   sscore({ tags: ['动作', '赛博朋克'] }, '赛博') === 2);

/* ---- 11b. 搜索：输入只重刷列表，不重建外壳 ---- */
go('pcNew');
const kwNode = $('#kw'), barNode = $('#main .filter-bar');
ok('v13搜索：列表页有 #listbox 锚点（局部刷新用）', !!$('#main #listbox'));
kwNode.value = (D.pcNew[0].title || '').slice(0, 2);
kwNode.dispatchEvent(new win.Event('input', { bubbles: true }));
ok('v13搜索：输入后 #main 外壳未重建 —— #kw 仍是同一个节点（焦点/光标因此不会丢）',
   $('#kw') === kwNode);
ok('v13搜索：筛选栏也未被重建（节点身份不变 ⇒ 不会重复绑定）',
   $('#main .filter-bar') === barNode);
ok('v13搜索：局部刷新确实换了列表内容',
   cards().length > 0 && cards().length < D.pcNew.length,
   `${cards().length} / ${D.pcNew.length}`);
kwNode.value = '';                       /* 复位，别影响后面的断言 */
kwNode.dispatchEvent(new win.Event('input', { bubbles: true }));
/* ★v17：判据从「= D.pcNew.length」改成「= D.pcNew.length − 被合并的条数」。
   来由：pcNew 页现在做**跨源同款合并**（同一款游戏只出一条），屏幕上条数必然少于数据条数。
   ⚠️ 这不是「放宽断言」—— 合并数是从 `libMergeIndex()` 现算的：
      合并若失效（不合并）卡片会多出 mgN 张 ⇒ 仍然变红。 */
const mgNall = win.eval('libMergeIndex(D.pcNew).skip.size');
ok('v13搜索：清空搜索词后结果全量恢复（★v17 减去跨源同款合并数）',
   cards().length === D.pcNew.length - mgNall,
   `${cards().length} vs ${D.pcNew.length} − ${mgNall}`);
ok('v13搜索：旧的 focus + setSelectionRange hack 已整段删除',
   !/setSelectionRange/.test(code));

/* ---- 11c. 响应式断点（此前全表 @media 数量 = 0）---- */
const bpNums = [...code.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
ok('v13响应式：补了 3 档 max-width 断点', bpNums.length === 3, bpNums.join('/'));
ok('v13响应式：所有断点都 < 1424（默认窗口 1424×861 的观感必须与 v12 一致）',
   bpNums.length === 3 && bpNums.every(b => b < 1424), bpNums.join('/'));
ok('v13响应式：PC 精选块基础规则仍是固定 5 列（既有断言口径不变）',
   /\.hseclist\.pc\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/.test(code));
ok('v13响应式：窄窗下 PC 精选块切 2 列（10 张 = 2×5，仍不留孤行）',
   /\.hseclist\.pc\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(code));
ok('v13响应式：窄窗最窄一档手游精选块切 1 列（6 张 = 1×6，不留孤行）',
   /\.hseclist\.mb\{grid-template-columns:minmax\(0,1fr\)\}/.test(code));

/* ---- 11d. ★v15 本机三页（游戏库 / 我的游戏 / 下载管理）----
   口径出处（用户 2026-10-16 原话）：
     ·「为什么把我工作站给并到了 exe」→ **移除** v14 的 5 个外部跳转入口
     ·「最好是增加一个我的游戏，可以进行扫盘获取到游戏的启动器，并对应进行匹配」
     ·「最好增加一个功能，下载管理进行统一管理」
     ·「其次游戏还是 demo，数量很少并未实时同步」
   ★ 断言口径说明（防下轮误判）：
     v14 的 5 条 `data-hub` 断言是**随该模块下线而退场**的 —— 模块删了，断言自然没了，
     不是「把失败的断言删掉让总数好看」。同时补了下面这组新断言顶上。
   ★ 离线纪律：jsdom 里既没有 `window.__SHELL__` 也没有本机服务 ⇒ 三页都必须优雅降级，
     给出**明确原因**，不留「点了没反应」的死按钮。 */

/* ① 外部跳转入口必须彻底消失（源码级，不只看 DOM） */
ok('v15本机：v14 的 #hubNav 分组已从源码整块移除', !/id="hubNav"/.test(code));
ok('v15本机：bindHubNav 函数已整段移除', !/function bindHubNav/.test(code));
ok('v15本机：侧栏不再有任何 data-hub 外部跳转入口', $$('.nav [data-hub]').length === 0,
   $$('.nav [data-hub]').length);

/* ② 三个新页进了侧栏、进了 TABS、也进了 render 的早退分派 */
const libA = $$('.nav a[data-tab]').map(a => a.dataset.tab);
ok('v15本机：侧栏出现「游戏库 / 我的游戏 / 下载管理」三项',
   ['lib', 'myGames', 'downloads'].every(k => libA.includes(k)), libA.join(','));
ok('v15本机：render() 对三页各有一条早退分支（走独立渲染函数）',
   ['lib', 'myGames', 'downloads'].every(k =>
     new RegExp(`if\\(cur==='${k}'\\)\\{[^}]*return;\\s*\\}`).test(code)));
ok('v15本机：三个独立渲染函数都已定义',
   ['renderLib', 'renderMyGames', 'renderDownloads'].every(f => new RegExp(`function ${f}\\(`).test(code)));
ok('v15本机：三个早退分支在 render() 内、且在「首页」分支之前',
   code.indexOf("if(cur==='lib')") > code.indexOf('function render(') &&
   code.indexOf("if(cur==='lib')") < code.indexOf("if(cur==='home')"));

/* ③ 壳能力探测是**一次性的**（HAS_SHELL 常量），页面里不再散着 window.__SHELL__ 读取 */
ok('v15本机：壳桥只探测一次（const SHELL / HAS_SHELL）',
   /const SHELL = [\s\S]{0,220}?window\.__SHELL__/.test(code) &&
   /const HAS_SHELL = !!SHELL;/.test(code));
/* ★ 探测语句本身跨两行、且句内引用了 3 次 window.__SHELL__
   （typeof 判空 / typeof 取方法 / 三元取用）⇒ 既不能数总次数，也不能数行数。
   正确判法：把 `const SHELL = …;` 这一整句摘掉，剩下的代码里不应再出现 window.__SHELL__。 */
const shellDecl = code.match(/const SHELL = \([\s\S]{0,300}?null;/);
const restCode = code.replace(shellDecl ? shellDecl[0] : '\u0000', '');
ok('v15本机：读取 window.__SHELL__ 只出现在壳桥探测那一句里（别处一律走 SHELL/HAS_SHELL）',
   !!shellDecl && !/window\.__SHELL__/.test(restCode),
   (restCode.match(/window\.__SHELL__/g) || []).length);

/* ④ 离线态的三页空态：必须给「原因」，且不能出现假按钮 */
go('myGames');
ok('v15本机：离线态「我的游戏」明说扫盘需要桌面版',
   /扫盘需要桌面版/.test(main().innerHTML));
ok('v15本机：离线态「我的游戏」不给「开始扫描」按钮（死按钮）',
   !/id="mgscan"/.test(main().innerHTML));
go('downloads');
ok('v15本机：离线态「下载管理」给出空态说明',
   /还没有下载任务/.test(main().innerHTML));
go('lib');
ok('v15本机：离线态「游戏库」明说需要本机服务',
   /需要本机服务/.test(main().innerHTML));
ok('v15本机：离线态「游戏库」仍给了搜索框与排序（离线也能操作，不是死页）',
   !!$('#libq') && $$('[data-lsort]').length === 5, $$('[data-lsort]').length);

/* ④b. 我的游戏：默认视图与名字闸门
   —— 实测扫盘会捞到大量非游戏快捷方式（本机 74 条候选里仅 7 款真游戏）：
      7-Zip / 控制台 RAR 中文手册 / 皮肤盒子 / 设置向导 / 项目管理器 …
      ⇒ 默认只显示「匹配到资源」的，其余收在开关后面。 */
ok('v15我的游戏：默认只渲染「匹配到资源」的（showAll 开关控制）',
   /const showAll = !!LOCAL\.showAll;/.test(code) && /const list = showAll \? G : hits;/.test(code));
ok('v15我的游戏：给了「显示全部候选 N」开关（一个候选都不丢）',
   /显示全部候选/.test(code) && /id="mgtoggle"/.test(code));
ok('v15我的游戏：LOCAL 上确有 showAll 状态',
   /showAll: false,/.test(code));
ok('v15我的游戏：未匹配的行不给 data-d（不给假交互）',
   /\$\{matched \? ` data-d="myGames" data-i="\$\{idx\}"` : ''\}/.test(code));

/* ④c. 名字闸门 —— `/api/library?q=` 是模糊搜索，对任何串都会返回「最像的一条」，
   必须再比一次名字。实测确认过：真命中（Kitchen Sync: Aloha!）名字完全一致，
   而「设置向导」这类非游戏虽然也能搜出东西，但会被闸门挡掉。 */
const simName = win.eval('simName');
const normTitle = win.eval('normTitle');
ok('v15匹配：闸门接受完全同名', simName('Kitchen Sync: Aloha!', 'Kitchen Sync: Aloha!'));
ok('v15匹配：闸门忽略大小写与空白', simName('codex lost', 'Codex Lost'));
ok('v15匹配：闸门忽略括号补充（仁王（完全版）→ 仁王）', simName('仁王 完全版', '仁王（完全版）'));
ok('v15匹配：闸门认「中文名/英文名」形式（按 / 分段）',
   simName('007 First Light', '007 初露锋芒/007 First Light'));
ok('v15匹配：闸门挡掉无关名（这是它存在的理由）',
   !simName('设置向导', '赛博朋克2077') && !simName('项目管理器', '荒野大镖客2'));
/* ★v16-D：候选从 `[0]` 一条改成 `limit=20` 一批 —— 因为要先在候选里找
   **appid 硬命中**（可能排在第 5、第 10 条），只取第一条就等于没得挑。
   闸门本身（simName）一字未改。 */
ok('v15匹配：matchLocal 确实调用了闸门',
   /hits\.find\(h => simName\(nm, h\.title\)\)/.test(code));
/* ★★ 下面两条是「收紧 simName」这件事本身的回归，**数据全部来自实拍**：
   2026-10-16 本机扫盘得到 67 条候选，旧实现（字符级 includes）报「匹配到资源 6 款」，
   逐条 dump 后发现 4 条以上是把无关快捷方式认成了游戏 —— 短名几乎总能被长名包含住。
   ⇒ 判据收紧为「整串归一化相等 / 词集完全相同」后，这 6 条必须**全部**被挡掉。 */
ok('v15匹配：闸门挡住实测的 6 条假阳性（Run→Runehaven / Paint→City Painter / QQ→EQQO …）',
   !simName('Run', 'Runehaven') && !simName('Paint', 'City Painter') &&
   !simName('QQ', 'EQQO') && !simName('Chen', 'Kitchen Sync: Aloha!') &&
   !simName('services', '汽车服务模拟器/Car Service Simulator') &&
   !simName('computer', 'Computer Shrilow/Computer Sillow'));
ok('v15匹配：换序仍算命中（词集相同，顺序无关）',
   simName('Aloha Kitchen Sync', 'Kitchen Sync: Aloha!'));
/* ★ 顶栏之外还有一处口径要守：游戏库首屏必须给 **PC 端游**（scope=pc）。
   实测上游 scope=mob 的 total 是 3,351、scope=pc 是 19,590 —— 差别巨大，
   而 UI 上的「PC 端游」高亮只说明 L.scope==='pc'，抓不到「默认值被改成 mob」。
   ★v16-A：断言随之改口径 —— `limit:60 / offset:0` 两个字段**已从 LOCAL.lib 移除**
   （页长改由 pgOf('lib').size 统一管，偏移由页码算，见 libLoad）。
   这是**随实现改动同步的断言更新**，不是迁就：scope 这个被守的值一字未动。 */
ok('v16游戏库：默认 scope=pc（首屏给 PC 端游全量，不是手游）',
   /lib: \{ items:\[\], total:0, sort:'updated', scope:'pc'/.test(code) &&
   !/lib: \{[^}]*scope:'mob'/.test(code));
/* ★ scanMyGames() 分两段：壳扫盘（本机实测 20 ms）+ 与全量库匹配（67 条 fetch，约 2 秒）。
   三个状态必须都落在**匹配之后** —— 否则会出现「scanning 已是 false、列表却还是空」的
   中间态（实测 trace = -0,-0,-0,-0,-67，整整 2 秒），按 scanning 判完成的人会误判成 0 款。 */
ok('v15本机：games/scanned/scanning 都在匹配结束后才落（消掉「已停止扫描但列表为空」的中间态）',
   /await matchLocal\(games\);[\s\S]{0,220}?LOCAL\.games = games;[\s\S]{0,140}?LOCAL\.scanned = true;[\s\S]{0,90}?LOCAL\.scanning = false;/.test(code));

/* ⑤ 下载动作的分流规则：真直链才交给壳；网盘一律走「手动转存」 */
ok('v15下载：直链判定只看 http(s) + 常见文件后缀',
   /const DL_FILE_RE = \/\^https\?:\\\/\\\/\.\+\\\.\(\[a-z0-9\|\\\.\]\+\)/.test(code.replace(/\s/g, '')) ||
   /DL_FILE_RE = \/\^https\?:/.test(code));
const isDirectFile = win.eval('isDirectFile');
ok('v15下载：isDirectFile 认 .zip/.rar/.7z/.exe',
   ['.zip', '.rar', '.7z', '.exe'].every(x => isDirectFile('https://a.com/f' + x)));
ok('v15下载：isDirectFile 不把网盘分享页当直链',
   !isDirectFile('https://pan.xunlei.com/s/abc') && !isDirectFile('https://www.jidiyouxi.com/topic/detail/191'));
ok('v15下载：无壳时登记为 manual（不假装在下载，也不报错）',
   /if\(!HAS_SHELL\)\{[\s\S]{0,120}?j\.state = 'manual';/.test(code));

/* ⑤b. ★v15 下载入口：从「跳浏览器」改成「壳内下载」
   —— v14 这里全是 `<a href target="_blank">`：点一下就把人踢到浏览器。
      用户 2026-10-16 否定的正是这个（「我需要的是全都能够通过 exe 进行直链下载」）。 */
const dlBtns = win.eval('dlBtns');
const bHtml = dlBtns('https://a.com/pack.zip', '某游戏', '存档包');
const nHtml = dlBtns('https://pan.xunlei.com/s/abc', '某游戏', '迅雷网盘');
ok('v15下载入口：真直链给「客户端下载」并带 data-dlstart', /data-dlstart="1"/.test(bHtml) && /⬇/.test(bHtml), bHtml.slice(0, 60));
ok('v15下载入口：网盘给「转存 / 复制链接」而不是假装能直下', /☁️/.test(nHtml) && !/⬇/.test(nHtml), nHtml.slice(0, 60));
ok('v15下载入口：data-dlstart 必须带值（空属性 dataset.dlstart 是 falsy ⇒ 点了没反应）',
   /data-dlstart="1"/.test(bHtml) && !/data-dlstart[ >]/.test(bHtml));
const dHtml = dlBtns('https://a.com/pack.zip', '某游戏');   /* 不传 label ⇒ 用默认「浏览器打开」 */
ok('v15下载入口：同时保留「浏览器打开」，且是次要样式 .sec（不抢推荐动作）',
   /class="sec"[^>]*>[^<]*浏览器打开[^<]*↗/.test(dHtml), dHtml.slice(-70));
ok('v15下载入口：本体 / Mod / 存档 三处都改用了 dlBtns',
   (code.match(/dlBtns\(/g) || []).length >= 4,
   (code.match(/dlBtns\(/g) || []).length);
ok('v15下载入口：.lk button 与 .lk a.sec 都有样式（否则按钮是裸的）',
   /\.dlrow \.lk button\{/.test(code) && /\.dlrow \.lk a\.sec\{/.test(code));

/* ⑥ 任务模型与状态集合完整（下载管理页按 state 决定按钮）
   ★v28：`manual` 的文案改成**按 kind 分岔**（网盘=需手动转存 / 专用链=需本机对应客户端），
     所以不能再要求「manual 后面紧跟字面量 需手动转存」。改为在 **stTxt 映射块内部**逐键校验 ——
     这才是原断言真正想守的东西（六个状态一个都不能少），也不会因为改文案再假红。 */
{
  const m = code.match(/const stTxt = \{([\s\S]{0,420}?)\}\[j\.state\]/);
  const body = m ? m[1] : '';
  const miss = ['waiting', 'running', 'done', 'fail', 'pause', 'manual'].filter(k => !new RegExp('(^|[,{\\s])' + k + ':').test(body));
  ok('v15下载：任务状态集合 = waiting/running/done/fail/pause/manual',
     !!m && miss.length === 0, m ? ('缺 ' + miss.join(',')) : '没找到 stTxt 映射');
  ok('v28：manual 文案按 kind 分岔（专用链 ≠ 转存，不能一个词盖两件事）',
     /manual:\(j\.kind === 'client' \? '需本机对应客户端' : '需手动转存'\)/.test(body), body.slice(0, 80));
}
ok('v15下载：壳推进度经 onDownload 回推，且只在下载页可见时重绘',
   /SHELL\.onDownload\(msg => \{[\s\S]{0,900}?if\(cur === 'downloads'\) renderDownloads/.test(code));
ok('v15下载：下载按钮走 document 级事件委托（只绑一次）',
   /document\.addEventListener\('click', e => \{[\s\S]{0,200}?data-dlstart/.test(code));
/* ★ manual 的成因有两类，按钮不能只给网盘那类（2026-10-16 实拍发现）：
   ① kind==='netdisk'（网盘分享页）② URL 无文件后缀 ⇒ isDirectFile() 判非直链，
   但 kind 仍是 'file'。原来只判 kind ⇒ 第二类落进 manual 后**一个按钮都没有**，
   用户既不能复制也不能重试。⇒ 复制链接必须按 state 给。 */
ok('v15下载：manual 态总是给「复制链接」（非网盘的 manual 任务原来拿不到任何操作）',
   /j\.state === 'manual' && j\.url[\s\S]{0,150}?data-dlcopy/.test(code));

/* ================= ★v28 链接四分类：网盘跳转 / 磁力交给引擎 =================
   用户 2026-10-23 口径：「网盘还是之前那样，通过跳转自己转存；
   如果获取到磁力链则可以拉起 app 那样」。
   ⇒ 磁力链**必须**进引擎，网盘分享页**必须**是跳转。
   下面这些是**行为断言**（真调函数），不是源码字符串匹配 —— 正则只能证明「写了」，
   证明不了「判对了」。 */
{
  const K = (u) => win.eval('dlKindOf(' + JSON.stringify(u) + ')');
  const cases = [
    ['magnet:?xt=urn:btih:0123456789abcdef', 'magnet'],
    ['MAGNET:?xt=urn:btih:abc', 'magnet'],
    ['https://pan.xunlei.com/s/VNxxxxx', 'netdisk'],
    ['https://www.jidiyouxi.com/topic/detail/12345', 'netdisk'],
    ['https://patch1.ventacorius.com/2024/ALI213-2077.rar', 'file'],
    ['https://a.com/x.7z?token=1', 'file'],
    ['thunder://QUFodHRwOi8vZXhhbXBsZS5jb20vYS56aXA=', 'client'],
    ['ed2k://|file|a.rar|1024|ABCD|/', 'client'],
    ['', 'netdisk'],
  ];
  const bad = cases.filter(([u, want]) => K(u) !== want);
  ok('v28：dlKindOf 四分类判对（磁力 / 网盘页 / 真直链 / 专用链）',
     bad.length === 0, bad.map(([u, w]) => u.slice(0, 26) + '→' + K(u) + '(want ' + w + ')').join(' | ') || '9 条全对');

  /* ★★ 反证型：磁力链**不许**再落进网盘分支。
     判据用「startDownload 里磁力分流必须出现在 dlJobAdd 之前」——
     顺序反过来的话，磁力会先被登记成一条任务，然后才被判成磁力，
     结果是「下载管理里多一条永远在等待的网盘任务」。这是本轮修的正是它。 */
  const iMag = code.indexOf("if (kd === 'magnet' && HAS_SHELL");
  const iAdd = code.indexOf('const j = dlJobAdd(o);', code.indexOf('function startDownload'));
  ok('v28：startDownload 里磁力分流在登记任务**之前**（否则会多出一条网盘任务）',
     iMag > -1 && iAdd > -1 && iMag < iAdd, 'magnet@' + iMag + ' / add@' + iAdd);
  ok('v28：磁力分流真的交给 startMagnet（不是自己再写一份下载逻辑）',
     /if \(kd === 'magnet' && HAS_SHELL[\s\S]{0,120}?return startMagnet\(/.test(code));

  /* 磁力按钮：网页版没有任何可点的次链接（`magnet:` 当 href 交出去是死链） */
  const bMag = win.eval('dlBtns("magnet:?xt=urn:btih:00","测试磁力")');
  ok('v28：磁力按钮走 data-mgcopy（网页版只复制，不假装能下）',
     /data-mgcopy="1"/.test(bMag) && /复制磁力链/.test(bMag));
  ok('v28：磁力按钮不给 target=_blank 次链接（magnet: 当 href 是死链）',
     !/target="_blank"/.test(bMag), bMag.slice(0, 90));

  /* 网盘按钮：文案必须写「转存」，且原文保留「浏览器打开」出口 */
  const bNd = win.eval('dlBtns("https://pan.xunlei.com/s/VNx","测试网盘","网盘")');
  ok('v28：网盘按钮文案含「转存」，且保留浏览器打开出口',
     /转存/.test(bNd) && /target="_blank"/.test(bNd), bNd.slice(0, 90));

  /* 专用链：只给复制，且文案点名是哪种链 —— 不能和网盘共用一套词 */
  const bCl = win.eval('dlBtns("thunder://QUFodHRw","测试","下载")');
  ok('v28：迅雷专用链只给「复制」，且明说是迅雷链',
     /data-mgcopy="1"/.test(bCl) && /迅雷链/.test(bCl) && !/target="_blank"/.test(bCl));

  /* 存档页的 eD2K 原来是个**点了没反应的死标签**（<a class="na">eD2K</a>） */
  ok('v28：存档的 eD2K 改成真能复制的按钮（原来是死标签）',
     !/<a class="na">eD2K<\/a>/.test(code) && /dlBtns\(f\.ed2k/.test(code));

  /* ===== ★v28 实拍抓出来的真 bug：进度回推把 url 覆盖成空 =====
     磁力任务在「取元数据」阶段 aria2 的 `files[0].uris` 是空的 ⇒ 直接 Object.assign
     会把页面存的 magnet 地址覆盖成 ''，于是「复制链接 / 重试 / 重启后对账」全部失效。
     实测证据：探针任务重开后 `{"url":"","kind":"magnet","state":"fail"}`。 */
  ok('v28：进度回推不覆盖空的 url/name/dest（磁力取元数据阶段 uris 为空）',
     /for\(const k of \['url', 'name', 'dest'\]\)\{ if\(!patch\[k\]\) delete patch\[k\]; \}/.test(code));
  /* 对账先按 gid 认 —— 磁力任务 url 为空时，只有 gid 能把它和引擎里那条对上，
     否则「重启后活着的任务被判成不在引擎中」。 */
  ok('v28：对账先按 gid 匹配、再退 url（磁力重启后 url 为空）',
     /byGid\.get\(String\(j\.gid\)\)\) \|\| byUrl\.get/.test(code));
}

/* ⑦ 实时层：PC 侧六路并发拉取，缺一不影响其它（各自回落快照） */
ok('v15实时：refreshLive 一次并发拉 6 个实时接口',
   /Promise\.all\(\[[\s\S]{0,700}?\/api\/library\/browse[\s\S]{0,300}?\/api\/mods\/list[\s\S]{0,300}?\/api\/mobilehub\/list/.test(code));
/* ★v16-G 口径微调（**守的语义一字未变**）：原来这条只要求「探不到服务就 return」。
   现在离线分支里多写了一句侧栏常驻状态（`navSet('内置快照 · 未连本机库', false)`）——
   仍然满足「不报错、不空白」，而且要求更严了一点：
   **顶栏与侧栏两处状态必须同时如实**（本轮 ① 的教训就是「两处口径打架」）。 */
ok('v15实时：探不到服务就静默保持快照（不报错、不空白；★v16-G 起侧栏同步写成「离线」）',
   /const base = await dlBoot\(\)\.catch\(\(\)=>null\);[\s\S]{0,340}?if\(!base\)\{[\s\S]{0,260}?navSet\(/.test(code)
   && /if\(!base\)\{[\s\S]{0,260}?return;/.test(code));
ok('v15实时：上游形状经 livePC/liveMOD/liveTR/liveMH 适配成 demo 卡片形状',
   ['livePC', 'liveMOD', 'liveTR', 'liveMH'].every(f => new RegExp(`function ${f}\\(a\\)\\{`).test(code)));
ok('v15实时：size2gb 与 _build_data.py 同规则（只认 MB/GB，无单位返 0）',
   win.eval('size2gb')('640MB') === 640 / 1024 && win.eval('size2gb')('1.7GB') === 1.7 &&
   win.eval('size2gb')('—') === 0);
/* ★ 上游 limit 上限实测是 100（传 300/500 都只回 100 条，而 total 照常报 19,590）
   ⇒ 「PC 新游/热游各 300 条」必须靠 offset 翻 3 页拿到，不是把 limit 写大。
   这条守的就是「翻页」本身：把 pages 改回 1 或把步长写死，实时覆盖会掉回 100 条。 */
ok('v15实时：livePage 靠 offset 翻页取满 300（limit 上限 100 ⇒ 必须翻 3 页）',
   /const LIVE_PAGE = 100;/.test(code) &&
   /async function livePage\(path, pages\)\{[\s\S]{0,400}?path \+ '&offset=' \+ \(i \* LIVE_PAGE\)/.test(code) &&
   /livePage\('\/api\/library\/browse\?scope=pc&sort=updated&limit=100', 3\)/.test(code));
/* ★ 侧栏「游戏库」的计数 = 接口报的 total（19,590）。写在 refreshLive 里一次性带回来，
   省掉「点进游戏库页才有数字」的空窗 —— 否则首屏这一格永远是「—」。 */
ok('v15计数：refreshLive 把上游报的 total 写进 D.libTotal（侧栏「游戏库」首屏就有数）',
   /if\(pNew\.total\) D\.libTotal = pNew\.total;/.test(code));
/* ★ 顶栏那一行必须**常驻**实时态。原实现走 svcFlash —— 闪 4 秒就还原成
   「数据快照 · 2026-10-15 18:25」，于是**常驻**文案反而在说「这是旧数据」，
   正好踩中用户本轮「数量很少并未实时同步」的痛点。⇒ 改成 svcPin 常驻。 */
/* ★ 顶栏那一行必须**常驻**实时态。
   ★v16-A 口径变更：可见文案里**不再出现任何数字**（用户 ① 口径「不显示数量，避免出问题」）。
   v15 这里写的是「已载 1520 条（库共 19590 款）」—— 与侧栏「游戏库 19590」并列，
   三处数字口径不同，很容易被读成「库变小了」。
   ⇒ 现在可见文案只有「实时库已接入」这个**状态**，条数退到 title（tooltip）。
   这条断言同时守两件事：① svcPin 还在；② 可见文案里**没有数字**。 */
ok('v16实时：顶栏实时态走 svcPin 常驻，且可见文案**不含数字**（数字退到 title）',
   /function svcPin\(html, title\)\{/.test(code) &&
   /svcPin\('实时库已接入',/.test(code) &&
   /库共 ' \+ D\.libTotal \+ ' 款/.test(code) &&       /* 数字仍在 → 但只在 title 里 */
   !/svcPin\('实时库已接入 · /.test(code) &&           /* 可见文案后面不许再跟「 · 数字」 */
   !/svcFlash\('实时库已接入/.test(code));
ok('v15实时：svcFlash 保留（「数据已更新」这类临时提示还要用它）',
   /function svcFlash\(msg\)\{/.test(code) && /svcFlash\('数据已更新 · '/.test(code));
/* refreshFromRemote() 与 refreshLive() 是并发的：前者先 flash 会记住旧文案并起 4 秒定时器，
   后者随后 pin ⇒ 定时器到点会把常驻实时态**覆盖回快照**。token 就是挡这个的。 */
ok('v15实时：svcFlash 的还原带 token（挡掉「先 flash 后 pin」覆盖实时态）',
   /const tok = \+\+svcTok;/.test(code) && /if\(tok !== svcTok\) return;/.test(code));
const svcEl = doc.querySelector('.svc span');
const svcOld = svcEl.innerHTML;
win.eval("svcPin('实时库已接入 · 测试')");
ok('v15实时：svcPin 立刻改写顶栏那一行（同步生效，不是等 4 秒）',
   /实时库已接入/.test(svcEl.textContent), svcEl.textContent.slice(0, 40));
svcEl.innerHTML = svcOld;                 /* 还原 DOM，免得影响后面的断言 */
win.eval('svcBase = null; svcTok++;');

/* ⑧ 侧栏计数：三个新项由 refreshCounts 统一维护（首屏与实时刷新共用一份实现） */
ok('v15计数：refreshCounts 里补了 c-lib / c-myGames / c-downloads',
   /c-lib/.test(code) && /c-myGames/.test(code) && /c-downloads/.test(code));
ok('v15计数：三个计数元素在侧栏真实存在',
   !!doc.getElementById('c-lib') && !!doc.getElementById('c-myGames') && !!doc.getElementById('c-downloads'));
/* ★ 本仓 index.html 是 CRLF，且 code 已剥掉注释 ⇒ 断言里一律不硬写 \n，
   用 \s* 跨行/跨空格匹配（这一条最初写成 refreshCounts();\nrefreshFromRemote(); 直接挂掉）。 */
ok('v15计数：启动序列里 refreshCounts 先于 refreshLive（首屏计数不等网络）',
   /refreshCounts\(\);\s*refreshFromRemote\(\);/.test(code) &&
   code.indexOf('refreshFromRemote();') < code.indexOf('refreshLive();'));

/* ★★ 侧栏「本机」三页必须**真的能切过去** —— 这条是反证 M36 暴露的盲区。
   背景：`goTab()` 第一句是 `if(!TABS[tab]) return;`，TABS 里少一项时点侧栏会**静默不切页**。
   为什么原来抓不到：侧栏导航是**静态 HTML**（`<a data-tab="downloads">` 硬编码在 1065 行），
   三个 `#c-*` 计数元素也是硬编码的 —— 所以「计数元素存在」那条断言删掉 TABS 照样绿。
   ⇒ 必须真调一次 `goTab` 看 `cur` 有没有被守卫拦掉，静态查源码抓不到这个联动。 */
const tryTab = t => { try { win.eval(`goTab('${t}')`); } catch (e) { return 'ERR'; } return win.eval('cur'); };
const tb1 = tryTab('lib'), tb2 = tryTab('myGames'), tb3 = tryTab('downloads');
ok('v15本机：侧栏三页都能真的切过去（goTab 的 TABS 守卫不得拦掉任何一页）',
   tb1 === 'lib' && tb2 === 'myGames' && tb3 === 'downloads', `${tb1}/${tb2}/${tb3}`);
tryTab('home');   /* 还原落地页，免得影响后面的断言 */

/* ⑩ ★v15 桌面客户端形态（回答「exe 更像是一个网站」）
   ★ 核心口径：**只在壳里生效**。线上 demo（浏览器）保持网页形态 ——
     网页形态对网页是对的，也不该让线上 demo 变成「假桌面应用」。
     所以全部收在 `html.has-shell` 作用域下，class 由 JS 在探到壳桥时才挂。 */
ok('v15形态：has-shell 只在探测到壳桥时才挂',
   /if\(HAS_SHELL\) document\.documentElement\.classList\.add\('has-shell'\);/.test(code));
ok('v15形态：离线态（jsdom 无壳）确实没挂 has-shell ⇒ 网页形态不变',
   !doc.documentElement.classList.contains('has-shell'));
ok('v15形态：自定义标题栏（整条可拖拽 + 给系统窗口按钮留位）',
   /html\.has-shell \.topbar\{-webkit-app-region:drag;height:48px/.test(code));
ok('v15形态：详情改右侧抽屉（flex-end + 满高 + 从右滑入）',
   /html\.has-shell \.mask\{[\s\S]{0,120}?justify-content:flex-end/.test(code) &&
   /html\.has-shell \.dlg\{[\s\S]{0,200}?height:100%/.test(code) &&
   /@keyframes slidein/.test(code));
/* ★v20 口径变更（**有意**，不是改断言迁就实现）：
   滚动条 10px → **6px**、并补出 track —— 对齐迅雷游戏助手的实测值
   （track 5% / thumb 12% / 圆角 36px·3px）。
   颜色仍**必须**从 token 推导（`color-mix(... var(--txt) ...)`），
   这样深色/浅色两套主题自动跟随、不写死色值 —— 这条原始诉求没有放松。 */
ok('v20形态：细滚动条 **6px**（对齐迅雷实测值）',
   /::-webkit-scrollbar\{width:6px;height:6px\}/.test(code));
ok('v20形态：滚动条颜色走 token（`color-mix` 从 `--txt` 推导 ⇒ 两套主题自动跟随，不写死色值）',
   /::-webkit-scrollbar-thumb\{[\s\S]{0,160}?background:color-mix\(in srgb, var\(--txt\)/.test(code)
   && /::-webkit-scrollbar-track\{[\s\S]{0,160}?color-mix\(in srgb, var\(--txt\)/.test(code));
ok('v15形态：窗口按钮配色随主题同步（观察 data-theme，不去改 applyTheme）',
   /MutationObserver\(syncTitlebar\)[\s\S]{0,140}?attributeFilter: \['data-theme'\]/.test(code));
ok('v15形态：applyTheme 保持零侵入（没有直接读写 window.__SHELL__）',
   /function applyTheme\(t\)\{[\s\S]{0,420}?localStorage\.setItem\('gi-theme', t\);[\s\S]{0,60}?\}/.test(code));

/* ⑨b 反证基建本身：被测文件必须可由环境变量指定，
   否则打坏点只能就地改写 index.html —— 中断即污染工作区（实测踩过）。 */
ok('测试基建：被测文件支持 T_DEMO_HTML 覆盖（反证才敢打坏点）',
   /process\.env\.T_DEMO_HTML \|\| 'index\.html'/.test(fs.readFileSync(path.join(DIR, '_t_demo.js'), 'utf8')));
ok('测试基建：反证脚本把打坏版写到 _mut.html，不停留在 index.html',
   /MUT_HTML = os\.path\.join\(DIR, '_mut\.html'\)/.test(fs.readFileSync(path.join(DIR, '_counterproof.py'), 'utf8')));

/* ⑨ 新样式必须存在（否则三页是裸的）；且只用既有 token、不新造色值 */
['phead', 'pbadge', 'psub', 'pbar', 'pin', 'seg', 'pbtn', 'pmore',
 'mglist', 'mgrow', 'mthumb', 'mbd', 'mtt', 'mmt', 'msrc', 'mact', 'pmiss',
 'dllist', 'dljob', 'jhd', 'jic', 'jnm', 'jst', 'jbar', 'jmt']
  .forEach(c => ok(`v15样式：.${c} 有定义`, new RegExp(`\\.${c}[\\s,{.:\\[]`).test(code)));
ok('v15样式：本段样式只引用既有 token（不出现裸 #rrggbb 十六进制色值）',
   !/\.(phead|pbadge|psub|pbar|pin|seg|pbtn|pmore|mglist|mgrow|mthumb|mbd|mtt|mmt|msrc|mact|pmiss|dllist|dljob|jhd|jic|jnm|jst|jbar|jmt)[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/.test(code));

/* ---- 11e. ★v14 详情弹窗的下载区块（离线态必须整块消失）---- */
ok('v14下载：详情弹窗里插入了 #dlBlock 占位块',
   /<div class="dblock" id="dlBlock">/.test(code));
ok('v14下载：探测失败时 #dlBlock 被 remove（不留死按钮）',
   /if \(!base\) \{ box\.remove\(\); return; \}/.test(code));
/* ★ 必须是 closeDetail 函数体里的那一行。
   反证 M37 第一次跑**没命中**，暴露了这行原来是 `/dlSt = null;/` —— 太宽：
   文件上方那句声明 `let dlSt = null;` 也匹配得上，于是把赋值删掉断言照样绿。
   ⇒ 收紧成「函数体内 600 字符以内」，把声明行排除在外。 */
ok('v14下载：closeDetail 会作废会话 dlSt（防上一款游戏的清单串台）',
   /function closeDetail\(\)\{[\s\S]{0,600}?dlSt = null;/.test(code));
ok('v14下载：四个页签口径 = 本体/Mod/修改器/存档',
   /const DL_TABS = \[[\s\S]{0,300}?'body'[\s\S]{0,200}?'mod'[\s\S]{0,200}?'modifier'[\s\S]{0,200}?'save'/.test(code));

/* ================= 12. ★v16-A 分页 + 「不显示数量」 =================
   用户 2026-10-16 ①：「不显示数量，避免出问题（一页显示 50 个，
   设置多页类似 [截图] 这样的页面跳转功能）」。

   ★ 这一节的断言分三组：
     (a) 口径：侧栏 / 页头**不许**再出现数字，条数只由分页条给一次；
     (b) 组件：分页条的六件套（共 N 条 / 条每页 / 上页 / 页码 / 下页 / 前往）都在；
     (c) 行为：**真点**下页 → 页码变、第 1 张卡换成第 51 条（不是换了个壳但数据没动）。 */
ok('v16分页：页长档位 = 20/50/100，默认 50', win.eval('PAGE_SIZES').join(',') === '20,50,100'
   && win.eval('PG_DEF') === 50, win.eval('PAGE_SIZES').join(',') + ' / ' + win.eval('PG_DEF'));
ok('v16分页：侧栏计数用 CSS 隐藏（元素保留作内部状态，但不上屏）',
   /\.nav \.cnt\{display:none\}/.test(code));
/* 页头**不再**出现「共 N 款 · 已载 M」这种自相矛盾的数字对 */
ok('v16分页：游戏库页头不再报数字（原「共 19,590 款 · 已载 300」已移除）',
   !/共 <b>\$\{L\.total\.toLocaleString\(\)\}<\/b> 款 · 已载/.test(code) &&
   !/在\$\{L\.total \? ' ' \+ L\.total\.toLocaleString\(\) \+ ' ' : ''\}款游戏里搜索/.test(code));
ok('v16分页：「我的游戏」页头不再报数字（原「候选 67 条 · 匹配到资源 6 款」已移除）',
   !/候选 <b>\$\{G\.length\}<\/b> 条 · 匹配到资源/.test(code));
ok('v16分页：「下载管理」页头不再报数字（原「共 12 个任务」已移除）',
   !/共 <b>\$\{DL_JOBS\.length\}<\/b> 个任务/.test(code));

/* ---- (b) 组件 ---- */
win.eval('goTab("pcNew")'); pgReset('pcNew');   /* 复位成默认页长，才验得到分页 */
ok('v16分页：列表页渲染出分页条 .pager', !!$('#main .pager'));
const pagerTxt = ($('#main .pager') || {}).textContent || '';
ok('v16分页：分页条含「共 N 条」', /共\s*\d+\s*条/.test(pagerTxt), pagerTxt.slice(0, 46));
ok('v16分页：分页条含「条/页」选择器', !!$('#main .pager [data-pgsize]')
   && /50条\/页/.test($('#main .pager [data-pgsize]').textContent), $('#main .pager [data-pgsize]') && $('#main .pager [data-pgsize]').textContent);
ok('v16分页：分页条含「上页 / 下页」', [...$$('#main .pager [data-pg]')].some(b => b.textContent.trim() === '上页')
   && [...$$('#main .pager [data-pg]')].some(b => b.textContent.trim() === '下页'));
ok('v16分页：分页条含「前往 [ ] 页」', !!$('#main .pager [data-pgjump]')
   && /前往/.test(pagerTxt) && /页/.test(pagerTxt));
ok('v16分页：首屏第 1 页高亮、上页 disabled（边界正确）',
   ($('#main .pager .pg.on') || {}).textContent === '1'
   && [...$$('#main .pager [data-pg]')].find(b => b.textContent.trim() === '上页').disabled === true);

/* ---- (c) 行为：真点下页 ---- */
const p1n = cards().length;
/* ★v17：屏幕上条数 = **页内原始条数 − 页内被合并的条数**（跨源同款只出一条）。
   两条判据分开验，谁也不掩盖谁：① 不超发（原始条数 ≤ 页长）；② 合并确实生效（差 = 合并数）。
   合并逻辑若失效，p1n 会等于 p1raw ⇒ 第二条变红。 */
const p1raw = win.eval('curList.length');
const p1mg = win.eval('libMergeIndex(curList).skip.size');
const first1 = ($('#main .card .ctitle') || {}).textContent || '';
const firstAll1 = (D.pcNew[0].title || '');
const nextBtn = [...$$('#main .pager [data-pg]')].find(b => b.textContent.trim() === '下页');
nextBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v16分页：点「下页」页码变 2', ($('#main .pager .pg.on') || {}).textContent === '2',
   ($('#main .pager .pg.on') || {}).textContent);
ok('v16分页：第 1 页不超发（原始条数 ≤ 页长）',
   p1raw <= Math.min(win.eval('PG_DEF'), D.pcNew.length), `${p1raw} ≤ ${Math.min(win.eval('PG_DEF'), D.pcNew.length)}`);
ok('v16分页：第 1 页渲染条数 = 原始条数 − 页内合并数（★v17 跨源同款只出一条）',
   p1n === p1raw - p1mg, `${p1n} = ${p1raw} − ${p1mg}`);
const first2 = ($('#main .card .ctitle') || {}).textContent || '';
ok('v16分页：第 2 页第 1 张 = 数据里的第 51 条（分页真的换了数据，不是只换页码）',
   first2 !== first1 && first1.indexOf(String(firstAll1).split('/')[0]) === 0,
   `${first1} → ${first2}`);
/* ★ 点第 2 页第 1 张卡 → 弹窗必须开**第 51 条**，不是第 1 条。
   这条守的是 curList 必须是「当前页」而不是整表（否则翻页后点卡片全开错）。 */
win.eval("openDetail('pcNew', 0)");
const dlTitle2 = ($('#dlg .dhtitle h2') || {}).textContent || '';
ok('v16分页：翻到第 2 页后点第 1 张 → 弹窗开的是第 51 条（curList 跟页走）',
   dlTitle2.indexOf(npOf(D.pcNew[50].title).main) >= 0, `弹窗=${dlTitle2} 期望含=${npOf(D.pcNew[50].title).main}`);
win.eval('closeDetail()');

/* 换页长必须回第 1 页 */
const sel = $('#main .pager [data-pgsize]');
sel.value = '20';
sel.dispatchEvent(new win.Event('change', { bubbles: true }));
ok('v16分页：换页长（50→20）后自动回第 1 页',
   ($('#main .pager .pg.on') || {}).textContent === '1' && cards().length === Math.min(20, D.pcNew.length),
   `${($('#main .pager .pg.on') || {}).textContent} / ${cards().length}`);

/* 「前往」跳转 */
const jp = $('#main .pager [data-pgjump]');
const lastPage = win.eval('Math.ceil(D.pcNew.length / pgOf("pcNew").size)');
jp.value = String(lastPage);
jp.dispatchEvent(new win.Event('change', { bubbles: true }));
ok('v16分页：「前往末页」跳到末页，且末页「下页」disabled（边界正确）',
   Number(($('#main .pager .pg.on') || {}).textContent) === Number(lastPage)
   && [...$$('#main .pager [data-pg]')].find(b => b.textContent.trim() === '下页').disabled === true,
   `末页=${lastPage} 当前=${($('#main .pager .pg.on') || {}).textContent}`);

/* 越界纠正：把 page 直接设成 999 再渲染，必须被夹到末页而不是渲染空列表 */
win.eval('pgOf("pcNew").page = 999; render();');
ok('v16分页：页码越界会被夹回末页（不会渲染成空列表）',
   Number(($('#main .pager .pg.on') || {}).textContent) === Number(lastPage),
   ($('#main .pager .pg.on') || {}).textContent);

/* 搜索 / 筛选必须回第 1 页 */
go('pcNew');                                    /* 这里会把页长拉到极大，先复位 */
pgReset('pcNew');
const pg2 = [...$$('#main .pager [data-pg]')].find(b => b.textContent.trim() === '下页');
if (pg2) pg2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const jidiBtn2 = $$('#main .tg').find(b => b.textContent.trim() === '机地');
if (jidiBtn2) jidiBtn2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
ok('v16分页：一改筛选就回第 1 页（否则会停在对新结果集无意义的页码上）',
   ($('#main .pager .pg.on') || {}).textContent === '1',
   ($('#main .pager .pg.on') || {}).textContent);

/* 分页条必须随 #listbox 一起更新（搜索只换 listbox 时最容易漏掉它） */
ok('v16分页：refreshList 会同步替换分页条（否则条上的「共 N 条」会停在旧结果）',
   /const old = main\.querySelector\('\.pager'\);/.test(code) &&
   /old\.outerHTML = sec\.pager;/.test(code));

/* 「加载更多」必须整块下线（与页码跳转是两套互斥心智） */
ok('v16分页：原「加载更多」按钮已下线（没有 #libmore）',
   !/id="libmore"/.test(code) && !/function libLoad\(reset\)/.test(code));

/* 游戏库：真·服务端分页（limit/offset 由页码算） */
ok('v16分页：游戏库走服务端分页（offset 由页码算，不再是「已载 + limit」累加）',
   /const off = \(p\.page - 1\) \* size;/.test(code) &&
   /limit=\$\{size\}&offset=\$\{off\}/.test(code));
/* 搜索的「总量」必须取 count 而不是 total（实测 total 是整库 19,590，会让搜索看起来没生效） */
ok('v16分页：游戏库搜索用 count 当总量，不用 total（total 是整库量）',
   /L\.total = L\.q \? \(Number\(j\.count\) \|\| 0\) : \(Number\(j\.total\) \|\| L\.items\.length\);/.test(code));

/* 实时 Tab 的「按需扩容」：翻到已加载范围外要能补货 */
ok('v16分页：实时 5 Tab 有按需扩容（pgEnsure + LIVE_SRC 映射齐 5 项）',
   ['pcNew', 'pcHot', 'pcMod', 'pcTrainer', 'mPlay'].every(k => new RegExp(`\\b${k}:`).test(code.split('const LIVE_SRC')[1] || '')) &&
   /async function pgEnsure\(tab\)/.test(code));
/* 分页条的「共 N 条」在无筛选时用上游总量，有筛选时用命中数 */
ok('v16分页：pgTotal 无筛选时取上游总量、有筛选时取命中数',
   /function pgTotal\(tab, filtered, hasCond\)\{[\s\S]{0,220}?if\(hasCond\) return filtered;/.test(code));

/* ================= 13. ★v16-B 全局搜索弹窗 =================
   用户 2026-10-16 ②：「补充全局搜索入口弹窗，且搜索后也是弹窗显示」。

   ★ 这一节必须是 **async** 的（searchRun 要走 dlBoot + 可能的 fetch），
     所以把「打印汇总 + process.exit」也一起挪进 async 尾函数里 ——
     否则汇总会在断言跑完之前先打印并退出（静默丢掉整节结果）。 */
(async function tail(){
  ok('v16搜索：顶栏有全局搜索入口 #searchBtn（Ctrl+K 等效）',
     !!doc.getElementById('searchBtn') && /全局搜索（Ctrl\+K）/.test(doc.getElementById('searchBtn').outerHTML));
  ok('v16搜索：搜索弹窗结构齐（遮罩/面板/输入框/结果区/分页区）',
     !!doc.getElementById('smask') && !!doc.querySelector('#smask .spanel')
     && !!doc.getElementById('sq') && !!doc.getElementById('slist') && !!doc.getElementById('sfoot'));
  ok('v16搜索：默认不显示（.on 才展开）', !doc.getElementById('smask').classList.contains('on'));

  win.eval('openSearch()');
  ok('v16搜索：openSearch() 打开弹窗且状态为 aria-hidden=false',
     doc.getElementById('smask').classList.contains('on')
     && doc.getElementById('smask').getAttribute('aria-hidden') === 'false');
  ok('v16搜索：打开时给出用法提示（未输入关键词）',
     /输入关键词开始搜索/.test(doc.getElementById('sstat').textContent), doc.getElementById('sstat').textContent.slice(0, 30));

  /* Ctrl+K 开关 */
  win.eval('closeSearch()');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  ok('v16搜索：Ctrl+K 能唤起弹窗', doc.getElementById('smask').classList.contains('on'));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('v16搜索：Esc 能关闭弹窗', !doc.getElementById('smask').classList.contains('on'));

  /* 真跑一次搜索（jsdom 无 fetch ⇒ 走内置快照兜底，同一套 searchScore 加权） */
  win.eval('openSearch()');
  await win.eval('searchRun("剑星", 1)');
  const rows = $$('#slist .srow');
  ok('v16搜索：搜「剑星」有结果行', rows.length > 0, `rows=${rows.length}`);
  ok('v16搜索：状态栏报「共 N 条结果」（含关键词回显）',
     /「剑星」共\s*\d+\s*条结果/.test(doc.getElementById('sstat').textContent),
     doc.getElementById('sstat').textContent.slice(0, 46));
  ok('v16搜索：结果行含封面/标题/元信息三段结构',
     !!$('#slist .srow .sc') && !!$('#slist .srow .st') && !!$('#slist .srow .sm'));
  ok('v16搜索：未连接本机服务时如实标注「只在内置快照范围内搜索」（不假装全量）',
     /只在内置快照范围内搜索/.test(doc.getElementById('sstat').textContent),
     doc.getElementById('sstat').textContent.slice(-30));

  /* 点结果 → 开详情（复用**同一段**弹窗代码 openDetailRec，不是另写一份） */
  const firstName = ($('#slist .srow .st') || {}).textContent || '';
  $('#slist .srow').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const dt = ($('#dlg .dhtitle h2') || {}).textContent || '';
  ok('v16搜索：点结果行 → 打开详情弹窗，且标题与点的那一行一致',
     !!dt && dt === firstName, `行=${firstName} 弹窗=${dt}`);
  ok('v16搜索：详情弹窗与搜索弹窗可同时存在（搜索结果不被清空，方便返回继续挑）',
     doc.getElementById('mask').classList.contains('on') && $$('#slist .srow').length === rows.length);
  win.eval('closeDetail(); closeSearch();');
  ok('v16搜索：关掉两层之后 body 可滚动（overflow 复位，不留滚动锁）',
     doc.body.style.overflow === '' || doc.body.style.overflow === null,
     doc.body.style.overflow);

  /* 空关键词 → 清空结果，不残留上一次的命中 */
  win.eval('openSearch()');
  await win.eval('searchRun("   ", 1)');
  ok('v16搜索：空关键词清空结果（不残留上一次命中）', $$('#slist .srow').length === 0);
  win.eval('closeSearch()');
  ok('v16搜索：closeSearch 复位状态（q/items/ran 全清）',
     win.eval('SSEARCH.q') === '' && win.eval('SSEARCH.items.length') === 0 && win.eval('SSEARCH.ran') === false);

  /* 搜索分页：结果超过一页时必须出分页条（与列表页同一套组件） */
  ok('v16搜索：结果超过一页时挂分页条（复用 pagerHTML/bindPager，不另写一套页码）',
     /foot\.innerHTML = \(S\.total > pgOf\('search'\)\.size\) \? pagerHTML\('search', S\.total\)/.test(code));

  /* ★v16-B 修正（2026-10-16 **成品实拍**发现）：
     带 prefill 打开时必须**真的搜**。程序化赋 `value` **不会派发 `input`**，
     而真正触发搜索的是 input 事件的 280ms 防抖 ⇒ 原实现只把字填进框、
     结果区留在空态 —— 用户第一眼就是「搜索坏了」。
     （实拍证据：`openSearch('剑星')` 后结果区仍是空态插图。）
     ⚠️ 顺序必须放在本节**末尾**：它会发起一次**未 await** 的真实搜索，
        放在前面会和后面那句 `await searchRun(...)` 叠在一起，把结果行数打散。 */
  win.eval('closeSearch()');
  win.eval("openSearch('剑星')");
  ok('v16B：带关键词打开搜索 → 立刻进入「已搜索」态（不是只把字填进框里）',
     win.eval('SSEARCH.ran') === true && win.eval('SSEARCH.q') === '剑星');
  ok('v16B：源码里 prefill 与判空成对（`prefill != null && String(prefill).trim()`）',
     /if\(prefill != null && String\(prefill\)\.trim\(\)\) searchRun\(String\(prefill\)\.trim\(\), 1\);\s*\n\s*else searchRender\(\);/.test(code));
  win.eval('closeSearch()');
  win.eval("openSearch('   ')");
  ok('v16B：全空白的 prefill 不算关键词（回到空态，不发起搜索）',
     win.eval('SSEARCH.ran') === false);
  await win.eval('searchRun("剑星", 1)');   /* 收尾：把上面那次未 await 的搜索收敛掉 */
  win.eval('closeSearch()');

  /* ================= 14. ★v16-C 自动获取 + 资源角标 + 429 口径 =================
     用户 2026-10-16 ④：「优化游戏获取，点击则自动进行获取」＋ 上一轮 ④
     「为什么有很多游戏都有本体，但 APP 点击后无本体可下载」。

     ★ 这一节守的是**三件不肯让步的事**：
       ① 资源角标必须**零请求**（用库里自带的 `res`），不能为了出角标去打源站；
       ② 429（限流）**必须**与「真的没有」分开说 —— 把限流说成「没有本体」就是撒谎；
       ③ 重试必须**同时清缓存**，否则按钮取回同一份失败结果 = 摆设。 */

  /* --- ① 资源角标：零请求、有值才出 --- */
  ok('v16C：resPills 有值才出角标（mod/trainers/saves 三项）',
     win.eval('resPills({res:{mod:5,saves:2,trainers:1}}).split("rz").length - 1') === 3,
     win.eval('resPills({res:{mod:5,saves:2,trainers:1}})'));
  ok('v16C：resPills 缺 res 字段时**不猜**（返回空串，不显示 0）',
     win.eval('resPills({})') === '' && win.eval('resPills({res:null})') === '');
  ok('v16C：resPills 遇 0 值也不出角标（0 不是「有资源」）',
     win.eval('resPills({res:{mod:0,saves:0,trainers:0}})') === '');
  ok('v16C：PC 卡片挂了 resPills（角标在**点之前**就可见）',
     /resPills\(a\)/.test(code) && /function resPills\(a\)/.test(code));
  ok('v16C：角标数据来自库里自带 res（livePC 透传，不是新抓的）',
     /res: a\.res \|\| null, resId: a\.resId \|\| ''/.test(code));
  ok('v16C：appid 已由写死空串改为透传（本机关联的硬键，见 v16-D）',
     /appid: a\.appid \? String\(a\.appid\) : ''/.test(code) && win.eval('livePC({id:1,appid:3489700}).appid') === '3489700');

  /* --- ② 429 与「真的没有」分开说 --- */
  ok('v16C：dlFetchBody 把源站 error 逐条留档（secErr）',
     /j\.secErr = errs\[0\]/.test(code));
  ok('v16C：dlFetchBody 分辨限流（429 / 限流 / rate limit）',
     /j\.rateLimited = \/429\|限流\|rate\.\?limit\/i\.test\(all\)/.test(code));
  ok('v16C：dlFetchBody 分辨临时故障（HTTP 5xx / timeout / 连接失败）',
     /j\.transient = \/HTTP\\s\*\\d\{3\}\|timeout\|超时\|ECONN\|fetch failed\|socket\/i\.test\(all\)/.test(code));
  ok('v16C：限流态明确写「不是这款游戏没有本体」（不许把限流说成没有）',
     (() => { const h = win.eval('dlTabHTML("body",{rateLimited:true,secErr:"HTTP 429 @ /topic/list",items:[]})');
              return /限流/.test(h) && /不是<\/b>这款游戏没有本体/.test(h) && /429/.test(h); })(),
     win.eval('dlTabHTML("body",{rateLimited:true,secErr:"HTTP 429 @ /topic/list",items:[]})').replace(/<[^>]+>/g, '').slice(0, 60));
  ok('v16C：需登录态说「源站要求登录 / 权限」（与限流、真没有三态各说各的）',
     /源站要求<b>登录 \/ 权限<\/b>/.test(win.eval('dlTabHTML("body",{needAuth:true,items:[]})')));
  ok('v16C：真没有态才说「没有可直接打开的网盘地址」',
     /没有可直接打开的网盘地址/.test(win.eval('dlTabHTML("body",{items:[]})')));
  ok('v16C：整体失败也有重试（原来只有一行红字，用户无可做的动作）',
     /⚠️/.test(win.eval('dlTabHTML("body",{err:"上游连接失败"})'))
     && /data-dlretryk="body"/.test(win.eval('dlTabHTML("body",{err:"上游连接失败"})')));

  /* --- ③ 自动获取可见 + 重试清缓存 --- */
  ok('v16C：dlPaint 页签数字三态（`…` 取数中 / `·` 未取到 / 数字 已就绪）',
     /st\.busy\[m\.k\] \? '…' : \(\(n === undefined \|\| n === null\) \? '·' : String\(n\)\)/.test(code));
  ok('v16C：标题右侧如实报「自动获取中 n/4」（让「自动」看得见）',
     /const cntTxt = busyN \? `自动获取中 \$\{DL_TABS\.length - busyN\}\/\$\{DL_TABS\.length\}`/.test(code));
  ok('v16C：重试按钮**同时清缓存**（否则取回同一份失败结果 = 摆设）',
     /DL_CACHE\.delete\(dlCacheKey\(dlSt, k\)\);[\s\S]{0,120}delete dlSt\.data\[k\]/.test(code));
  ok('v16C：缓存只存成功结果（失败/限流不进缓存，否则重试永远无效）',
     /if \(d && !d\.err && !\(k === 'body' && \(d\.rateLimited \|\| d\.transient\)\)\) dlCacheSet\(st, k, d\)/.test(code));
  ok('v16C：dlLoad 支持 force 绕过缓存（重试的唯一入口）',
     /async function dlLoad\(k, force\)/.test(code) && /if \(!force && st\.data\[k\] !== undefined\) return;/.test(code));

  /* --- ④ 两个「重试」不许撞在同一个选择器上 --- */
  ok('v16C：弹窗重试用 data-dlretryk、下载任务重试用 data-dlretry（刻意区分）',
     /data-dlretryk="\$\{esc\(k\)\}"/.test(code) && /data-dlretryk="body"/.test(code)
     && /data-dlretry="\$\{j\.id\}"/.test(code));
  ok('v16C：document 级委托的选择器里**没有** data-dlretryk（它由 dlPaint 自己绑）',
     !/closest\('\[data-dlstart\][^)]*data-dlretryk/.test(code));
  ok('v16C：.dlretry / .pill.rz 两条 CSS 在位',
     /\.dlretry\{margin-top:10px\}/.test(code) && /\.pill\.rz\{/.test(code));

  /* ================= 15. ★v16-D 本机游戏 ↔ 库记录 关联 =================
     用户 2026-10-16：「记得本地的游戏我需要进行能够关联，通过游戏名/游戏在steam的id等方式」。

     ★ 这一节守的三件事：
       ① **关联键**优先 Steam appid（改名字不影响），没有才退回归一化名；
       ② **落盘可复用** —— 重扫零请求套回，且**离线不猜**；
       ③ **证据可见可撤销** —— 行上要能看出「凭什么说这俩是同一个游戏」，并且能解除。 */

  /* --- ① 关联键 --- */
  ok('v16D：关联键优先用 Steam appid（改名字也不影响）',
     win.eval("linkKeyOfGame({steamId:'3489700'})") === 'sid:3489700'
     && win.eval("linkKeyOfGame({appid:123})") === 'sid:123');
  ok('v16D：没有 appid 才退回归一化名，且大小写/空白等价',
     win.eval("linkKeyOfGame({name:'剑星/Stellar Blade'}).indexOf('nm:')") === 0
     && win.eval("linkKeyOfGame({name:'Codex  Lost'}) === linkKeyOfGame({name:'codexlost'})"));
  ok('v16D：既无 id 也无名 ⇒ 空键（不写半条垃圾关联）', win.eval('linkKeyOfGame({})') === '');

  /* --- ② 落盘 / 复用 / 离线不猜 --- */
  const LINK_SID = '9990001';
  win.eval("linkSet({steamId:'" + LINK_SID + "'}, {title:'测试游戏', cover:'c.jpg', appid:" + LINK_SID + ", res:{mod:2}}, 'manual')");
  const A = JSON.parse(win.eval(
    "(function(){ var g = {steamId:'" + LINK_SID + "', name:'随便什么本机名'}; var rest = linkApply([g]);"
    + " return JSON.stringify({rest: rest.length, title: (g.hit||{}).title, via: g.via}); })()"));
  ok('v16D：关联落盘后，零请求就能套回（重扫不必再问上游）',
     A.rest === 0 && A.title === '测试游戏', JSON.stringify(A));
  ok('v16D：手动关联的 via=manual 被保留（不被下一次自动匹配改掉）', A.via === 'manual', A.via);
  const B = win.eval(
    "(function(){ var g = {steamId:'8880001', name:'从没关联过的'}; var rest = linkApply([g]);"
    + " return JSON.stringify({rest: rest.length, hit: !!g.hit}); })()");
  ok('v16D：没关联过的不会被硬套（linkApply 只认自己表里的键）',
     JSON.parse(B).rest === 1 && JSON.parse(B).hit === false, B);
  win.eval("linkDel({steamId:'" + LINK_SID + "'})");
  ok('v16D：解除关联后不再命中（且不误伤别的记录）',
     win.eval("(function(){ var g = {steamId:'" + LINK_SID + "', name:'x'}; return linkApply([g]).length; })()") === 1);
  ok('v16D：关联依据有五种可读标签（appid 必须一眼可辨）',
     win.eval('Object.keys(VIA_TXT).join(",")') === 'appid,name,manual,auto,link'
     && win.eval('VIA_TXT.appid') === '🔗 Steam ID' && win.eval('VIA_TXT.manual') === '🔗 手动');
  ok('v16D：落盘的只是快照（不把 15 个字段整条塞进 localStorage）',
     win.eval("Object.keys(linkSnap({title:'a',cover:'b',id:9,appid:7,recId:9,liveId:'x',score:8,"
              + "genre:'g',url:'u',alt:'v',res:{mod:1},genres:['z'],intro:'long',hot:99,ts:123})).join(',')")
     === 'title,cover,liveId,appid,score,genre,url,alt,res');
  ok('v16D：先读盘再套用（linkLoad 在 linkApply 之前）',
     /async function matchLocal\(games\)\{\s*\n\s*linkLoad\(\);/.test(code));
  ok('v16D：离线时只认已存关联、不猜（dlBoot 拿不到就直接返回）',
     /const rest = linkApply\(games\);[\s\S]{0,220}?if\(!base\) return;/.test(code));
  ok('v16D：自动命中同样落盘（否则每次重扫都再打一轮上游）',
     /linkSet\(it, it\.hit, via\)/.test(code));
  ok('v16D：启动时读回关联表（离线也能立刻用）',
     /resetState\('home'\);\s*\n\s*linkLoad\(\);/.test(code));

  /* --- ③ 匹配顺序：appid 硬命中在名字闸门**之前** ---
     ★ 判据用「两个 via 赋值谁在前」而不是比对那一行的文字 ——
       比对文字的话，把整段顺序调换反而会让 indexOf 返回 -1 而**假通过**。 */
  ok('v16D：候选取 limit=20（appid 硬命中可能不在第一条，只取 1 条等于没得挑）',
     /encodeURIComponent\(nm\) \+ '&limit=20'/.test(code));
  ok('v16D：**先** appid 硬命中、**再**退名字闸门（顺序不能反）',
     code.indexOf("via = 'appid'") > 0
     && code.indexOf("via = 'appid'") < code.indexOf("via = 'name'")
     && /String\(h\.appid \|\| ''\) === sid/.test(code));
  ok('v16D：行的关联下标取自 LOCAL.games（不是页内下标 —— 翻页/切换候选后下标会漂）',
     /return mgRowHTML\(x, idx, G\.indexOf\(x\)\);/.test(code));

  /* --- ④ 行模板：证据可见 / 未匹配行不给假交互 --- */
  const rowM = win.eval("mgRowHTML({name:'本机名', steamId:'3489700', source:'Steam',"
    + " hit:{title:'剑星/Stellar Blade', cover:'', appid:'3489700'}, via:'appid'}, 0, 3)");
  ok('v16D：已匹配行可点开详情 + 给「解除」按钮（用 LOCAL.games 的稳定下标）',
     /data-d="myGames" data-i="0"/.test(rowM) && /data-mgunlink="3"/.test(rowM));
  ok('v16D：已匹配行显示关联依据（appid 走高亮类，与「按名字」区分）',
     /mvia sid/.test(rowM) && /🔗 Steam ID/.test(rowM));
  ok('v16D：行上标出 Steam AppID（用户能自己核对关联对不对）',
     /Steam 3489700/.test(rowM));
  const rowU = win.eval("mgRowHTML({name:'未匹配的', source:'快捷方式'}, -1, 7)");
  ok('v16D：未匹配行**没有** data-d（不给假交互），但有「关联到库…」',
     !/data-d=/.test(rowU) && /data-mglink="7"/.test(rowU) && /未匹配到资源/.test(rowU));
  ok('v16D：未匹配行不给「解除」（没关联可解除）', !/data-mgunlink/.test(rowU));
  ok('v16D：名字关联走普通类（不冒充 appid 硬证据）',
     /mvia"/.test(win.eval("mgRowHTML({name:'n', hit:{title:'t'}, via:'name'}, 0, 1)")));

  /* --- ⑤ 一个分派点：详情 / 关联 / 加入 --- */
  ok('v16D：搜索弹窗一个分派点决定三种行为（避免加了模式忘了改某处点击）',
     /function searchPick\(a\)\{[\s\S]{0,240}?openDetailRec\(a, 'lib'\)/.test(code)
     && /if\(LOCAL\.pendingLink\)\{ linkCommit\(a\); return; \}/.test(code)
     && /if\(LOCAL\.adding\)\{ addCommit\(a\); return; \}/.test(code));
  ok('v16D：搜索行点击走 searchPick（不再直接开详情）',
     /searchPick\(SSEARCH\.items\[Number\(r\.dataset\.si\)\]\)/.test(code));
  ok('v16D：我的游戏页头有「＋ 手动加入」（不扫盘也能加游戏，用户 ③ 的一半）',
     /id="mgadd"/.test(code) && /function addGameStart\(/.test(code));
  ok('v16D：关联/解除按钮都 stopPropagation（否则点「解除」会顺带弹出下载弹窗）',
     /\[data-mglink\]'\)\.forEach\(el => el\.addEventListener\('click', e => \{\s*\n\s*e\.stopPropagation\(\)/.test(code)
     && /\[data-mgunlink\]'\)\.forEach\(el => el\.addEventListener\('click', e => \{\s*\n\s*e\.stopPropagation\(\)/.test(code));

  /* 行为验证：三种模式各真跑一次，跑完把 LOCAL 复原（别污染后续断言） */
  win.eval('window.__mgG = JSON.stringify(LOCAL.games);'
         + ' window.__mgL = JSON.stringify(LOCAL.links);'
         + ' window.__mgS = JSON.stringify([LOCAL.scanned, LOCAL.showAll]);'
         + ' window.__mgLN = Object.keys(LOCAL.links).length;');
  win.eval('LOCAL.games = []; LOCAL.links = {}; LOCAL.adding = true; LOCAL.pendingLink = null;');
  win.eval("searchPick({title:'加入测试', appid:'7770001'})");
  /* ★ 断言一律**空安全**取值（`(x||{}).f`）—— 反证把实现打坏时，
     这里必须变成「一条红」，而**不能**抛异常把整个测试崩掉：
     崩溃会让反证脚本读不到 `通过 N / M`，于是判据失效、那一轮白跑。 */
  ok('v16D：加入模式 → 点结果把游戏加进「我的游戏」并同时绑好（不依赖扫盘）',
     win.eval('LOCAL.games.length') === 1
     && win.eval("((LOCAL.games[0]||{}).hit||{}).title") === '加入测试'
     && win.eval('(LOCAL.games[0]||{}).via') === 'manual'
     && win.eval("(LOCAL.links['sid:7770001']||{}).title") === '加入测试'
     && win.eval('LOCAL.adding') === false);
  win.eval("LOCAL.pendingLink = {name:'本机那条', steamId:'7770002'}; LOCAL.adding = false;"
         + " document.getElementById('smask').classList.add('linkmode');");
  win.eval("searchPick({title:'关联测试', appid:'7770002'})");
  ok('v16D：关联模式 → 点结果只绑定、**不**新增条目',
     win.eval('LOCAL.games.length') === 1
     && win.eval('JSON.stringify(LOCAL.pendingLink)') === 'null'
     && win.eval("(LOCAL.links['sid:7770002']||{}).title") === '关联测试');
  ok('v16D：关联完成后撤掉弹窗高亮（不留「还在关联模式」的错觉）',
     !win.eval("document.getElementById('smask').classList.contains('linkmode')"));
  ok('v16D：键取自**本机侧那条**（下次扫盘先拿到的是它，用它的键才找得回关联）',
     win.eval("LOCAL.links['sid:7770002'] !== undefined")
     && win.eval("LOCAL.links['nm:关联测试'] === undefined"));
  win.eval("LOCAL.pendingLink = {name:'x'}; LOCAL.adding = true;");
  win.eval('closeSearch()');
  ok('v16D：Esc / ✕ 关掉搜索 = 放弃本次关联/加入（不留下半个 pending）',
     win.eval('LOCAL.pendingLink === null && LOCAL.adding === false'));
  win.eval("LOCAL.games = JSON.parse(window.__mgG); LOCAL.links = JSON.parse(window.__mgL);"
         + " var _s = JSON.parse(window.__mgS); LOCAL.scanned = _s[0]; LOCAL.showAll = _s[1];"
         + " linkSave();");
  ok('v16D：行为验证后 LOCAL 已复原（不给后续断言留脏状态）',
     String(win.eval('Object.keys(LOCAL.links).length')) === String(win.eval('window.__mgLN'))
     && win.eval('LOCAL.adding') === false && win.eval('LOCAL.pendingLink === null'));
  /* ★ 落盘通道在 jsdom 里**故意**不可用（`about:blank` ⇒ localStorage 直接抛 DOMException）——
     这正好把「存储不可用」这条降级路径真实地跑了一遍：linkSet/linkLoad 必须 try/catch，
     否则整个「我的游戏」页会因为这个可有可无的持久化而崩掉。
     ★ 注意：断言里**不能引用注释文本** —— `code` 是去注释后的源码（见文件头 const code）。 */
  ok('v16D：落盘失败不算崩（存储不可用时退化为「仅本次会话」，功能照常用）',
     /function linkSave\(\)\{\s*\n\s*try\{ localStorage\.setItem\(LINK_KEY, JSON\.stringify\(LOCAL\.links\)\); \}catch\(e\)\{/.test(code)
     && /function linkLoad\(\)\{[\s\S]{0,260}?catch\(e\)\{/.test(code)
     && win.eval("(function(){ try{ return typeof localStorage.getItem('gi-local-links'); }catch(e){ return 'unavailable'; } })()")
        === 'unavailable');

  /* ================= 16. ★v16-E 手游评分关联 + 标签筛选 =================
     用户 2026-10-16 ⑥：「手游这块我认为可以爬取游戏的评分或者综合进行评分，
     还有我需要游戏标签可以进行筛选」，实施口径＝「**先零新增获取**，没有再爬取兜底」。

     ★ 这一节守三件事：
       ① 评分必须是**上游本来就有的真值**（`libScore`），**不许我们造**；
       ② 覆盖不到的字段（如上游没给明确口径的 `dl`）**宁可不显示也不猜**；
       ③ 标签筛选只是「把已有协议接上」—— 点卡片上的标签 == 点筛选栏的标签（同一套 `data-fg`），
          不另写一套标签逻辑。 */

  /* --- ① liveMH 零新增补字段 --- */
  const M1 = JSON.parse(win.eval("JSON.stringify((function(){ var r = liveMH({name:'看门狗',"
    + " libScore:8.4, libSize:'16.4GB', hasTr:true, hasSv:false, recent:1791722933,"
    + " configs:36, devices:['a','b'], chips:['8gen1'], libId:'xd-233'});"
    + " return {score:r.score, scoreV:r.scoreV, size:r.size, sizeGB:r.sizeGB, recent:r.recent,"
    + " tr:r.res && r.res.trainers, sv:r.res && r.res.saves, lab:r.scoreLab, liveId:r.liveId}; })())"));
  ok('v16E：mPlay 读上游本来就有的 libScore（零新增，一个请求都没多打）',
     M1.score === 8.4 && M1.scoreV === 8.4, JSON.stringify(M1));
  ok('v16E：mPlay 容量取 libSize（并把文本换算成 GB 供排序）',
     M1.size === '16.4GB' && Math.abs(M1.sizeGB - 16.4) < 0.001, String(M1.sizeGB));
  ok('v16E：mPlay 带最近更新时间（unix 秒）与资源角标（hasTr / hasSv）',
     M1.recent === 1791722933 && M1.tr === 1 && M1.sv === 0, JSON.stringify(M1));
  ok('v16E：评分口径明确标成「端游库评分」（不冒充手游站评分）',
     M1.lab === '端游库评分' && M1.liveId === 'xd-233', M1.lab);
  const M2 = JSON.parse(win.eval("JSON.stringify((function(){ var r = liveMH({name:'x', dl:233});"
    + " return {score:r.score, scoreV:r.scoreV, hot:r.hot, res:r.res}; })())"));
  ok('v16E：上游没给评分的条目**不伪造**（score 空、scoreV 0，不当成 0 分）',
     M2.score === '' && M2.scoreV === 0, JSON.stringify(M2));
  ok('v16E：`dl` 语义不明**刻意不用**（不编「下载量」这种假标签）',
     M2.hot === undefined, String(M2.hot));
  ok('v16E：没有 hasTr / hasSv 时 res 为 null（不显示 🧩0 这种噪音角标）',
     M2.res === null);

  /* --- ② 排序：把已有评分/热度接上 --- */
  ok('v16E：mPlay 新增「评分最高」排序',
     win.eval("SORTS.mPlay.map(s=>s.k).join(',')").split(',').includes('score'));
  ok('v16E：mPlay 新增「最近更新」，且走**数值**比较器（recent 是 unix 秒，不能塞进 ts 的字符串比较）',
     win.eval("SORTS.mPlay.map(s=>s.k).join(',')").split(',').includes('recent')
     && /recent:\(a,b\)=> \(Number\(gv\(b,'recent'\)\)\|\|0\)-\(Number\(gv\(a,'recent'\)\)\|\|0\)/.test(code));
  ok('v16E：mEvent 新增「评分最高」与「热度最高」（原来 41/131 有分、98/131 有热度却排不了）',
     win.eval("SORTS.mEvent.map(s=>s.k).join(',')").split(',').includes('score')
     && win.eval("SORTS.mEvent.map(s=>s.k).join(',')").split(',').includes('hot'));

  /* --- ③ 标签筛选：FILTERS 挂上 tags + optsFor 支持数组字段 --- */
  const F_NEW = win.eval("JSON.stringify(FILTERS.mNew.map(g=>g.k+':'+g.field))");
  const F_EV = win.eval("JSON.stringify(FILTERS.mEvent.map(g=>g.k+':'+g.field))");
  ok('v16E：mNew 挂了「标签」筛选组（field=tags，按频次取前 14）',
     /"tags:tags"/.test(F_NEW) && /tags',lb:'标签',field:'tags',top:14/.test(code), F_NEW);
  ok('v16E：mEvent 也挂了「标签」筛选组', /"tags:tags"/.test(F_EV), F_EV);
  const OF = JSON.parse(win.eval("JSON.stringify(optsFor('mNew',{k:'tags',lb:'标签',field:'tags',top:3},"
    + " [{tags:['A','B']},{tags:['A']},{tags:['C']}]))"));
  ok('v16E：optsFor 支持**数组字段**（原实现把数组当 Map 键 ⇒ 每个数组都成一条选项，全点不动）',
     OF.length === 3 && OF[0].v === 'A', JSON.stringify(OF));
  ok('v16E：optsFor 先按频次降序、再按名称（A 出现 2 次排最前；B/C 并列时按名）',
     OF.map(o => o.v).join(',') === 'A,B,C', OF.map(o => o.v).join(','));
  const OF2 = JSON.parse(win.eval("JSON.stringify(optsFor('mNew',{k:'tags',field:'tags',top:2},"
    + " [{tags:['A']},{tags:['A']},{tags:['B']},{tags:['C']}]))"));
  ok('v16E：top 截断生效（高频优先）', OF2.length === 2 && OF2[0].v === 'A', JSON.stringify(OF2));

  /* --- ④ 卡片：评分上屏 / 标签可点 --- */
  const CP = win.eval("cardPlay({title:'看门狗', score:8.4, scoreLab:'端游库评分', configs:36,"
    + " devices:7, chip:'8gen1', tier:'可玩', tierKey:'ok', fps:'30-45', res:{trainers:1}}, 0, 'mPlay')");
  ok('v16E：mPlay 卡片显示评分（复用已有 .pill.score 样式，不新造一套）',
     /pill score/.test(CP) && /★ 8.4/.test(CP) && /端游库评分/.test(CP));
  ok('v16E：mPlay 卡片带资源角标（有修改器就显示）', /🧩|🛠/.test(CP));
  const CP0 = win.eval("cardPlay({title:'无分', configs:3, tier:'待测', tierKey:'pending'}, 0, 'mPlay')");
  ok('v16E：mPlay 无评分时不出评分 pill（不摆 ★0.0）',
     !/pill score/.test(CP0) && !/★/.test(CP0));
  const CE = win.eval("cardMEvent({title:'《X》周年', game:'X', cat:'活动', score:6.4}, 0, 'mEvent')");
  ok('v16E：活动卡右上角并列评分（放在 .mtop，**不新开一行** —— 卡高定死 118px）',
     /mtop/.test(CE) && /pill score/.test(CE) && /★ 6.4/.test(CE));
  ok('v16E：活动卡仍有且只有一处独立时间字段（不因加评分挤掉时间行）',
     (CE.match(/mtime/g) || []).length <= 1);
  const CE0 = win.eval("cardMEvent({title:'x', game:'x', cat:'活动', hot:710000, hotLabel:'热度'}, 0, 'mEvent')");
  ok('v16E：活动卡无评分时回落热度（与 mNew 卡的「评分 > 热度 > —」同一优先序）',
     /pill hot/.test(CE0) && !/pill score/.test(CE0));
  const CN = win.eval("cardMNew({game:'X', tags:['经营','卡牌','二次元'], cat:'新游上线', status:'已上线',"
    + " sources:[], src:'小七', srcKey:'x7', note:'n', hot:100}, 0, 'mNew')");
  ok('v16E：新游卡的标签**可点**（data-fg/data-fv 与筛选栏同一套协议）',
     /pill tap/.test(CN) && /data-fg="tags"/.test(CN) && /data-fv="经营"/.test(CN));
  ok('v16E：新游卡标签不再只有 3 个上限以外的丢失（前 3 个可点，其余仍靠筛选栏）',
     (CN.match(/data-fv=/g) || []).length === 3);
  const CN0 = win.eval("cardMNew({game:'Y', tags:[], cat:'新游上线', status:'已上线', sources:[],"
    + " src:'小七', srcKey:'x7', note:'n'}, 0, 'mNew')");
  ok('v16E：无标签时回落到类目，且**不可点**（不假装能按类目筛标签）',
     /pill"/.test(CN0) && !/pill tap/.test(CN0) && !/data-fg="tags"/.test(CN0));

  /* --- ⑤ 绑定纪律：一处绑、幂等、覆盖 refreshList --- */
  ok('v16E：筛选栏绑定排除 .tap（两处都绑会让一次点击 toggle 两次 = 等于没点）',
     /querySelectorAll\('\[data-fg\]:not\(\.tap\)'\)/.test(code));
  ok('v16E：bindTagPills 幂等（__tap 去重）且 refreshList 里也调用（否则搜完字标签就点不动了）',
     /if\(b\.__tap\) return;/.test(code)
     && /box\.innerHTML = sec\.grid;[\s\S]{0,900}?bindTagPills\(box\);/.test(code));
  /* 必须先切到 mNew —— 前面的断言已经把当前 Tab 换走了（排行榜 / pcNew …），
     不切的话这一条测的其实是「别的页面上有没有标签」，恒为 0。 */
  go('mNew');
  const TAP = JSON.parse(win.eval("JSON.stringify((function(){"
    + " var els = document.querySelectorAll('.pill.tap[data-fg]');"
    + " return {n: els.length, first: els.length ? els[0].dataset.fv : ''}; })())"));
  ok('v16E：切到 mNew 后卡上确有可点标签（不是只在源码里）', TAP.n > 0, JSON.stringify(TAP));

  /* 行为验证：点卡上的标签 == 勾选筛选栏的同一个标签。
     ★ 取值必须从**筛选栏**里挑（那里是 top14 高频标签，保证按钮存在），
       再回到卡上找**同一个标签**的 pill —— 反过来随便挑卡上的第一个标签，
       它很可能不在 top14 里，于是「筛选栏按钮同步点亮」这条就恒假（本轮实测踩过）。 */
  win.eval("fx = {}; pgReset('mNew'); resetState('mNew'); render();");
  const fbarVals = $$('#main .tg[data-fg="tags"]').map(b => b.dataset.fv);
  let tapEl = null, tapVal = '';
  for (const v of fbarVals) {
    const el = $$('#main .pill.tap[data-fg="tags"]').find(x => x.dataset.fv === v);
    if (el) { tapEl = el; tapVal = v; break; }
  }
  win.eval('window.__tapv = ' + JSON.stringify(tapVal) + ';');
  ok('v16E：mNew 首页上确实存在「筛选栏有、卡上也有」的标签（可点性有实测基础）',
     !!tapEl, `fbar=${fbarVals.length} tap=${$$('#main .pill.tap[data-fg="tags"]').length}`);
  if (tapEl) tapEl.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('v16E：点卡上的标签 → 真的把该标签加进筛选（不是只加个样式）',
     tapVal !== '' && win.eval("!!(fx.tags && fx.tags.has(window.__tapv))") === true,
     `tap=${tapVal}`);
  ok('v16E：点标签后筛选栏里同一个标签按钮也同步点亮（两处口径一致）',
     win.eval("Array.from(document.querySelectorAll('#main .tg[data-fg=\"tags\"]'))"
              + ".some(b => b.dataset.fv === window.__tapv && b.classList.contains('on'))"));
  ok('v16E：点标签**没有**顺带弹出详情弹窗（stopPropagation 生效）',
     !win.eval("document.getElementById('mask').classList.contains('on')"));
  win.eval("fx = {}; pgReset('mNew'); resetState('mNew'); render();");

  /* ================= 17. ★v16-F 活动图逐图适配 =================
     用户 2026-10-16 ⑦：「根据游戏活动图片进行适配优化，如果是游戏icon/正方形的图片
     则再优化下完整显示」＋「放大一点图片和标题（参考 gcores.com/news）」。

     ★ 实测依据（`_actfit.py`，2026-10-16，各 60 张真图量宽高）：
       活动图 **12/60 是 256×256 正方 icon**（明日方舟：终末地 / 三角洲行动 / 无畏契约 …），
       在 16:10 容器里被 cover 裁 **37.5%**；另 48/60 是横版（ar ≥ 1.5）。
       容器换比例跑对照：改 1:1 ⇒ 横版均值裁切 15.4% → **35%**（修好 20%、弄坏 80%）；
       改 4:3 ⇒ 最狠 25% 但均值 24.9%。⇒ **没有统一比例能同时照顾两簇**，只能逐图判。
     ★ 这一节守的：判定阈值不越界（不把横版误判成 icon）、两条 CSS 成对、缺图不赌。 */

  const FT = JSON.parse(win.eval("JSON.stringify((function(){"
    + " function mk(w,h,cls){"
    + "   var box=document.createElement('div'); box.className='mth '+cls;"
    + "   var img=document.createElement('img');"
    + "   Object.defineProperty(img,'naturalWidth',{value:w});"
    + "   Object.defineProperty(img,'naturalHeight',{value:h});"
    + "   box.appendChild(img); fitThumb(img); return box.className; }"
    + " var orphan = (function(){ var im=document.createElement('img');"
    + "   try{ fitThumb(im); return 'ok'; }catch(e){ return 'throw:'+e.message; } })();"
    + " return { sq:mk(256,256,'wd'), wide:mk(1280,720,'wd'), tall:mk(300,600,'wd'),"
    + "   nw:mk(256,256,'sq'), edgeHi:mk(118,100,'wd'), over:mk(119,100,'wd'),"
    + "   edgeLo:mk(85,100,'wd'), under:mk(84,100,'wd'), zero:mk(0,0,'wd'), orphan:orphan };"
    + " })())"));
  ok('v16F：1:1 的活动图 → 容器切 .fit（换成正方框 + contain，完整显示不裁切 37.5%）',
     /(^|\s)fit(\s|$)/.test(FT.sq), FT.sq);
  ok('v16F：横版活动图**不**切 .fit（保持 16:10 cover —— 否则会把 80% 的图弄坏）',
     !/fit/.test(FT.wide), FT.wide);
  ok('v16F：竖图也不切 .fit（阈值下限 0.85 才认「正方」）', !/fit/.test(FT.tall), FT.tall);
  ok('v16F：边界值 ar=1.18 / 0.85 判为正方（含端点，实测横版最低 1.5，留足余量）',
     /(^|\s)fit(\s|$)/.test(FT.edgeHi) && /(^|\s)fit(\s|$)/.test(FT.edgeLo),
     `${FT.edgeHi} / ${FT.edgeLo}`);
  ok('v16F：越过边界（ar=1.19 / 0.84）就不判为正方（阈值不是「都算」）',
     !/fit/.test(FT.over) && !/fit/.test(FT.under), `${FT.over} / ${FT.under}`);
  ok('v16F：新游卡（.sq）不参与判定（它本来就是 1:1，实测 59/59 零裁切）',
     !/fit/.test(FT.nw), FT.nw);
  ok('v16F：图没解出来（naturalWidth=0）时**不赌**，保持原样', !/fit/.test(FT.zero), FT.zero);
  ok('v16F：容器缺失 / 游离节点时不抛错（reveal 对缓存命中时序必须安全）',
     FT.orphan === 'ok', FT.orphan);
  ok('v16F：`.mth.wd.fit` 的两条 CSS **成对**存在（只改 contain 会留衬底、只改容器会裁横版图）',
     /\.mth\.wd\.fit\{width:var\(--mb-thw\);aspect-ratio:1 \/ 1\}/.test(code)
     && /\.mth\.wd\.fit img\{object-fit:contain\}/.test(code));
  ok('v16F：判定挂在 reveal 里（全站 onload 仍是 reveal(this)，不新增第二条岔路）',
     /function reveal\(img\)\{[\s\S]{0,320}?fitThumb\(img\);\s*\n\}/.test(code)
     && /onload="reveal\(this\)"/.test(html));
  ok('v16F：活动卡根节点加 `ev` 类（单独放大标题，不改基类去影响新游卡）',
     /class="mcard ev" data-d=/.test(code) && /\.mcard\.ev \.mt\{font-size:14\.5px/.test(code));
  ok('v16F：实测数字已写进源码注释（12/60 正方 icon · 最狠 37.5%），下轮不必重测',
     /12\/60/.test(html) && /37\.5%/.test(html));

  /* ================= 18. ★v16-G 桌面客户端形态 =================
     用户 2026-10-16 ⑤：「为什么 UI 还是很页面化，没有 APP 那种感觉」
     → 拍板「**暗色高质感桌面客户端**（Steam / Playnite 式）」。

     ★ 两条纪律：
       ① 桌面形态的规则**全部**收在 `html.has-shell` 作用域里 ⇒ 线上 demo 的网页形态一字不变；
       ② 「网站味」要掐的是**具体来源**（一层平铺 / 导航是链接 / 密度低），
          不是笼统地把圆角和留白都砍掉 —— 所以每条规则都能说出它在治哪一个来源。
     ★ jsdom 里没有壳桥 ⇒ `has-shell` 不会挂上（第 1435 行已守），
       所以这一节以**源码级**断言为主 + 对 navSet 做行为验证。 */

  ok('v16G：侧栏底部状态条默认 display:none（网页形态连占位都不占）',
     /^\.navfoot\{display:none\}/m.test(code));
  ok('v16G：桌面形态里侧栏是「固定宽度 + 变暗 + flex 列」（底部状态条靠 margin-top:auto 顶到底）',
     /html\.has-shell \.nav\{[\s\S]{0,200}?background:var\(--sunken\)[\s\S]{0,80}?flex-direction:column/.test(code));
  /* ★v25：v24 及以前这里断言写死 `border-radius:7px`；圆角收敛到级差后
     改为断言「用的是级差变量」—— 这样下一轮调级差数值不会再假红。 */
  ok('v16G：导航项改成「固定 32px 行高 + 圆角项」（网页那种 <a> 文本流是网站味来源之一）',
     /html\.has-shell \.nav a\{[\s\S]{0,140}?height:32px;border-radius:var\(--r-sm\)/.test(code));
  ok('v16G：选中项用**独立竖条**（::before）而不是蹭在容器边上的 border-left',
     /html\.has-shell \.nav a\.on::before\{[\s\S]{0,160}?background:var\(--accent\)/.test(code));
  ok('v16G：内容区成为独立面板（与侧栏分层：一侧 sunken、一侧 card + 左描边）',
     /html\.has-shell \.main\{[\s\S]{0,160}?background:var\(--card\);border-left:1px solid var\(--line\)/.test(code));
  /* ★v25 翻转了 v16G 的这条口径：v16G 是「只描边、不位移」，理由是「位移会让网格抖」；
     v25 用户拍板改成「描边 + 上浮 4px」，因为 transform 走合成层不触发重排，抖的顾虑不成立。
     本条改为断言「两路信号都在」，并把位移量卡在 ≤6px（防止下一轮有人调成参考站的 8px 那种大幅位移）。 */
  ok('v25：卡片悬停 = 描边为主信号 + 上浮≤6px 为次信号（v16G「取消位移」作废）',
     /html\.has-shell \.card:hover,[\s\S]{0,120}?transform:translateY\(-\d(px)?\);border-color:var\(--sub2\);box-shadow:/.test(code));
  ok('v16G：叶脚长说明在桌面形态收窄弱化（长文页脚是网站味重灾区）',
     /html\.has-shell \.foot\{font-size:11px/.test(code));
  ok('v16G：桌面形态的规则**全部**带 `html.has-shell` 前缀（不泄漏到线上网页形态）',
     /\.navfoot\{display:none\}/.test(code)
     && !/^\.nav\{[^}]*flex-direction:column/m.test(code)
     && !/^\.main\{[^}]*border-left/m.test(code)
     && !/^\.navfoot\{display:flex/m.test(code)
     && (code.match(/html\.has-shell /g) || []).length >= 14,
     `has-shell 规则数=${(code.match(/html\.has-shell /g) || []).length}`);

  /* navSet 行为：常驻写入（不是「闪一下就还原」—— 那条路径是 svcFlash） */
  ok('v16G：侧栏状态条节点在 DOM 里（网页形态靠 CSS 隐藏，不是不渲染）',
     !!doc.getElementById('navfoot') && !!doc.getElementById('navState'));
  win.eval("navSet('测试状态 · 已连接', true)");
  ok('v16G：navSet 写入侧栏常驻状态（并清掉 off 告警态）',
     doc.getElementById('navState').textContent === '测试状态 · 已连接'
     && !doc.getElementById('navfoot').classList.contains('off'));
  win.eval("navSet('内置快照 · 未连本机库', false)");
  ok('v16G：navSet(ok=false) 给状态条挂 off 类（离线时圆点变告警色，不是假装正常）',
     doc.getElementById('navfoot').classList.contains('off'));
  ok('v16G：navSet 不会定时还原（区别于 svcFlash —— 状态必须是**常驻**的）',
     /function navSet\(text, ok\)\{[\s\S]{0,300}?\}/.test(code)
     && !/function navSet\(text, ok\)\{[\s\S]{0,300}?setTimeout/.test(code));
  ok('v16G：实时层接入成功时，顶栏与侧栏**同时**写（两处口径不许打架）',
     /svcPin\('实时库已接入',[\s\S]{0,420}?navSet\('本机实时库 · 已连接', true\);/.test(code));
  ok('v16G：离线分支也写侧栏状态（只在顶栏说「快照」而侧栏还亮绿点 = 口径打架）',
     /if\(!base\)\{[\s\S]{0,260}?navSet\('内置快照 · 未连本机库', false\)/.test(code));

  /* ================= 19. ★v16-H 网盘直链外挂（OpenList / AList） =================
     用户 2026-10-16 ③：「可以升级，可以通过 github 的开源项目优化」
     → 拍板「**外挂 OpenList / AList，App 只调它的 API**」。

     ★ 这一节守四件事（每条都对应一个会真实伤到用户的失败模式）：
       ① **只是调用、不是分发** —— OpenList 是 AGPL-3.0，任何打包/内联都会把整个
          闭源 exe 拖进 AGPL。这里从**形态**上守：唯一出口是 `olNormBase()` 拼出来的
          http(s) 地址，没有第二条加载路径。
       ② **`olReady()` 三条件缺一不可**，且 `probed/tried` **不落盘** ⇒
          不存在「上次连过、这次没验证也自称已连接」。
       ③ **未就绪时按钮根本不渲染** —— 用户明确不许出现「点了必然报错」的按钮。
       ④ **失败原样带出上游报错**，不许翻译成「暂不支持该网盘」（我们没验过用户的实例）。

     ⚠️ 顺序有讲究：先做**纯源码/纯函数**的断言（不改状态），再进 fetch 打桩段，
     最后把 OL 与 fetch 全复位 —— 否则这一节会把后面（或页面自身）的状态带偏。 */

  /* --- ① 不是分发：唯一的出口是 olNormBase() 拼出的 http(s) 地址 --- */
  ok('v16H：OpenList 只走 HTTP 调用（源码里没有 require/import 它、没有 <script src> 引入）',
     !/require\(['"][^'"]*openlist/i.test(code) && !/<script[^>]+openlist/i.test(html)
     && /fetch\(base \+ path, \{/.test(code));
  win.eval("OL.base='127.0.0.1:5244'; window.__b1 = olNormBase()");
  win.eval("OL.base='https://alist.example.com/'; window.__b2 = olNormBase()");
  win.eval("OL.base=''; window.__b3 = olNormBase()");
  ok('v16H：地址会被归一到 http(s)（用户只填 127.0.0.1:5244 也认）且去掉结尾斜杠',
     win.eval('window.__b1') === 'http://127.0.0.1:5244'
     && win.eval('window.__b2') === 'https://alist.example.com'
     && win.eval('window.__b3') === '');

  /* --- ② olReady() 三条件缺一不可 --- */
  const RD = (b, p, e) => win.eval("OL.base=" + JSON.stringify(b) + "; OL.probed=" + p
                                   + "; OL.exp=" + e + "; olReady()");
  ok('v16H：olReady 三条件**缺一不可**（只有全真才允许调转存）',
     RD('http://x', false, false) === false && RD('http://x', true, false) === false
     && RD('http://x', false, true) === false && RD('', true, true) === false
     && RD('http://x', true, true) === true);
  ok('v16H：只落盘 4 个**配置**键（probed/tried 不落盘 —— 否则下次启动不验证也自称已连接）',
     /localStorage\.setItem\(OL_KEY, JSON\.stringify\(\{ base:OL\.base, token:OL\.token, dir:OL\.dir, exp:OL\.exp \}\)\)/.test(code)
     && /const OL = \{[^}]*probed:false[^}]*tried:false[^}]*\}/.test(code));
  ok('v16H：连接测试把 tried 置真（自动补测的闸门 —— 壳推进度会反复调 renderDownloads）',
     /async function olProbe\(\)\{\s*OL\.probed = false; OL\.note = ''; OL\.tried = true;/.test(code)
     && /if\(OL\.base && !OL\.probed && !OL\.tried\) olProbe\(\);/.test(code));

  /* --- ③ 未就绪 ⇒ 按钮不渲染 --- */
  win.eval("OL.base=''; OL.probed=false; OL.exp=false; window.__nb = dlBtns('https://pan.xunlei.com/s/AAA','分享名','浏览器打开')");
  ok('v16H：未就绪时 dlBtns **不出**「↪ 转存到网盘」（不给用户一个点了必然报错的按钮）',
     win.eval('window.__nb').indexOf('data-olput') < 0
     && win.eval('window.__nb').indexOf('data-dlstart') > 0,
     win.eval('window.__nb').slice(0, 120));
  win.eval("OL.base='http://127.0.0.1:5244'; OL.probed=true; OL.exp=true; window.__yb = dlBtns('https://pan.xunlei.com/s/AAA','分享名','浏览器打开')");
  ok('v16H：就绪后网盘分享链才多出 data-olput（真直链不给 —— 那是壳的内置下载器干的活）',
     win.eval('window.__yb').indexOf('data-olput="1"') > 0
     && win.eval("dlBtns('https://a.com/x.zip','x','打开')").indexOf('data-olput') < 0);
  ok('v16H：实验开关在自检通过前是 disabled（不透出「先勾上再发现连不上」的错觉）',
     /id="olexp"[^>]*\$\{OL\.probed \? '' : ' disabled'\}/.test(code));
  /* ★v23：委托的选择器加了几个 data-*（dlremove / dlpath / exopen 都是「行上的动作」），
     所以判据从「固定 140 字符的尾巴」改成「包含 dlstart 与 olput，且委托只有一处」。 */
  ok('v16H：转存按钮挂进了**同一个** document 级委托（页面里没有第二处，漏了就成死按钮）',
     /e\.target\.closest\('\[data-dlstart\][^']*\[data-olput\]/.test(code)
     && (code.match(/\[data-olput\]/g) || []).length === 1);
  ok('v16H：转存分支排在 `if(!job) return` **之前**（它身上没有任务 id，落到那条判空就被静默挡掉）',
     code.indexOf('if(b.dataset.olput){') > 0
     && code.indexOf('if(b.dataset.olput){') < code.indexOf('if(!job) return;'));
  /* ★v18 口径更新（**判据变严不变松**）：下载管理页底部由「分页条 → olCard → 页脚」
     变成「分页条 → **upCard（上游服务）** → olCard → 页脚」。
     这里不再只匹配「pager…+olCardHTML()+footNote()」那一串，而是**逐个校验四段顺序** ——
     少一段、顺序颠倒、或 upCard 被塞到 olCard 后面（会抢走「配置块在最底」的语义）都会变红。 */
  /* ★v23 口径变更（**有意**）：配置块不再平铺在页尾，而是收进 `dlSetHTML()` 这个折叠区
     —— 用户口径「现在的下载管理有点复杂，精简下」。
     但要守住两件没变的事：① 它仍然在**分页条之后、页脚之前**；
     ② `olBind` 仍然**跟着整块重渲染走**（否则重渲染后配置块的绑定会失效）。 */
  ok('v23精简：引擎/上游/网盘三张卡收进 `dlSetHTML()` 折叠区，位置仍在分页条之后、页脚之前',
     /pagerHTML\('downloads', totalN, '个任务'\) : ''\) \+ dlSetHTML\(\) \+ footNote\(\)/.test(code)
     && /class="dlsetbody">\$\{dlEngineHTML\(\)\}\$\{upCardHTML\(\)\}\$\{olCardHTML\(\)\}/.test(code));
  ok('v23精简：`olBind` 仍跟着整块重渲染走',
     /bindPager\(main, 'downloads',[\s\S]{0,260}?olBind\(main\);/.test(code));

  /* --- 下载管理页真的渲染出这块控件（DOM 级）--- */
  /* ★ 取值一律走这两个**空安全**取件器：`doc.getElementById('x').checked` 一旦元素
     不存在就抛异常 ⇒ 反证读到的是「崩溃」而不是「变红」，判据直接失效。
     （这是本节自己踩过的坑：M94 把整块卡片删掉时，裸取会炸。） */
  const OE = () => doc.getElementById('olexp');
  const OR = () => doc.getElementById('olres');
  win.eval("OL.base=''; OL.probed=false; OL.tried=false; OL.exp=false; goTab('downloads')");
  ok('v16H：下载管理页真的渲染出 .olcard 与地址/令牌/目录/测试/保存/实验/状态/结果八个节点',
     !!doc.querySelector('.olcard') && !!doc.getElementById('olbase') && !!doc.getElementById('oltoken')
     && !!doc.getElementById('oldir') && !!doc.getElementById('olprobe') && !!doc.getElementById('olsave')
     && !!doc.getElementById('olexp') && !!doc.getElementById('olnote') && !!doc.getElementById('olres'),
     'olcard=' + !!doc.querySelector('.olcard'));

  /* ---------- fetch 打桩段：从「该不该发请求」到「失败怎么报」 ---------- */
  win.eval("window.__fc = 0; window.__of = window.fetch;");
  win.eval("window.__stub = function(txt, ok, status){ window.fetch = async function(){"
           + " window.__fc++; return { ok: ok !== false, status: status || 200,"
           + " text: async function(){ return txt; } }; }; };");

  /* ③-b 未就绪时连请求都不该发 */
  win.eval("OL.base='http://127.0.0.1:5244'; OL.probed=true; OL.exp=false; window.__fc=0;"
           + " window.__stub('{\"code\":200}', true, 200)");
  await win.eval("window.__p1 = olTransfer('https://pan.xunlei.com/s/AAA','x').then(function(r){ window.__t1 = r; })");
  ok('v16H：未就绪时 olTransfer **直接拒绝且一个请求都不发**（不靠服务端报错来兜底）',
     win.eval('window.__t1').ok === false && /未就绪/.test(win.eval('window.__t1').err)
     && win.eval('window.__fc') === 0,
     'fc=' + win.eval('window.__fc') + ' err=' + win.eval('window.__t1').err);

  /* ④ 失败必须原样带出上游报错（HTTP 层 / body 层 / 非 JSON 三种） */
  win.eval("OL.probed=true; OL.exp=true; window.__fc=0");
  win.eval("window.__stub('{\"code\":429,\"message\":\"Too Many Requests\"}', false, 429)");
  await win.eval("window.__p2 = olTransfer('https://pan.xunlei.com/s/AAA','x').then(function(r){ window.__t2 = r; })");
  ok('v16H：HTTP 非 2xx 时原样带出「HTTP 状态 + OpenList 的 message」（不吞成 null、不编话术）',
     win.eval('window.__t2').ok === false && /HTTP 429/.test(win.eval('window.__t2').err)
     && /Too Many Requests/.test(win.eval('window.__t2').err),
     win.eval('window.__t2').err);

  win.eval("window.__stub('{\"code\":401,\"message\":\"password is incorrect\"}', true, 200)");
  await win.eval("window.__p3 = olApi('/api/fs/list', {}).then(function(){ window.__e3 = 'NO_THROW'; },"
                 + " function(e){ window.__e3 = String((e && e.message) || e); })");
  ok('v16H：HTTP 200 但 body 里 code!=200 也要抛（AList/OpenList 的错写在 body 里，只看状态码会漏）',
     /code=401/.test(win.eval('window.__e3')) && /password is incorrect/.test(win.eval('window.__e3')),
     win.eval('window.__e3'));

  win.eval("window.__stub('<!doctype html><html>welcome to nginx</html>', true, 200)");
  await win.eval("window.__p4 = olApi('/api/fs/list', {}).then(function(){ window.__e4 = 'NO_THROW'; },"
                 + " function(e){ window.__e4 = String((e && e.message) || e); })");
  ok('v16H：返回不是 JSON 时明说「地址可能填到了别的服务」（比「连接失败」有用得多）',
     /不是 JSON/.test(win.eval('window.__e4')), win.eval('window.__e4'));

  /* 自检成功 ⇒ 报**真实存储名**，不是「连接成功」四个字 */
  win.eval("window.__stub('{\"code\":200,\"data\":{\"content\":[{\"name\":\"aliyun\"},{\"name\":\"115\"}]}}', true, 200)");
  win.eval("OL.probed=false; OL.note=''; OL.exp=false");
  await win.eval("window.__p5 = olProbe().then(function(v){ window.__r5 = v; })");
  ok('v16H：连接测试成功时报出**真实存储列表**（把 OpenList 的原话转述给用户，不自说自话）',
     win.eval('window.__r5') === true && /aliyun/.test(win.eval('OL.note'))
     && /2 个存储/.test(win.eval('OL.note')), win.eval('OL.note'));

  /* 自检失败 ⇒ probed 归假、**实验开关真的被关掉**（状态与视图不许打架） */
  win.eval("OL.exp=true; OL.probed=true;"
           + " window.fetch = async function(){ window.__fc++; throw new Error('ECONNREFUSED 127.0.0.1:5244'); };");
  await win.eval("window.__p6 = olProbe().then(function(v){ window.__r6 = v; })");
  ok('v16H：连接测试失败时把**上游原始报错**写进状态行（不说「网络异常」这种废话）',
     win.eval('window.__r6') === false && /连接失败/.test(win.eval('OL.note'))
     && /ECONNREFUSED/.test(win.eval('OL.note')), win.eval('OL.note'));
  ok('v16H：自检没过 ⇒ probed 归假、实验开关**真的**被关掉并落盘（不搞「看着关着其实开着」）',
     win.eval('OL.probed') === false && win.eval('OL.exp') === false
     && win.eval('OL.tried') === true
     && !!OE() && OE().checked === false && OE().disabled === true
     && /if\(!OL\.probed && OL\.exp\)\{ OL\.exp = false; olSave\(\); \}/.test(code));
  ok('v16H：勾选框回读用 `probed && exp` 两个条件（只看 OL.exp 会和「按钮出不出来」打架）',
     /c\.checked = !!\(OL\.probed && OL\.exp\)/.test(code));

  /* 结果落点：贴原话，且成功/失败视觉分开 */
  win.eval("olRes('转存失败，OpenList 原话：HTTP 403 · no permission', false)");
  ok('v16H：转存失败的结果块把上游原话贴出来并标红（不落到一句「暂时不可用」）',
     !!OR() && /HTTP 403/.test(OR().textContent) && OR().classList.contains('bad'));
  win.eval("olRes('已提交转存：测试。', true)");
  ok('v16H：成功态与失败态在视觉上分开（ok / bad 两个类，不共用一套色）',
     !!OR() && OR().classList.contains('ok') && !OR().classList.contains('bad'));
  win.eval("window.__noNode = (function(){ var el = document.getElementById('olres');"
           + " if(!el) return 'no-node'; var p = el.parentNode; p.removeChild(el); var bad = false;"
           + " try{ olRes('无落点测试', false); }catch(e){ bad = true; }"
           + " p.appendChild(el); return bad ? 'throw' : 'ok'; })()");
  ok('v16H：拿不到 #olres（从详情弹窗里点转存）时不报错（退化为顶栏闪一下）',
     win.eval('window.__noNode') === 'ok', win.eval('window.__noNode'));

  /* ================= 20. ★v17 详情页同步工作台 + 跨源同款合并 =================
     用户 2026-10-16 口径（原话）：
       ①「点击后详情页也优化下」
       ②「同步工作台的详情页内容，不需要手机模拟器配置这些」
       ③「其次如果多平台的相同游戏则合并成一个即可，取相同内容」

     ──────────────────────────────────────────────────────────────────────
     (a) 列表层合并：跨源同款只出一条
     ────────────────────────────────────────────────────────────────────── */
  /* ⚠️ 两条坑一起避：
     ① 传参一律走 JSON.stringify（中文 / 连字符直接拼进 eval 字面量会串味）；
     ② 比之前先 String() 包一层 —— win.eval 求值出来的字符串与 Node 侧的不一定同 realm，
        直接 `===` 会假阴性（detail 里打印出来却完全一样，最难查的那种）。 */
  const nn = ['剑星/Stellar Blade', '  剑 星 ', 'Stellar-Blade', '']
    .map(s => win.eval('libNormName(' + JSON.stringify(s) + ')'));
  ok('v17合并：libNormName 取 `/` 前段并归一（去空白 / 连接符 / 大小写）',
     String(nn[0]) === '剑星' && String(nn[1]) === '剑星'
     && String(nn[2]) === 'stellarblade' && String(nn[3]) === '',
     JSON.stringify(nn));

  ok('v17合并：同款跨源条目只出一条（第 2 条进 skip、名字挂到主条上）',
     win.eval("(function(){var r=libMergeIndex([{title:'剑星',source:'jidi'},{title:'剑星/Stellar Blade',source:'xdgamer'}]);"
            + " return r.skip.has(1) && !r.skip.has(0) && r.note.get(0).length===1 && r.note.get(0)[0]==='剑星';})()") === true);

  ok('v17合并：**同源变体不并**（「剑星-虚拟机版」与「剑星」不同组 —— 变体是不同的资源包）',
     win.eval("(function(){var r=libMergeIndex([{title:'剑星'},{title:'剑星-虚拟机版/Stellar Blade HYPERVISOR'}]);"
            + " return r.skip.size===0;})()") === true);

  ok('v17合并：空标题 / 无名条目**不参与合并**（宁可不并，也不把两条无关的并到一起）',
     win.eval("(function(){var r=libMergeIndex([{title:''},{title:''},{title:'//'},{title:'//'}]);"
            + " return r.skip.size===0;})()") === true);

  ok('v17合并：三条同款并成一条，**主条下标不变**（skip 只记后面两条）',
     win.eval("(function(){var r=libMergeIndex([{title:'A'},{title:'A'},{title:'A'}]);"
            + " return r.skip.size===2 && r.skip.has(1) && r.skip.has(2) && r.note.get(0).length===2;})()") === true);

  ok('v17合并：渲染时用**原数组下标**喂 cardPC（curList 按页内下标取数，压掉数组就会点 A 开 B）',
     /L\.items\.forEach\(\(a, i\) => \{[\s\S]{0,160}MG\.skip\.has\(i\)[\s\S]{0,220}cardPC\(a, i, false, 'lib', MG\.note\.get\(i\)\)/.test(code));

  ok('v17合并：主条上出「⊕ +N 同款」并带来源名（.pill.mg）',
     /class="pill mg"/.test(code) && /⊕ \+\$\{merged\.length\} 同款/.test(code));
  /* ★ 实拍抓出来的：.cmeta 是 `flex-wrap:nowrap; overflow:hidden`，
     合并胶囊原来排在 resPills 之后 ⇒ **被整条裁掉**，图上那行只有「动作/热度/资源」。
     635→674 条断言全绿也拦不住这种「渲染出来了但看不见」。 */
  ok('v17合并：合并标记排在 meta **第一位**（排后面会被 .cmeta 裁掉 —— 实拍踩过）',
     /meta: mgPill \+/.test(code));

  ok('v17合并：pcNew / pcHot 走同一套页内合并（同一份双源混排库）',
     /const MG = \(tab==='pcNew'\|\|tab==='pcHot'\) \? libMergeIndex\(pageList\) : null;/.test(code));

  /* ⚠️ 判据必须落在**代码**上，不能落在注释上 —— `code` 是**去注释后**的源码
     （本项目已知纪律：断言引用注释文本必然假阴性）。「页内合并」这件事
     在代码上的形态就是：合并入口只吃**本页数组**（L.items / pageList），不吃全库。 */
  ok('v17合并：只做**页内合并**（合并入口只吃本页数组 L.items / pageList，从来不碰全库）',
     /libMergeIndex\(L\.items\)/.test(code) && /libMergeIndex\(pageList\)/.test(code)
     && !/libMergeIndex\(D\[/.test(code) && !/libMergeIndex\(ALL/.test(code));

  ok('v17合并：.pill.mg 用中性信息色（它描述「这条是怎么来的」，不该抢热度/资源胶囊的权重）',
     /\.pill\.mg\{background:var\(--info-chip\)/.test(code));

  /* ──────────────────────────────────────────────────────────────────────
     (b) 详情页同步工作台内容（★ 唯独不做「手机模拟器配置」）
     ────────────────────────────────────────────────────────────────────── */
  ok('v17详情：五个补水占位块的 id 清单固定（ddDesc/ddGal/ddReq/ddRel/ddTwin）',
     win.eval("DD_SLOTS.join(',')") === 'ddDesc,ddGal,ddReq,ddRel,ddTwin');

  const ddIds = ['ddDesc','ddGal','ddReq','ddRel','ddTwin'];
  ok('v17详情：五个占位块与清单**一一对应**（源码里各出现恰好一次 —— 少一个就会留空壳 / 多一个就是幽灵）',
     ddIds.every(id => (code.match(new RegExp('<div id="' + id + '"></div>', 'g')) || []).length === 1),
     ddIds.map(id => id + ':' + (code.match(new RegExp('<div id="' + id + '"></div>', 'g')) || []).length).join(' '));

  win.eval("goTab('pcNew')");
  win.eval("openDetail('pcNew', 0)");
  const dlgHtml = win.eval("document.getElementById('dlg').innerHTML");
  /* ⚠️ 必须**先剥掉 HTML 注释**再判：模板里那段「『手机模拟器配置』那块刻意不做」的
     说明本身就是弹窗 innerHTML 的一部分 —— 不剥注释会把「说了不做」判成「做了」。 */
  const dlgNoCmt = dlgHtml.replace(/<!--[\s\S]*?-->/g, '');
  ok('v17详情：打开后弹窗里**没有**「手机模拟器配置」块（用户口径：不需要）',
     !/手机模拟器配置|bhSlot|bannerhub/i.test(dlgNoCmt));
  ok('v17详情：五个占位块都进了弹窗 DOM', ddIds.every(id => !!$('#dlg #' + id)),
     ddIds.filter(id => !$('#dlg #' + id)).join(','));
  ok('v17详情：有吸顶小标题条 #dMini 与底部固定操作条 .ddock',
     !!$('#dlg #dMini') && !!$('#dlg .ddock'));
  ok('v17详情：底部条两个按钮都在（⬇ 下载与资源 / 关闭）',
     !!$('#dlg .ddock #ddToDl') && !!$('#dlg .ddock #ddClose'));
  ok('v17详情：块序 = 介绍 → 画廊 → 配置 → 下载（与工作台 paintDetail 一致）',
     win.eval("(function(){var b=document.getElementById('dlg').querySelector('.dbody');"
            + " var ids=Array.prototype.map.call(b.children,function(e){return e.id;});"
            + " return ids.indexOf('ddDesc') < ids.indexOf('ddGal') && ids.indexOf('ddGal') < ids.indexOf('ddReq')"
            + " && ids.indexOf('ddReq') < ids.indexOf('dlBlock');})()") === true);
  win.eval('closeDetail()');
  ok('v17详情：关窗后 DD_SEQ 作废（异步补水的回包再晚也不会写进下一款游戏）',
     win.eval("document.getElementById('dlg').innerHTML.trim()") === '');
  ok('v17详情：开弹窗时 `const seq = ++DD_SEQ`（本次会话号）',
     /const seq = \+\+DD_SEQ;/.test(code));
  ok('v17详情：关弹窗时把会话号作废（DD_SEQ++ —— 比 contains 检查更彻底的一道）',
     /dlSt = null;[\s\S]{0,260}DD_SEQ\+\+;/.test(code));
  ok('v17详情：ddSet 写前先验节点**还在文档里**（回包晚到时不会写进已销毁的弹窗）',
     /if \(!el \|\| !document\.body\.contains\(el\)\) return;/.test(code));
  ok('v17详情：探不到本机服务 ⇒ 整组占位**一次性摘掉**（静态部署零副作用，与 #dlBlock 同契约）',
     /DD_SLOTS\.forEach\(id => ddSet\(id, ''\)\)/.test(code));
  ok('v17详情：ddUrlOf 只认**详情页**三种候选（url/alt/jidiUrl —— postUrl 传进去服务端回 400）',
     /const cands = \[a\.url, a\.alt, a\.jidiUrl\];/.test(code));
  ok('v17详情：详情补水不共用下载会话的 base（dlJson 读 dlSt.base，故单开 ddJson(base,…)）',
     /async function ddJson\(base, path, ms\)/.test(code));
  ok('v17详情：画廊翻页抽成 ddGalGo（点箭头 / 点缩略图共用，索引夹在 [0,n-1]）',
     /function ddGalGo\(g, i\)\{[\s\S]{0,420}Math\.max\(0, Math\.min\(n - 1, i\)\)/.test(code));
  ok('v17详情：画廊**不做任何图片 URL 改写**（尺寸规则只存在于上游 fetchers/shots.js）',
     /const shots = \(det\.shots \|\| \[\]\)\.map/.test(code) && !/det\.shots[\s\S]{0,240}\.replace\(/.test(code));
  ok('v17详情：配置要求的字段序/标签与上游 REQ_ORDER / REQ_LABEL 对齐',
     win.eval("DD_REQ_ORDER.join(',')") === 'os,cpu,ram,gpu,dx,net,storage,note'
     && win.eval("JSON.stringify(DD_REQ_LABEL)") === '{"os":"系统","cpu":"CPU","ram":"内存","gpu":"显卡","dx":"DirectX","net":"网络","storage":"存储","note":"附注"}',
     win.eval("DD_REQ_ORDER.join(',')"));
  ok('v17详情：两套口径**不逐字段混搭**（最低恒来自源站，Steam 只补推荐那一栏）',
     /最低配置/.test(code) && /推荐配置/.test(code) && /det\.requirements && Object\.keys\(det\.requirements\)\.length/.test(code));
  ok('v17详情：问 Steam 补推荐配置时 cover 挑**带 appid 的那张**（源站封面没有 appid，直接问必然命中不到）',
     /const covs = \[a\.cover, a\.img, det\.cover\]\.filter\(Boolean\);/.test(code) && /steam\\\/apps/.test(code));
  ok('v17详情：「另一源收录」块直接用服务端的 merge.twin（前端不自己判 —— 同一语义不留两份实现）',
     /mg && mg\.on && mg\.twin && mg\.twin\.url/.test(code));
  ok('v17详情：并入的截图张数如实标注「含机地 N 张」（双源合并唯一可见的凭证）',
     /含\$\{esc\(DD_SRC_NM\[mg\.twin\.source\] \|\| '另一源'\)\} \$\{addN\} 张/.test(code));
  ok('v17详情：同分类更多走 /api/library/related 且带上 t/g（id 会漂移 ⇒ 靠名字与类型定位）',
     /'\/api\/library\/related\?t=' \+ encodeURIComponent\(nm\)/.test(code));
  ok('v17详情：同分类的结果点开走 openDetailRec（那些条目来自库、没有 Tab 坐标）',
     /if \(it\) openDetailRec\(it, 'lib'\);/.test(code));
  ok('v17详情：吸顶条用 onscroll **赋值**（弹窗反复重开，addEventListener 会一遍遍叠监听）',
     /dlgEl\.onscroll = \(\) => \{/.test(code));
  ok('v17详情：有 .pill.mg / .dgal / .dreq / .dmini / .ddock 五组新样式的落地',
     /\.dgal-vp\{/.test(code) && /\.dreq\{/.test(code) && /\.dmini\{/.test(code) && /\.ddock\{/.test(code));

  /* ──────────────────────────────────────────────────────────────────────
     (c) ★v17 顺带修掉的既有缺陷：DL_URL_RE 只认 xdgame.com，漏了实时库的 xdgamer.com
     ────────────────────────────────────────────────────────────────────── */
  ok('v17修复：DL_URL_RE 同时认 xdgame.com 与 xdgamer.com（实测两个域**并存**）',
     /xdgame\(\?:r\)\?\\\.com/.test(code));
  ok('v17修复：实时库（www.xdgamer.com）与该正则真的对得上',
     /^https?:\/\/(?:www\.)?(?:jidiyouxi\.com\/topic\/detail\/\d+|xdgame(?:r)?\.com\/game\/\d+\.html)/.test('https://www.xdgamer.com/game/16723.html')
     && /^https?:\/\/(?:www\.)?(?:jidiyouxi\.com\/topic\/detail\/\d+|xdgame(?:r)?\.com\/game\/\d+\.html)/.test('https://www.xdgamer.com/game/16723.html'.replace('xdgamer', 'xdgame')));

  /* ---------- 复位：OL 与 fetch 全清，绝不把打桩状态漏给页面 / 后续断言 ---------- */
  win.eval("window.fetch = window.__of; window.__of = null; window.__stub = null;"
           + " OL.base=''; OL.token=''; OL.dir='/转存'; OL.probed=false; OL.tried=false; OL.exp=false; OL.note='';"
           + " olRenderStatus(); goTab('home')");
  ok('v16H：复位后 olReady() 归假（打桩状态没有残留）', win.eval('olReady()') === false);

  /* ============================ §21 ★v18：管理页（独立窗口）+ 上游服务回读 ============================
     用户 2026-10-16 口径：「后续我想将工作台变成该 APP 的管理页面」，形态拍板「独立窗口」，
     关联深度拍板「双向」。本节的判据全部落在**能不能在无壳环境下安全存在**上 ——
     因为 demo 同时要跑在浏览器 / 线上静态部署里，那里**没有壳**。 */
  ok('v18管理页：入口 HTML 默认 `hidden`（先藏后显，绝不先闪出一个点了没反应的按钮）',
     /<a href="#" id="adminNav" hidden>/.test(code));
  ok('v18管理页：入口**不是** `data-tab`（它不是本页 Tab，绝不能被事件委托当成切页）',
     /id="adminNav"/.test(code) && !/id="adminNav"[^>]*data-tab/.test(code));
  ok('v18管理页：有壳判据用 `__SHELL_ADMIN__`（**v18 壳才有**），不是 `SHELL` —— '
     + '旧壳（v15/v16）没有它，用它判据会显示一个点了静默失败的按钮',
     /typeof window\.__SHELL_ADMIN__ === 'function'/.test(code)
     && !/if\(!SHELL\)\{ a\.hidden/.test(code));
  ok('v18管理页：无壳时整条 hidden 并 return（不留在半截状态）',
     /if\(!ADMIN_OPEN\)\{ a\.hidden = true; return; \}/.test(code));
  ok('v18管理页：点击先 preventDefault 再 `ADMIN_OPEN(\'toggle\')`（否则 href="#" 会把页面顶到顶部）',
     /e\.preventDefault\(\); ADMIN_OPEN\('toggle'\);/.test(code));
  ok('v18管理页：页面只往壳里传**动作名**，不传 URL / 路径（起始页由主进程决定）',
     /ADMIN_OPEN\('toggle'\)/.test(code) && !/ADMIN_OPEN\(\s*['"]\//.test(code));
  ok('v18管理页：↗ 提示用独立 `.ext` 类（`.cnt` 在 v16-A 后是 `display:none`，复用会连箭头一起藏掉）',
     /<span class="ext">↗<\/span>/.test(code) && /\.nav a \.ext\{/.test(code));

  ok('v18上游卡：只读 `/api/library/progress` 与 `/api/extract/history?n=6`（**不写上游**）',
     /'\/api\/library\/progress'/.test(code) && /'\/api\/extract\/history\?n=6'/.test(code));
  ok('v18上游卡：两个只读请求**并发**发（串行会让这页白等一趟 RTT）',
     /Promise\.all\(\[\s*ddJson\(base, '\/api\/library\/progress'[\s\S]{0,90}?ddJson\(base, '\/api\/extract\/history/.test(code));
  ok('v18上游卡：探不到本机服务 ⇒ **整卡摘掉**（与 ddHydrate 同一探测式契约，线上零副作用）',
     /if\(!base\)\{ card\.remove\(\); return; \}/.test(code));
  ok('v18上游卡：实例归属**三态照实说**（托管 / 外部 / 未知），不许「应该是我拉的吧」',
     /由 App 托管（本壳 fork 的）/.test(code) && /外部实例（App 只复用，不冒认）/.test(code)
     && /对方是旧版上游，health 里没有 pid/.test(code));
  ok('v18上游卡：「打开管理页」按钮同样**只在有壳时**渲染',
     /if\(btn && ADMIN_OPEN\)/.test(code));
  ok('v18上游卡：upFill 挂在 olBind 之后的同一处重渲染里（否则翻页后这张卡变成空壳）',
     /olBind\(main\);[\s\S]{0,420}?upFill\(main\);/.test(code));

  /* 行为级：状态只着色、不改写上游原话 —— 绿 / 红 / 无色三态，输入即上游的 state 原值 */
  const stc = ['done', 'error', 'need-password', 'running', '']
    .map(s => win.eval('upStateCls(' + JSON.stringify(s) + ')'));
  ok('v18上游卡：解压状态只做**着色**（done→绿 · error/need-password→红 · 其余无色），不改写上游原话',
     String(stc[0]) === 'done' && String(stc[1]) === 'bad' && String(stc[2]) === 'bad'
     && String(stc[3]) === '' && String(stc[4]) === '', JSON.stringify(stc));

  ok('v18上游卡：`upFill` 取卡必须用 `querySelector` —— **`Element` 上没有 `getElementById`**，'
     + '而调用处传的正是 `#main` 这个 Element（实拍抓出的 bug：抛 TypeError 被 async 吞掉，卡片永远「○ 探测中…」）',
     /const card = \(scope && scope\.querySelector\) \? scope\.querySelector\('#upcard'\)/.test(code)
     && !/\(scope \|\| document\)\.getElementById\('upcard'\)/.test(code));

  /* 行为级：无服务时整卡真的从 DOM 消失（不是靠人眼看源码「应该会删」） */
  win.eval("window.__ob = dlBoot; dlBoot = async () => '';"
         + " window.__mk = () => { const d = document.createElement('div'); d.id = 'upcard';"
         + " document.body.appendChild(d); return 1; }; window.__mk()");
  await win.eval('upFill(document)');
  const upGone = win.eval("!document.getElementById('upcard')");
  win.eval('dlBoot = window.__ob; window.__ob = null; window.__mk = null');
  ok('v18上游卡：**真跑一次** upFill —— 无本机服务时整卡从 DOM 里消失（不是靠源码推断）',
     upGone === true, String(upGone));

  /* ★★ 上面那条 bug 的**专门回归**：调用处传的是 `#main` 这个 **Element**，不是 `document`。
     原来那条行为断言传的是 `document` ⇒ 恰好绕开了 `Element` 上没有 `getElementById` 这个事实
     （**这就是它 692 条全绿、实拍却一眼看出的原因**）。
     ⇒ 这里用**真 Element 作用域**再跑一次：旧写法会抛 TypeError（卡片不被摘掉）⇒ 立刻变红。 */
  win.eval("window.__ob2 = dlBoot; dlBoot = async () => '';"
         + " window.__wrap = document.createElement('div');"
         + " const d2 = document.createElement('div'); d2.id = 'upcard';"
         + " window.__wrap.appendChild(d2); document.body.appendChild(window.__wrap);");
  let elemOk = true;
  try { await win.eval('upFill(window.__wrap)'); } catch (e) { elemOk = false; }
  const elemGone = win.eval("!document.getElementById('upcard')");
  win.eval('dlBoot = window.__ob2; window.__ob2 = null;'
         + ' if(window.__wrap && window.__wrap.remove) window.__wrap.remove(); window.__wrap = null');
  ok('v18上游卡：作用域传**真 Element**（就是调用处的 `#main`）时也必须能摘卡 —— '
     + '旧写法在 Element 上取 `getElementById` 会抛 TypeError 被 async 吞掉（实拍抓出的那个 bug 的回归）',
     elemOk && elemGone === true, 'elemOk=' + elemOk + ' gone=' + elemGone);

  /* ★v18：壳的上游端口**不是常量** —— `server.js` 的 `listen(port, triesLeft)` 在端口被占时
     会自动 +1，`GAMEHUB_PORT` 也能被外部改；而情报站是从**包内 file://** 直开的。
     只认死 8123 就会去敲**别人的实例**（或干脆敲不通），自己壳里那个上游反倒没人读。 */
  ok('v18端口：`dlBoot` 把壳自述的 `listenPort` 排在候选**最前**（否则壳端口一漂就去读别人的实例）',
     /SHELL && typeof SHELL\.describe === 'function'[\s\S]{0,200}?const lp = d && Number\(d\.listenPort\);[\s\S]{0,90}?cands\.push\('http:\/\/127\.0\.0\.1:' \+ lp\);/.test(code));
  ok('v18端口：取不到壳自述时**原样退回**老候选（无壳 / 旧壳路径零影响）',
     /cands\.push\(location\.origin\)[\s\S]{0,1400}?cands\.push\('http:\/\/127\.0\.0\.1:8123'\)/.test(code));

  /* ==================== §22 ★v19：下载引擎预留（磁力链接线位） ====================
     用户口径（2026-10-22）：「将页面的内容以及后台管理页面都优化，以及接口调用（管理页面）预留，
                               后续我将接入磁力链下载」。
     ⇒ 本轮**不装引擎**，只定契约。断言分两层：
        · 源码级：契约存在、顺序对、页面**碰不到** RPC 细节（安全判据）；
        · 行为级：jsdom 无壳 ⇒ 引擎卡如实说「需桌面版」、磁力入口**整块不渲染**。 */

  ok('v19引擎：`dlEngineHTML` / `dlMagnetHTML` / `dlEngineProbe` / `dlEngineBind` / `dlMagnetBind` 五个都在',
     /function dlEngineHTML\(/.test(code) && /function dlMagnetHTML\(/.test(code)
     && /async function dlEngineProbe\(/.test(code) && /function dlEngineBind\(/.test(code)
     && /function dlMagnetBind\(/.test(code));

  /* ★ 安全判据（最重要的一条）：引擎的 RPC 细节**一个字都不许进页面**。
     aria2 的 `dir` 能指任何路径 ⇒ secret / 监听参数只要进得来页面，
     就等于把「往任意目录写文件」这个能力交给了可能被注入的页面上下文。 */
  ok('v19引擎：页面里没有 jsonrpc / rpc-secret / rpc-listen 任何字样（secret 与 RPC 参数绝不进页面上下文）',
     !/jsonrpc/i.test(code) && !/rpc-secret/i.test(code) && !/rpc-listen/i.test(code));
  ok('v19引擎：页面只通过 SHELL.dlMagnetPreview / SHELL.dlEngine 调引擎（走 preload 白名单，不自己发 HTTP）',
     /SHELL\.dlMagnetPreview\(/.test(code) && /SHELL\.dlEngine\(/.test(code));

  ok('v19引擎：dlMagnetHTML 在没有壳时直接返回空串（浏览器 / 线上静态部署不留一个注定失败的入口）',
     /function dlMagnetHTML\(\)\{\s*if\(!HAS_SHELL\) return '';/.test(code));

  /* ★v23 口径变更（**有意**）：引擎卡不再平铺在列表之前，而是收进折叠区；
     但「状态永远可见」这个诉求没变 —— 改成折叠头那行常驻显示（`dlSumText()`）。 */
  ok('v23精简：磁力入口仍在任务列表**之前**（这页的主体动作是「加任务」，列表是结果）',
     /main\.innerHTML = phHead\('下载管理'[\s\S]{0,200}?\+ dlMagnetHTML\(\) \+ body/.test(code));
  ok('v23精简：引擎状态挪到**折叠头常驻**那行（不点开也能看到版本 / 速度 / 活动数）',
     /function dlSumText\(\)/.test(code) && /id="dlsumtext"/.test(code)
     && /st\.textContent = dlSumText\(\)/.test(code));

  /* ★ 「预留」的诚实性判据：必须按 code 分流，不能笼统报「解析失败」——
     否则用户会以为是自己的磁力链坏了，而不是「引擎还没接」。 */
  ok('v19引擎：按 code 分流回执（engine-not-ready → 引擎未接入（预留）），不是笼统「解析失败」',
     /code === 'engine-not-ready'[\s\S]{0,160}?引擎未接入/.test(code));
  ok('v19引擎：明确告知网盘分享页不是磁力链、引擎也打不开（避免用户拿迅雷分享页来试）',
     /网盘分享页/.test(code) && /magnet:\\\?\/i\.test\(mg\)/.test(code));

  /* ★ 这条是本轮**自己踩出来**的：dlEngineProbe() 无壳时立即短路、不重画，
     若 DLENG 初值仍是 idle，徽标会永远停在「○ 待检测」—— 假状态比没有更糟。 */
  ok("v19引擎：DLENG 初值按 HAS_SHELL 定（无壳直接 'noshell'），否则首帧会永远停在「待检测」假状态",
     /const DLENG = \{ state: HAS_SHELL \? 'idle' : 'noshell'/.test(code));
  ok('v19引擎：探测有 state === idle 闸门 —— 首次进入这一页才 spawn 一次 aria2c --version，不是每页都探',
     /if\(DLENG\.state === 'idle'\) dlEngineProbe\(\);/.test(code));

  /* ---- 行为级：无壳降级（这也是线上 demo 的真实形态）---- */
  win.eval("goTab('downloads')");
  const engCard = win.eval("String(!!document.getElementById('engcard'))");
  ok('v19引擎：下载页真的渲染出引擎卡（行为级，不是源码推断）', engCard === 'true', engCard);
  const engDesc = win.eval("String((document.getElementById('engdesc')||{}).textContent||'')");
  ok('v19引擎：无壳时引擎卡如实说「需桌面版」，不假装在探测',
     /需桌面版/.test(engDesc), engDesc.slice(0, 70));
  const engBadge = win.eval("String((document.getElementById('engbadge')||{}).textContent||'')");
  ok('v19引擎：无壳时徽标是「— 需桌面版」，不是「○ 待检测」或「探测中」',
     /需桌面版/.test(engBadge), engBadge);
  const mgCard = win.eval("String(!!document.getElementById('mgcard'))");
  ok('v19引擎：无壳时磁力入口整块不渲染（#mgcard 不存在 —— 不出点了必然失败的按钮）',
     mgCard === 'false', mgCard);
  const engState = win.eval("String(DLENG.state)");
  ok("v19引擎：无壳时 DLENG.state 被短路成 'noshell'", engState === 'noshell', engState);

  /* ---- §22.2 引擎接入后：页面这一侧真正跑起来的东西 ---- */
  ok('v19磁力：`startMagnet` / `mgSelPaint` 都存在', /function startMagnet\(/.test(code) && /function mgSelPaint\(/.test(code));
  ok('v19磁力：走的是**同一个** `SHELL.startDownload`（一个入口两个后端，页面不判断谁在干）',
    /SHELL\.startDownload\(\{ id: j\.id, url: mg, name: j\.name, selectFile:/.test(code));
  ok('v19磁力：把勾选结果编成 aria2 的 `select-file`（1 基、逗号分隔）',
    /selectFile: \(idxs \|\| \[\]\)\.join\(','\)/.test(code));
  ok('v19磁力：文件清单是**可勾选**的（`.mgcb` + 每行一个 `data-mgidx`）',
    /class="mgcb" data-mgidx=/.test(code));
  ok('v19磁力：一个文件都没勾时「开始下载」必须是 disabled（不出必然失败的操作）',
    /b\.disabled = !on\.length/.test(code));
  ok('v19磁力：磁力任务在列表里有自己的图标（🧲，不与网盘 ☁️ 混）',
    /j\.kind === 'magnet' \? '🧲'/.test(code));
  ok('v19磁力：暂停 / 继续按钮**只在** `engine === \'aria2\'` 的任务上渲染（内置下载器做不到）',
    /j\.state === 'running' && j\.engine === 'aria2'[\s\S]{0,120}data-dlpause/.test(code)
    && /j\.state === 'pause' && j\.engine === 'aria2'[\s\S]{0,120}data-dlresume/.test(code));
  ok('v19磁力：点击委托同时收了 `data-dlpause` / `data-dlresume`（漏一个就是死按钮）',
    /\[data-dlpause\],\[data-dlresume\]/.test(code));
  ok('v19引擎：就绪时描述里带**实时速度 / 活动数**（来自 dlStats 的全局统计）',
    /DLENG\.stats[\s\S]{0,200}fmtBytes\(Number\(s\.speed\)/.test(code));
  /* ★ 实拍抓出的第 2 个「状态不同步」问题：徽标已「已解析 1 个文件」，
     说明文字却还挂着「引擎未接入前…」—— 因为首帧是在探测完成前渲染的。
     ⇒ 提示必须在 `dlEnginePaint()` 里跟着状态改。 */
  ok('v19引擎：`mghint` 提示文案在 paint 里跟着状态改（否则会与徽标自相矛盾）',
    /getElementById\('mghint'\)/.test(code) && /hint\.innerHTML = \(DLENG\.state === 'ready'\) \? ''/.test(code));
  ok('v19引擎：paint **不许**冲掉「已解析 N 个文件」徽标（只在「预留/可解析」之间切）',
    /mb\.textContent === '预留' \|\| mb\.textContent === '可解析'/.test(code));

  /* 行为级：无壳时点「开始下载」不该假装在跑 —— 必须落到 manual 并说清原因 */
  const mgJob = win.eval("(function(){ var j = startMagnet('magnet:?xt=urn:btih:7ACF8FB590B2060DD9C3146EF770169D593433B0', [1], 't'); return String(j.state + '|' + j.kind + '|' + (j.err||'')); })()");
  ok('v19磁力：**无壳**时起磁力任务 ⇒ 落到 manual 并说清原因（不假装在下载）',
    /^manual\|magnet\|/.test(String(mgJob)), String(mgJob));

  /* ==================== §23 ★v20：借鉴迅雷游戏助手的四项 ====================
     ① Tab 记忆  ② 桌面禁选中  ③ 斜切角（CSS 画，不用素材）  ④ 拖拽区防回归 */
  ok('v20记忆：`TABMEM` / `tabMemSave` / `tabMemRestore` 三件套都在',
    /const TABMEM = \{\}/.test(code) && /function tabMemSave\(/.test(code) && /function tabMemRestore\(/.test(code));
  ok('v20记忆：`goTab` **不再**无条件 `resetState(tab)`（改成先存后取）',
    /function goTab\(tab\)\{[\s\S]{0,500}?tabMemSave\(\)/.test(code)
    && !/function goTab\(tab\)\{[\s\S]{0,500}?resetState\(tab\);/.test(code));
  ok('v20记忆：再点当前 tab 走 `same` 分支（回顶部，但不复位 kw/fx）',
    /const same = \(tab === cur\)/.test(code)
    && /if\(same\)\{[\s\S]{0,120}?\}else\{[\s\S]{0,80}?y = tabMemRestore\(tab\)/.test(code));
  ok('v20记忆：保存的是 `kw` / `fx`（Set 转数组）/ `sort` / `scroll` 四项',
    /TABMEM\[cur\] = \{ kw: kw, fx: fxCopy, sort: sortK, scroll:/.test(code)
    && /for\(const k of Object\.keys\(fx \|\| \{\}\)\) fxCopy\[k\] = Array\.from/.test(code));

  ok('v20手感：桌面形态**禁选中**，但详情弹窗与输入框放开（否则复制不了游戏介绍）',
    /html\.has-shell \.body\{user-select:none\}/.test(code)
    && /html\.has-shell \.dlg,[\s\S]{0,90}?user-select:text/.test(code));
  ok('v20手感：斜切角用 `clip-path` 画 —— **不引入任何素材**（迅雷用的是 PNG，我们不用它的图）',
    /clip-path:polygon\(0 0, calc\(100% - 14px\) 0, 100% 14px/.test(code) && !/chamfer/.test(code));
  /* ★ 实拍抓出的「放错位置」：一开始把斜切角也给了 `.dlg`（详情抽屉），
     但抽屉**整屏高** ⇒ 切掉的右上角正好在系统窗口按钮那一带，两张实拍都看不出来，
     还会压到右上角来源胶囊。⇒ 只给「四角都在视野里」的面板卡（`.olcard`）。
     这条断言锁住「别再给 .dlg 加 clip-path」。 */
  ok('v20手感：斜切角**不给 `.dlg`**（整屏高的抽屉切在窗口角上，看不见还会压胶囊）',
    !/html\.has-shell \.dlg\{[^}]*clip-path/.test(code));
  ok('v20手感：拖拽区 `no-drag` 覆盖 button / a / input（否则顶栏按钮在 exe 里点不动 —— 这类 bug 静默且致命）',
    /\.topbar button,[\s\S]{0,60}?\.topbar a,[\s\S]{0,60}?\.topbar input\{-webkit-app-region:no-drag\}/.test(code));

  /* 行为级：切走再切回，搜索词必须还在；再点同一个 tab 则**不从记忆恢复** */
  const memTest = win.eval(`(function(){
    goTab('pcMod'); kw = 'zzz-mem-test';
    goTab('home'); goTab('pcMod');
    var restored = kw;
    kw = ''; goTab('pcMod');
    return JSON.stringify({ restored: restored, afterSameTab: kw });
  })()`);
  let memObj = {};
  try { memObj = JSON.parse(String(memTest)); } catch (e) { memObj = { raw: String(memTest) }; }
  ok('v20记忆：**行为级** —— 切走再切回，搜索词被恢复',
    memObj.restored === 'zzz-mem-test', String(memTest));
  ok('v20记忆：**行为级** —— 再点同一个 tab 不从记忆恢复（定位 ≠ 重置）',
    memObj.afterSameTab === '', String(memTest));

  /* ==================== §24 ★v21：资源块改「精确索引键」，修「网页有、客户端没有」 ====================
     根因：上游内部索引键是 **`L:<libId>`**（实测 `L:xd-191` → mod 717 条 / 5ms），
     而我们是**按游戏名模糊匹配**（实测 trainers：按名 3 条、按键 22 条）。
     ⇒ 两条路都保留：键优先，取不到/为 0 就静默回落按名匹配。 */
  ok('v21资源：`dlCtxOf` 产出 `L:<resId|libId>` 精确键（列表叫 resId、匹配结果叫 libId，两种都认）',
    /const rid = String\(\(a && \(a\.resId \|\| a\.libId\)\) \|\| ''\)\.trim\(\)/.test(code)
    && /return \{ name: nm, url: url, key: rid \? \('L:' \+ rid\) : '' \}/.test(code));
  ok('v21资源：Mod 页签**精确键优先**（`/api/res/items?cat=mod&key=`）',
    /const cat = \(kind === 'modifier'\) \? 'trainers' : 'mod'/.test(code)
    && /'\/api\/res\/items\?cat=' \+ cat \+ '&key=' \+ encodeURIComponent\(key\)/.test(code));
  /* ⚠️ 断言不能引用注释（`code` 是去注释后的源码）⇒ 按**调用顺序**判：
        `dlFetchMods` 里必须先出现 `/api/res/items`，后出现 `/api/mods/match`（回落）。 */
  const modsFnBody = (code.match(/async function dlFetchMods\([\s\S]*?\n\}/) || [''])[0];
  ok('v21资源：`dlFetchMods` 里**键优先、按名兜底**（res/items 出现在 mods/match 之前，且两者都在）',
    /\/api\/res\/items\?cat=/.test(modsFnBody) && /\/api\/mods\/match\?t=/.test(modsFnBody)
    && modsFnBody.indexOf('/api/res/items') < modsFnBody.indexOf('/api/mods/match'),
    'len=' + modsFnBody.length);
  ok('v21资源：修改器页签仍保留**两段**（社区帖按名 + trainers 走键）',
    /posts = \(j && j\.items\) \|\| \[\]/.test(code) && /trainers: items, exact: true/.test(code));
  ok('v21资源：存档也**键优先**（`cat=saves`），且「存档位置」仍按名查（它没有 libId 键）',
    /'\/api\/res\/items\?cat=saves&key='/.test(code) && /saves-yx\/match/.test(code) && /saves\/match/.test(code));
  ok('v21性能：载入文案**分页签** —— 「本体」那栏要说明约 5~10 秒并提示可先看别的栏',
    /st\.tab === 'body'\)[\s\S]{0,160}?约 5~10 秒/.test(code));

  /* 行为级：精确键的推导（两种字段名 + 无键时留空） */
  const ctxT = win.eval(`JSON.stringify([
    dlCtxOf({ resId: 'xd-191', title: '赛博朋克2077/Cyberpunk 2077' }),
    dlCtxOf({ libId: 'jidi-1', game: '剑星' }),
    dlCtxOf({ title: '无键的游戏' })
  ])`);
  let ctxArr = [];
  try { ctxArr = JSON.parse(String(ctxT)); } catch (e) { ctxArr = []; }
  ok('v21资源：**行为级** —— `resId` 推导出 `L:xd-191`，且名字按 `/` 切成「赛博朋克2077」',
    ctxArr[0] && ctxArr[0].key === 'L:xd-191' && ctxArr[0].name === '赛博朋克2077', String(ctxT));
  ok('v21资源：**行为级** —— `libId` 也认（`L:jidi-1`），`game` 字段优先于 `title`',
    ctxArr[1] && ctxArr[1].key === 'L:jidi-1' && ctxArr[1].name === '剑星', String(ctxT));
  ok('v21资源：**行为级** —— 没有 id 字段时 key 为空串（下游才会走按名匹配）',
    ctxArr[2] && ctxArr[2].key === '', String(ctxT));

  /* ==================== §25 ★v22：网盘「转存 → 取直链 → 交给引擎」串成一条链 ====================
     背景（实测）：上游 `/api/download` 给的 **192/192 全是网盘分享页**，aria2 打不开。
     唯一能落地的形态 = 让 OpenList 转存并产出 `raw_url`，我们负责下。 */
  const chain = (code.match(/async function olChainToEngine\([\s\S]*?\n\}/) || [''])[0];
  /* ⚠️ 锚点要用**真正的调用点** `SHELL.startDownload({`：
     函数开头的守卫里也出现过 `SHELL.startDownload` 字样，用它判顺序会假阴性。 */
  ok('v22网盘：`olChainToEngine` 存在且**四步齐**（olTransfer 转存 → 列目录 → 取直链 → 交给引擎）',
    chain.length > 0
    && chain.indexOf('olTransfer(') >= 0
    && chain.indexOf("'/api/fs/list'") > chain.indexOf('olTransfer(')
    && chain.indexOf("'/api/fs/get'") > chain.indexOf("'/api/fs/list'")
    && chain.indexOf('SHELL.startDownload({') > chain.indexOf("'/api/fs/get'"),
    'len=' + chain.length + ' call=' + chain.indexOf('SHELL.startDownload({') + ' get=' + chain.indexOf("'/api/fs/get'"));
  ok('v22网盘：轮询用 `refresh:true`（不刷新会读到 OpenList 的缓存列表，永远等不到新文件）',
    /refresh:true/.test(chain));
  ok('v22网盘：`raw_url` 必须过协议校验，拿不到就如实报「驱动可能不支持直链」',
    chain.indexOf('raw_url') >= 0 && chain.indexOf('test(raw)') >= 0
    && /不支持直链/.test(chain));
  ok('v22网盘：`header` **原样透传**（OpenList 给什么带什么，不自己编 UA/Cookie）',
    /header: String\(dd\.header \|\| ''\) \|\| undefined/.test(chain));
  ok('v22网盘：浏览器（无壳）时不死 —— 回 `submitted:true` 并说明「无法接力下载」',
    /submitted:true/.test(chain) && /浏览器没有下载引擎/.test(chain));
  ok('v22网盘：轮询上限 `OL_POLL_MS` 是变量（测试可缩短，不用真等 90 s）',
    /let OL_POLL_MS = 90000/.test(code));
  ok('v22网盘：转存按钮文案随引擎状态变（引擎就绪 ⇒「转存并下载」，否则「转存到网盘」）',
    /DLENG\.state === 'ready' \? '转存并下载' : '转存到网盘'/.test(code));
  ok('v22网盘：按钮走链条而不是只转存（委托里调 `olChainToEngine`）',
    /olChainToEngine\(url, nm\)\.then/.test(code));

  /* ==================== §26 ★v23：下载页精简 + 历史可看/可删 ====================
     用户口径：「现在的下载管理有点复杂，精简下，其次历史为什么不能删，或者查看」。 */
  ok('v23精简：折叠态记在 `DLSET_OPEN`（翻页/清空后不会被 `<details>` 自己收起来）',
    /let DLSET_OPEN = false/.test(code) && /ds\.addEventListener\('toggle'/.test(code));
  ok('v23精简：折叠头是**状态条**（引擎版本 / 速度 / 活动数不点开也可见）',
    /function dlSumText\(\)/.test(code) && /下载引擎就绪[\s\S]{0,120}?fmtBytes\(Number\(s\.speed\)/.test(code));

  /* ★ 这条是**真 bug 修复**：改前「清空已完成」把所有非 running/waiting 的都清掉，
     连 `manual`（需你手动转存、身上带着分享链接的）一起没了 —— 等于把你还没处理的线索删了。 */
  ok('v23删：`清空已完成` **只清 done / fail**，绝不动 `manual`（那还是待处理的线索）',
    /DL_JOBS = DL_JOBS\.filter\(j => !\(j\.state === 'done' \|\| j\.state === 'fail'\)\)/.test(code));
  ok('v23删：每个已完成/失败任务都有**单条「移除」**（`data-dlremove`）',
    /data-dlremove="\$\{j\.id\}">移除/.test(code)
    && /\(j\.state === 'done' \|\| j\.state === 'fail'\) \? `<button[^`]{0,80}data-dlremove/.test(code));
  /* ★v24：传 **gid 优先** —— 重启后主进程的 `gidAlias` 是空的，
     传页面自己的 id 主进程查不到 gid，引擎里那条就删不掉。 */
  ok('v23删：移除时**同时**把它从引擎里删掉（否则下次 dl-list 又冒出来），且 gid 优先',
    /SHELL\.dlRemove\(job\.gid \|\| job\.id\)/.test(code));
  ok('v23看：已完成任务可「复制路径」（比复制网盘分享链有用）',
    /data-dlpath="\$\{j\.id\}">复制路径/.test(code) && /SHELL\.copyText\(job\.dest \|\| ''\)/.test(code));

  /* 解压历史：可看 + 说明为什么不能删 */
  ok('v23看：解压历史每行可「打开」（`data-exopen` → 上游 `POST /api/extract/open`）',
    /data-exopen="' \+ esc\(it\.dir\)/.test(code) && /upPost\(base, '\/api\/extract\/open', \{ dir: d \}/.test(code));
  ok('v23看：上游拒绝时**不静默** —— 复制路径 + 贴上游原话（该接口只允许打开解压目录内）',
    /SHELL\.copyText\(d\)/.test(code) && /打不开，路径已复制/.test(code));
  ok('v23删：历史区**如实写明**不能删（上游 0 条 DELETE 路由），不假装能删',
    /上游没有删除接口/.test(code) && /0 条 DELETE 路由|没有提供删除接口/.test(code));

  ok('v23精简：页脚那段 5 段**实现说明**也收进折叠（默认只占一行，内容一字未删）',
    /<details class="footfold">/.test(code) && /\.footfold>summary\{cursor:pointer/.test(code));

  /* ==================== §27 ★v24：任务表持久化 + 与引擎对账 ====================
     改前 `DL_JOBS` 只在内存 ⇒ 重启就空；而 aria2 的 session 是存盘的（引擎记得、界面忘了）。 */
  ok('v24持久化：`gi-dljobs` / 上限 200 / 读存三件套齐',
    /const DLJOB_KEY = 'gi-dljobs'/.test(code) && /const DLJOB_MAX = 200/.test(code)
    && /function dlJobsSave\(/.test(code) && /function dlJobsLoad\(/.test(code));
  ok('v24持久化：只落**字段白名单**（不 `JSON.stringify` 整个对象，避免把 `_ls` 之类内部字段写进去）',
    /const keep = \(DL_JOBS \|\| \[\]\)\.slice\(0, DLJOB_MAX\)\.map\(j => \(\{/.test(code)
    && /gid:j\.gid, at:j\.at,/.test(code));
  ok('v24持久化：**只在状态变化时**写（`dlJobTouch` 比对 `_ls`），且进度回调确实调了它',
    /function dlJobTouch\(j\)\{[\s\S]{0,120}?if\(j\._ls === j\.state\) return;/.test(code)
    && /Object\.assign\(j, patch\);[\s\S]{0,140}?dlJobTouch\(j\);/.test(code));
  ok('v24持久化：读入**必须有 try/catch**（localStorage 坏了不能把启动搞挂）',
    /function dlJobsLoad\(\)\{[\s\S]{0,700}?catch\(e\)\{[\s\S]{0,200}?return 0;/.test(code));
  ok('v24持久化：`dlJobsLoad()` 在首次 `render()` **之前**（否则侧栏计数先按 0 画一次）',
    code.indexOf('dlJobsLoad();') > 0 && code.indexOf('dlJobsLoad();') < code.indexOf('\nrender();'));

  /* ★ 这条是**实拍抓出来的真 bug**：一开始把对账挂在 `renderDownloads()` 末尾（判 state==='ready'），
     但渲染发生时 probe 才刚发起、状态还是 'probing' ⇒ 那次判断永远为假，对账一次都没跑过
     （实测 dump 出 `RECON=false`）。⇒ 必须挂到 probe **判完状态之后**。 */
  ok('v24对账：在 `dlEngineProbe` 判完状态**之后**触发（挂在渲染末尾时永远为假 —— 实测抓过）',
    /DLENG\.state = \(r && r\.ok && r\.engine && r\.engine\.available\) \? 'ready' : 'none'[\s\S]{0,1000}?if\(DLENG\.state === 'ready' && !DL_RECONCILED\) dlReconcile\(\)/.test(code));
  ok('v24对账：**以引擎为准**（用引擎的 state/got/total/dest 覆盖界面）',
    /if\(t\.state && t\.state !== j\.state\)\{ j\.state = t\.state; changed = true; \}/.test(code)
    && /if\(t\.dest\) j\.dest = t\.dest;/.test(code));
  ok('v24对账：界面上有、引擎里**没有**的 ⇒ 标 fail 并写明原因（不假装还在下）',
    /重启后未在引擎中找到该任务（可能已被清理）/.test(code));
  ok('v24对账：引擎里有、界面没有的 ⇒ 补一条（上次运行留下的）',
    /if\(DL_JOBS\.some\(j => String\(j\.url \|\| ''\) === String\(t\.url\)/.test(code));

  /* 行为级：连续三次同状态调用只应写一次，状态真变了再写一次 ⇒ 共 2 次 */
  const touchN = win.eval(`(function(){
    var n = 0; var orig = dlJobsSave;
    dlJobsSave = function(){ n++; };
    var j = { state: 'running' };
    dlJobTouch(j); dlJobTouch(j); dlJobTouch(j);
    j.state = 'done'; dlJobTouch(j);
    dlJobsSave = orig;
    return n;
  })()`);
  ok('v24持久化：**行为级** —— 同状态连打 3 次只写 1 次，状态变更后再写 1 次（共 2 次）',
    Number(touchN) === 2, 'n=' + String(touchN));

  console.log('==========================================');
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach(f => console.log('  ✗ ' + f)); }
  else console.log('全部通过 ✓');
  console.log('==========================================');
  process.exit(fail ? 1 : 0);
})();
