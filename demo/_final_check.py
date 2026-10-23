# -*- coding: utf-8 -*-
"""v10 收尾整体验证 —— 用真实 file:// 直开 index.html（**不内联 data.js**，
保持与用户双击打开完全一致的加载路径），确认：
  1) <head> 同步脚本生效：默认主题 = dark，且 <html> 上真的有该属性
  2) 无 JS 报错（捕获 window.onerror）
  3) 页面真的渲染出来了（侧栏链接 / 卡片数 / 4 个榜非 0）
  4) 侧栏各分组计数非 0（防「渲染成功但数据为空」的假绿）
  5) 主题切换按钮存在、文案与当前主题一致、且写回 localStorage
  6) ★v10 排行榜：4 个榜 / 固定 2 列 / **不挂搜索与筛选** / 行 data-d 跨 Tab
  7) ★v10 首页精选块：固定 5 列 × 每块 10 张（列数与卡片数配对，才不会有孤行）
  8) ★v10 MOD：卡片挂「机地」来源标签 / 无死筛选 / 弹窗「原帖 + 游戏页」两个不同链接

为什么不能只用 jsdom：jsdom 不加载 data.js 之外的远程图片、也不跑真实布局，
`getComputedStyle(...).gridTemplateColumns` 这类**列数**断言只有真浏览器说了算。
"""
import io, os, re, subprocess, sys

DIR = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe"
OUT = os.environ.get('SHOT_DIR', r"C:/Users/komo/.wb-shot")

src = io.open(os.path.join(DIR, 'index.html'), encoding='utf-8').read()

# 真实结构（实测，不是猜的）：侧栏 = <nav class="nav"> 里的 <a data-tab="...">，
# 每项带 <span class="cnt" id="c-<tab>"> 计数槽；排行榜只在 pcRank tab 渲染。
DIAG = """
<script>
window.__err = [];
window.addEventListener('error', function(e){ window.__err.push(String(e.message)); });
window.addEventListener('load', function(){
  setTimeout(function(){
    var o = [];
    var de = document.documentElement;
    o.push('THEME=' + de.getAttribute('data-theme'));
    o.push('ERR=' + JSON.stringify(window.__err));
    var tb = document.getElementById('themeBtn');
    o.push('THEMEBTN=' + (tb ? tb.textContent.trim() : 'MISSING'));
    /* 主题切换真的生效？（改属性 → 断言属性变化 → 还原） */
    if (tb) {
      var t0 = de.getAttribute('data-theme');
      tb.click();
      var t1 = de.getAttribute('data-theme');
      tb.click();
      var t2 = de.getAttribute('data-theme');
      o.push('THEMEFLIP=' + t0 + '->' + t1 + '->' + t2);
      o.push('THEMELS=' + (function(){ try{ return String(localStorage.getItem('gi-theme')); }catch(e){ return 'ERR'; } })());
    }
    /* 侧栏 */
    var navs = document.querySelectorAll('nav.nav a[data-tab]');
    o.push('NAVLINK=' + navs.length);
    var raw = [], filled = 0, withCnt = 0;
    [].forEach.call(navs, function(a){
      var c = a.querySelector('.cnt');
      raw.push(a.getAttribute('data-tab') + '=' + (c ? c.textContent.trim() : '?'));
      if (c) { withCnt++; if (c.textContent.trim() !== '-' && c.textContent.trim() !== '') filled++; }
    });
    o.push('NAVCNT=' + raw.join(','));
    /* 注意：「首页」按设计**不带**计数槽（实测 index.html:783 无 .cnt）⇒ 分母只算带槽的项 */
    o.push('NAVFILLED=' + filled + '/' + withCnt);
    /* 默认 tab 主区 */
    o.push('MAINCARDS=' + document.querySelectorAll('#main .cv, #main .mth, #main .rth').length);
    o.push('SLIDES=' + document.querySelectorAll('#main #heroSlides .hslide').length);
    o.push('HSIDE=' + document.querySelectorAll('#main #heroSide .hsitem').length);
    /* 切到排行 tab，再数榜（排行榜只在 pcRank 渲染） */
    try {
      resetState('pcRank'); render();
      o.push('RANKBOARD=' + document.querySelectorAll('#main .rankboard').length);
      o.push('RANKROW=' + document.querySelectorAll('#main .rankboard .rrow').length);
      /* ★v10：4 个榜 ⇒ 固定 2 列 */
      var cols = getComputedStyle(document.querySelector('#main .rankboards')).gridTemplateColumns;
      o.push('RANKCOLS=' + cols.split(' ').length + ' [' + cols + ']');
      /* ★v10：本页**不该有**搜索框与筛选按钮（filter-bar / #kw / .tg 三样都要为 0） */
      o.push('RANKFILTER=' + document.querySelectorAll('#main .filter-bar').length +
             '/' + (document.getElementById('kw') ? 1 : 0) +
             '/' + document.querySelectorAll('#main .tg').length);
      /* 比例条仍应为 0；.rpill 在 v10 复用为「热度口径标签」，应只出现在手机两榜（12+12=24） */
      o.push('RANKDEAD=' + document.querySelectorAll('#main .rrow .rbarwrap').length +
             '/' + document.querySelectorAll('#main .rrow .rpill').length);
      /* 每个榜首行的 data-d 应依次是 pcNew / pcHot / mNew / mNew（跨 Tab 取数） */
      o.push('RANKTAB=' + [].map.call(document.querySelectorAll('#main .rlist'), function(l){
        var r = l.querySelector('.rrow'); return r ? r.getAttribute('data-d') : '?'; }).join(','));
    } catch(e) { o.push('RANKBOARD=ERR ' + e.message); }
    /* ★v10：首页精选块 —— 固定列数 + 每块卡片数必须与列数配对（否则出现孤行） */
    try {
      resetState('home'); render();
      o.push('HOMEPC=' + [].map.call(document.querySelectorAll('#main .hseclist.pc'), function(s){
        return s.querySelectorAll('.card').length; }).join(','));
      o.push('HOMEMB=' + [].map.call(document.querySelectorAll('#main .hseclist.mb'), function(s){
        return s.querySelectorAll('.mcard').length; }).join(','));
      o.push('HOMECOLS=' + (function(){
        var s = document.querySelector('#main .hseclist.pc'); if(!s) return 'NONE';
        var g = getComputedStyle(s).gridTemplateColumns;
        return g.split(' ').length + ' [' + g + ']';
      })());
    } catch(e) { o.push('HOMEPC=ERR ' + e.message); }
    /* ★v10：MOD —— 卡片来源标签 + 无死筛选 + 弹窗双链接 */
    try {
      resetState('pcMod'); render();
      o.push('MODTAG=' + [].map.call(document.querySelectorAll('#main .card .tag'), function(t){
        return t.textContent.trim(); }).slice(0, 3).join(','));
      o.push('MODTG=' + document.querySelectorAll('#main .filter-bar .tg').length);
      var mc = document.querySelector('#main .card');
      if (mc) {
        mc.click();
        var dl = document.querySelectorAll('#dlg .dlinks a');
        o.push('MODLINKS=' + dl.length + '|' + [].map.call(dl, function(a){
          return a.textContent.trim() + '>' + (a.getAttribute('href') || '').replace(/^https?:\/\//, '').slice(0, 26); }).join(' + '));
        closeDetail();
      } else { o.push('MODLINKS=NOCARD'); }
    } catch(e) { o.push('MODTAG=ERR ' + e.message); }
    /* 切到手机新游，看 tab 仍能正常渲染（改主题不重建 DOM） */
    try {
      resetState('mNew'); render();
      o.push('MNEW=' + document.querySelectorAll('#main .mth').length);
    } catch(e) { o.push('MNEW=ERR ' + e.message); }
    var pre = document.createElement('pre'); pre.id = 'FINALCHECK';
    pre.textContent = o.join('\\n');
    document.body.appendChild(pre);
  }, 2200);
});
</script>
"""

page = src.replace('</body>', DIAG + '\n</body>')
tmp = os.path.join(DIR, '_final_check_tmp.html')
io.open(tmp, 'w', encoding='utf-8').write(page)

args = [CHROME, '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--allow-file-access-from-files', '--window-size=1400,1500',
        '--virtual-time-budget=25000',
        '--user-data-dir=' + os.path.join(OUT, 'prof-final'),
        '--dump-dom', 'file:///' + tmp.replace('\\', '/')]

r = subprocess.run(args, timeout=300, capture_output=True)
dom = r.stdout.decode('utf-8', 'replace')
import html as _h
m = re.search(r'<pre id="FINALCHECK">(.*?)</pre>', dom, re.S)
txt = _h.unescape(m.group(1)) if m else '(NOT FOUND — 页面没跑起来) dom.len=%d' % len(dom)
print(txt)

# 自己收拾掉验证用的临时 profile 与临时页（否则每跑一次就多留一份几十 MB 的 profile）
import shutil
shutil.rmtree(os.path.join(OUT, 'prof-final'), ignore_errors=True)
# ★v10：清理必须容错。沙箱会拦截批量删除（实测 safe-delete 拦截 prof-final 整个目录），
#   若这里直接抛异常会中断后面的判定输出；而若静默失败，demo 目录就会多出一个 HTML
#   ⇒ 发布时入口会被猜错（发布要求目录里只有 4 个 HTML）。所以失败要**显式警告**。
try:
    if os.path.exists(tmp):
        os.remove(tmp)
except Exception as e:
    print('!! 临时页未能删除（沙箱可能拦截）：%s' % e)
    print('!! → 请手动删除 %s，否则 demo 目录会多出 1 个 HTML、发布时入口可能被猜错' % tmp)
if os.path.exists(tmp):
    print('!! 警告：%s 仍然存在（demo 目录 HTML 数会变成 5）' % tmp)
print('\n--- 判定 ---')
fails = []
if 'THEME=dark' not in txt:             fails.append('默认主题不是 dark')
if 'ERR=[]' not in txt:                 fails.append('存在 JS 报错')
if 'THEMEBTN=☀️ 日间' not in txt:        fails.append('深色下按钮文案不是「☀️ 日间」')
if 'THEMEFLIP=dark->light->dark' not in txt: fails.append('主题切换点击未生效（属性未翻转）')
if "THEMELS=dark" not in txt:           fails.append('主题选择未写回 localStorage')
if re.search(r'SLIDES=0\b', txt):       fails.append('首页轮播为空')
if re.search(r'HSIDE=0\b', txt):        fails.append('首页右侧小卡为空')
mm = re.search(r'MAINCARDS=(\d+)', txt)
if mm and int(mm.group(1)) < 10:        fails.append('主区卡片数只有 %s' % mm.group(1))
mm = re.search(r'NAVLINK=(\d+)', txt)
if mm and int(mm.group(1)) < 8:         fails.append('侧栏链接只有 %s' % mm.group(1))
mm = re.search(r'NAVFILLED=(\d+)/(\d+)', txt)
if mm and mm.group(1) != mm.group(2):   fails.append('侧栏计数未填满：%s/%s' % (mm.group(1), mm.group(2)))
mm = re.search(r'MNEW=(\d+)', txt)
if mm and int(mm.group(1)) < 10:        fails.append('切 tab 后手机新游只有 %s 张卡' % mm.group(1))

# ---- ★v10 排行榜：4 榜 / 2 列 / 不设搜索与筛选 ----
if re.search(r'RANKBOARD=0\b', txt):    fails.append('排行榜一个榜都没渲染')
mm = re.search(r'RANKBOARD=(\d+)', txt)
if mm and int(mm.group(1)) != 4:        fails.append('排行榜不是 4 个榜（%s）' % mm.group(1))
mm = re.search(r'RANKROW=(\d+)', txt)
if mm and int(mm.group(1)) != 48:       fails.append('榜单总行数不是 48（%s）' % mm.group(1))
mm = re.search(r'RANKCOLS=(\d+)', txt)
if mm and int(mm.group(1)) != 2:        fails.append('排行榜不是固定 2 列（%s 列）' % mm.group(1))
if 'RANKFILTER=0/0/0' not in txt:       fails.append('排行榜仍挂着搜索框或筛选按钮（应为 .filter-bar/#kw/.tg 全 0）')
if 'RANKDEAD=0/24' not in txt:          fails.append('排行榜行内元素不对（应为 比例条0 / 口径标签24）')
mm = re.search(r'RANKTAB=([\w,]+)', txt)
if mm and mm.group(1) != 'pcNew,pcHot,mNew,mNew':
    fails.append('榜单行 data-d 不是 pcNew,pcHot,mNew,mNew（%s）' % mm.group(1))
if re.search(r'pcRank=48', txt) is None: fails.append('侧栏「排行榜」计数不是 48')

# ---- ★v10 首页精选块：固定列数，无孤行 ----
if re.search(r'HOMEPC=10,10\b', txt) is None: fails.append('首页 PC 两块不是各 10 张卡')
if re.search(r'HOMEMB=6\b', txt) is None:     fails.append('首页手游块不是 6 张卡')
mm = re.search(r'HOMECOLS=(\d+)', txt)
if mm and int(mm.group(1)) != 5:        fails.append('首页 PC 精选块不是固定 5 列（%s 列）' % mm.group(1))

# ---- ★v10 MOD：来源标签 / 无死筛选 / 原帖与游戏页分离 ----
if re.search(r'MODTAG=机地,机地,机地', txt) is None:
    fails.append('MOD 卡片左上角不是「机地」来源标签')
if re.search(r'MODTG=0\b', txt) is None: fails.append('MOD 页仍有筛选按钮（死筛选没删干净）')
mm = re.search(r'MODLINKS=(.+)', txt)
if not mm or not mm.group(1).startswith('2|'):
    fails.append('MOD 弹窗不是 2 个链接（原帖 + 游戏页）：%s' % (mm.group(1) if mm else 'MISSING'))
elif '打开原帖（机地）' not in mm.group(1) or 'jidiyouxi.com/post/detail/' not in mm.group(1):
    fails.append('MOD 弹窗缺「打开原帖（机地）」或未指向机地帖子：%s' % mm.group(1))
elif '打开游戏页' not in mm.group(1):
    fails.append('MOD 弹窗缺「打开游戏页」：%s' % mm.group(1))
print('全部通过 ✓' if not fails else '未通过：\n  - ' + '\n  - '.join(fails))
sys.exit(1 if fails else 0)
