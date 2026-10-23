# -*- coding: utf-8 -*-
"""视觉验收工具 —— 用本机 Chrome 无头模式给 demo 截图。

为什么需要它：**jsdom 不加载图片** —— `naturalWidth` 恒为 0、`onload` 永不触发，
所以 `_t_demo.js` 的断言**完全覆盖不到图片适配 / 布局观感**。图片与版式只能靠
真实浏览器截图人眼看。

★v8 升级：**远程图片改走本地缓存**。
  原因（实测）：无头模式下 `--virtual-time-budget` 与「几十张远程图并发」组合时，
  图片几乎加载不出来 —— `mEvent` 98 张 `complete=false / naturalWidth=0`、截图整片空白，
  而同一批 URL 用纯 HTTP 请求全是 200（`_tap_banner.jpg` 1080×608）。
  同时 `loading="lazy"` 也会让无头截图与真实浏览器看到的结果不一致。
  ⇒ 做法：首次运行时把 data.js 里的图片（`cover` / `img` 字段）抓到 `_imgcache/`，
  生成截图页时把 data.js **内联并把 URL 换成缓存文件**，截图不再依赖网络，
  **既快又可复现**（每次截图看到的图完全一样）。

环境事实（实测）：
  · 沙箱内 **Edge 起不来** —— `msedge.exe --version` 都无输出。
  · 本机 **Chrome 134 可用**：必须用 `--headless`（old），`--headless=new` 不出图。

用法：
  python _shot.py home                          # 整页
  python _shot.py pcRank 1.0 0 _rank.png        # 自定义输出名
  python _shot.py pcHot 2.0 620                 # 2 倍放大 + 滚到 y=620
  python _shot.py pcHot 1.0 0 _x.png ".grid.pc{grid-template-columns:repeat(2,1fr)!important}"

窗口大小用环境变量 SHOT_W / SHOT_H 覆盖（默认 1400x1500）。
缓存目录：`demo/_imgcache/`（截图工具专用，不参与交付）。
"""
import concurrent.futures
import hashlib
import io
import os
import re
import subprocess
import sys
import urllib.request

DIR = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe"
NODE = os.environ.get('NODE_BIN') or r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
OUTDIR = os.environ.get('SHOT_DIR', r"C:/Users/komo/.wb-shot")
CACHE = os.path.join(DIR, '_imgcache')

tab    = sys.argv[1] if len(sys.argv) > 1 else 'home'
zoom   = sys.argv[2] if len(sys.argv) > 2 else '1.0'
scroll = sys.argv[3] if len(sys.argv) > 3 else '0'
out    = sys.argv[4] if len(sys.argv) > 4 else '_shot_%s.png' % tab
extra  = sys.argv[5] if len(sys.argv) > 5 else ''
W = os.environ.get('SHOT_W', '1400')
H = os.environ.get('SHOT_H', '1500')
QUIET = os.environ.get('SHOT_QUIET') == '1'

src = io.open(os.path.join(DIR, os.environ.get('SRC', 'index.html')), encoding='utf-8').read()
data = io.open(os.path.join(DIR, 'data.js'), encoding='utf-8').read()


# ---------- 1. 图片本地缓存 ----------
def _ext(u):
    m = re.search(r'\.(jpg|jpeg|png|webp|gif)(?:\?|$)', u, re.I)
    return (m.group(1).lower() if m else 'jpg').replace('jpeg', 'jpg')


def _path(u):
    return os.path.join(CACHE, hashlib.md5(u.encode('utf-8')).hexdigest()[:16] + '.' + _ext(u))


def _fetch(u):
    p = _path(u)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return u, p
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=25) as r:
            b = r.read()
        if not b:
            return u, None
        io.open(p, 'wb').write(b)
        return u, p
    except Exception:
        return u, None


urls = sorted(set(re.findall(r'"(?:cover|img)":\s*"(https?://[^"]+)"', data)))
os.makedirs(CACHE, exist_ok=True)
mapping, missed = {}, []
with concurrent.futures.ThreadPoolExecutor(8) as ex:
    for u, p in ex.map(_fetch, urls):
        if p:
            mapping[u] = p
        else:
            missed.append(u)

cached = sum(1 for p in mapping.values() if os.path.exists(p))
if not QUIET:
    print('[imgc] 图片字段 %d 个，本地缓存 %d，失败 %d' % (len(urls), cached, len(missed)))
    if missed:
        print('       失败样例：', ' ;; '.join(missed[:3]))

for u, p in mapping.items():
    data = data.replace(u, '_imgcache/' + os.path.basename(p))

# ---------- 2. 生成截图页（内联 data.js，图片全走本地） ----------
DIAG = os.environ.get('SHOT_DIAG') == '1'
if DIAG:
    INJ = """
<pre id="shotdiag" style="white-space:pre-wrap;font:12px monospace"></pre>
<script>
window.addEventListener('load', function(){
  setTimeout(function(){
    var out=[];
    try{ resetState('%s'); render(); }catch(e){ out.push('RENDER-ERR '+e.message); }
    window.scrollTo(0, %s);
    setTimeout(function(){
      var imgs=[].slice.call(document.querySelectorAll('#main .cv img, #main .mth img, #main .rth img'));
      var ok=imgs.filter(function(i){return i.complete&&i.naturalWidth;}).length;
      out.push('图片总数='+imgs.length+' 已加载='+ok+' 未加载='+(imgs.length-ok));
      imgs.slice(0,14).forEach(function(i,k){
        var cs=getComputedStyle(i);
        out.push(k+' complete='+i.complete+' nw='+i.naturalWidth+'x'+i.naturalHeight+
                 ' op='+cs.opacity+' fit='+cs.objectFit+' src='+(i.getAttribute('src')||'').slice(-46));
      });
      document.getElementById('shotdiag').textContent=out.join('\\n');
    }, 2500);
  }, 300);
});
</script>
""" % (tab, scroll)
else:
    # ★v9：右下角那个绿色调试角标会在**交付给用户看的图**上很扎眼，
    #   所以给它一个开关（SHOT_NOBADGE=1），做交付图时关掉、排查时留着。
    if os.environ.get('SHOT_NOBADGE') == '1':
        BADGE = ''
    else:
        BADGE = ("""
  var n=document.createElement('div');
  n.style.cssText='position:fixed;right:6px;bottom:6px;background:#111;color:#0f0;font:12px monospace;padding:3px 8px;z-index:99999';
  n.textContent='TAB=%s zoom=%s y=%s';
  document.body.appendChild(n);
""" % (tab, zoom, scroll))
    # ⚠️ 不能用 「str + str + (str % tup)」 的写法：`%` 比 `+` 优先级高，
    #    会变成 A + B + (C % tup) ⇒ A 里的 %s 一个都替换不掉。
    #    所以先把模板拼好、最后整体做一次 % 替换。
    TEMPLATE = """
<style id="shotZoom">body{zoom:%s}</style>
<style id="shotExtra">%s</style>
<script>
window.addEventListener('load', function(){
  try{ resetState('%s'); render(); }catch(e){ document.title='ERR '+e.message; }
  window.scrollTo(0, %s);
  setTimeout(function(){ window.scrollTo(0, %s); }, 400);""" + BADGE + """
});
</script>
"""
    INJ = TEMPLATE % (zoom, extra, tab, scroll, scroll)

page = src.replace(
    '<script src="data.js"></script>',
    '<script>' + data.replace('</script', '<\\/script') + '</script>'
).replace('</body>', INJ + '\n</body>')

# ★v9：截图要能指定主题（双主题后 JS 命中假，必须固定住才可比对）。
#   ⚠️ 只改 head 里的默认值**不够** —— CDP 用的 profile 是持久化的，
#   上一轮截图时 applyTheme() 会把选择写进 localStorage，下次打开 head 读到它、
#   把默认值覆盖掉（实测：强制 light 却仍截出深色）。所以这里要三处一起改。
THEME = os.environ.get('THEME', '')
if THEME in ('light', 'dark'):
    n1 = page.count("var t = 'dark';")
    n2 = page.count("var v = localStorage.getItem('gi-theme');")
    n3 = page.count("try{ localStorage.setItem('gi-theme', t); }catch(e){}")
    page = page.replace("var t = 'dark';", "var t = '%s';" % THEME)
    page = page.replace("var v = localStorage.getItem('gi-theme');", "var v = null;")
    page = page.replace("try{ localStorage.setItem('gi-theme', t); }catch(e){}", "")
    print('[theme] 强制 %s  (命中 默认值%d / 读存储%d / 写存储%d)' % (THEME, n1, n2, n3))
    if n1 != 1:
        print('[theme] !! 默认值未命中，截图主题可能不是预期的')

tmp = os.path.join(DIR, '_shot_tmp.html')
io.open(tmp, 'w', encoding='utf-8').write(page)

os.makedirs(OUTDIR, exist_ok=True)
png = os.path.join(OUTDIR, out)
base = [CHROME, os.environ.get('HEADLESS', '--headless'), '--disable-gpu', '--no-sandbox',
        '--hide-scrollbars',
        '--allow-file-access-from-files',
        '--window-size=%s,%s' % (W, H),
        '--virtual-time-budget=' + os.environ.get('BUDGET', '20000'),
        '--user-data-dir=' + os.path.join(OUTDIR, 'prof')]

if DIAG:
    r = subprocess.run(base + ['--dump-dom', 'file:///' + tmp.replace('\\', '/')],
                       timeout=240, capture_output=True)
    dom = r.stdout.decode('utf-8', 'replace')
    import html as _h
    m = re.search(r'<pre id="shotdiag"[^>]*>(.*?)</pre>', dom, re.S)
    print(_h.unescape(m.group(1)) if m else 'NOT FOUND (页面没跑到) dom.len=%d' % len(dom))
elif os.environ.get('SHOT_LEGACY') == '1':
    # 旧路径：chrome --screenshot。**已知会拍到未光栅化的空白图**（见 _shot.js 抬头注释），
    # 只留作对照，不要用它做视觉验收。
    subprocess.run(base + ['--screenshot=' + png, 'file:///' + tmp.replace('\\', '/')],
                   timeout=240, capture_output=True)
    print('->', png, os.path.getsize(png) if os.path.exists(png) else 'FAIL')
else:
    # ★v8 默认路径：交给 _shot.js 走 CDP，等 img.decode() 完成后再拍。
    env = dict(os.environ)
    env['SHOT_DIR'] = OUTDIR
    env['SHOT_W'] = W
    env['SHOT_H'] = H
    r = subprocess.run([NODE, os.path.join(DIR, '_shot.js'), out],
                       cwd=DIR, env=env, timeout=300, capture_output=True)
    sys.stdout.write(r.stdout.decode('utf-8', 'replace'))
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode('utf-8', 'replace'))
        sys.exit(r.returncode)
if not DIAG or os.environ.get('KEEP') != '1':
    os.remove(tmp)
