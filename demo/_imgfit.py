# -*- coding: utf-8 -*-
"""图片适配审计 —— 用真实 Chrome 量出每张图的「容器框 vs 原图」，算出裁切/留白率。

为什么需要它：`图片适配对照.html` 里的裁切率是**按假设的图源比例手算**的
（1:1 方图 / 2.14 宽图），而 data.js 里真实图片的比例有多少种、每张落在哪个
容器里、实际裁掉多少，**从来没实测过**。本脚本补这一环。

做法（复用 _shot.py 的本地图缓存，不碰网络）：
  1. 把 data.js 里的图片 URL 换成本地 `_imgcache/` 文件；
  2. 注入探针，依次切 10 个 Tab，等图 decode 后量每个 img 的
     父容器 clientWidth/Height、naturalWidth/Height、object-fit；
  3. `--dump-dom` 取回 JSON，本脚本算裁切率并输出报告。

用法：python _imgfit.py            → 打印报告，写 _probe/imgfit.json
      IMG_AUDIT_TABS=home,pcMod python _imgfit.py   → 只测部分 Tab
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(DIR)
CHROME = r"C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe"
CACHE = os.path.join(DIR, '_imgcache')
OUTJSON = os.environ.get('IMG_AUDIT_OUT', os.path.join(ROOT, '_probe', 'imgfit.json'))

ALL_TABS = ['home', 'pcNew', 'pcHot', 'pcRank', 'pcTrainer', 'pcMod',
            'mNew', 'mEvent', 'mPlay', 'report']
TABS = [t for t in os.environ.get('IMG_AUDIT_TABS', ','.join(ALL_TABS)).split(',') if t]

src = io.open(os.path.join(DIR, 'index.html'), encoding='utf-8').read()
data = io.open(os.path.join(DIR, 'data.js'), encoding='utf-8').read()


def _ext(u):
    m = re.search(r'\.(jpg|jpeg|png|webp|gif)(?:\?|$)', u, re.I)
    return (m.group(1).lower() if m else 'jpg').replace('jpeg', 'jpg')


def _path(u):
    return os.path.join(CACHE, hashlib.md5(u.encode('utf-8')).hexdigest()[:16] + '.' + _ext(u))


urls = sorted(set(re.findall(r'"(?:cover|img)":\s*"(https?://[^"]+)"', data)))
hit, miss = 0, []
for u in urls:
    p = _path(u)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        data = data.replace(u, '_imgcache/' + os.path.basename(p))
        hit += 1
    else:
        miss.append(u)
print('[cache] 图片字段 %d 个 · 本地命中 %d · 缺 %d' % (len(urls), hit, len(miss)))
if miss:
    print('        缺样例:', ' ;; '.join(miss[:3]))

page = src.replace('<script src="data.js"></script>',
                   '<script>' + data.replace('</script', '<\\/script') + '</script>')
tmp = os.path.join(DIR, '_imgfit_tmp.html')
io.open(tmp, 'w', encoding='utf-8').write(page)

# 量这一步交给 _imgfit.js 走 CDP（真实时间等待）；virtual-time-budget 下探针采不完。
NODE = os.environ.get('NODE_BIN') or r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
env = dict(os.environ)
env['IMG_PAGE'] = tmp
env['IMG_TABS'] = ','.join(TABS)
env['IMG_W'] = os.environ.get('IMG_W', '1440')
env['IMG_H'] = os.environ.get('IMG_H', '900')
r = subprocess.run([NODE, os.path.join(DIR, '_imgfit.js')],
                   cwd=DIR, env=env, timeout=600, capture_output=True)
so = r.stdout.decode('utf-8', 'replace')
if r.returncode != 0:
    print('!! _imgfit.js 失败：')
    print(so[-2000:])
    print(r.stderr.decode('utf-8', 'replace')[-2000:])
    sys.exit(1)

m = re.search(r'###JSON###(.*)', so, re.S)
if not m:
    print('!! 没拿到结果。stdout 尾部：')
    print(so[-2000:])
    sys.exit(1)

rows = json.loads(m.group(1).strip())
try:
    os.remove(tmp)
except OSError:
    pass
print('[probe] 采到 %d 条 img 记录' % len(rows))

# ---------- 解析 ----------
POOL = [('cv', '.cv 卡片封面'), ('mth sq', '.mth.sq 手机新游方形 icon'),
        ('mth wd', '.mth.wd 手机活动横版'), ('rth', '.rth 排行榜 58px 小图'),
        ('hpic', '.hpic 轮播大图'), ('hsitem', '.hsitem 轮播右侧小卡')]


def pool_of(cls):
    for key, _ in POOL:
        if key in cls:
            return key
    return cls.strip() or '(无类名)'


def area_cut(ar_box, ar_img):
    """裁切面积比：cover 下可见比例 = min/max。"""
    if not ar_box or not ar_img:
        return 0.0
    return 1 - min(ar_box, ar_img) / max(ar_box, ar_img)


by_tab = {}
for x in rows:
    if 'err' in x:
        by_tab.setdefault(x['t'], {'err': x['err']})
        continue
    by_tab.setdefault(x['t'], []).append(x)

print()
print('=' * 104)
print('%-10s %-18s %5s %10s %10s %8s %8s %s' %
      ('Tab', '容器', '张数', '容器比例', '原图比例', '裁切率', '均值', '判定'))
print('=' * 104)

issues = []
for t in TABS:
    v = by_tab.get(t)
    if not v:
        print('%-10s  (无记录)' % t)
        continue
    if isinstance(v, dict):
        print('%-10s  RENDER-ERR %s' % (t, v.get('err')))
        continue
    groups = {}
    for x in v:
        groups.setdefault(pool_of(x['pc']), []).append(x)
    for g, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        cuts, unloaded = [], 0
        ars_box, ars_img = [], []
        for x in items:
            if not x['nw'] or not x['nh']:
                unloaded += 1
                continue
            ab = (x['bw'] / x['bh']) if x['bh'] else 0
            ai = x['nw'] / x['nh']
            ars_box.append(ab)
            ars_img.append(ai)
            cuts.append(area_cut(ab, ai))
        n = len(items)
        if not cuts:
            print('%-10s %-18s %5d  %s' % (t, g, n, '全部未加载/无尺寸'))
            continue
        avg = sum(cuts) / len(cuts)
        worst = max(cuts)
        ar_b = sum(ars_box) / len(ars_box)
        ar_i = sum(ars_img) / len(ars_img)
        fit = items[0]['fit']
        flag = []
        if unloaded:
            flag.append('未加载%d' % unloaded)
        if fit == 'cover' and avg > 0.30:
            flag.append('★裁切重')
        if fit == 'contain' and avg > 0.20:
            flag.append('★留白重')
        if ars_img and (max(ars_img) - min(ars_img)) > 0.5:
            flag.append('源比例不齐(%.2f~%.2f)' % (min(ars_img), max(ars_img)))
        line = '%-10s %-18s %5d %10.3f %10.3f %7.1f%% %7.1f%%  %s %s' % (
            t, g, n, ar_b, ar_i, worst * 100, avg * 100, fit, ' '.join(flag))
        print(line)
        if flag:
            issues.append((t, g, n, fit, avg, worst, ' '.join(flag)))

print('=' * 104)
print()
print('【异常汇总】%d 组' % len(issues))
for t, g, n, fit, avg, worst, f in sorted(issues, key=lambda z: -z[4]):
    print('  %-10s %-18s %4d 张  fit=%-8s 均值裁掉 %5.1f%%  最狠 %5.1f%%  %s'
          % (t, g, n, fit, avg * 100, worst * 100, f))

# 原图比例分布（全局）
allsrc = [x['nw'] / x['nh'] for v in by_tab.values() if isinstance(v, list) for x in v if x['nw']]
if allsrc:
    buckets = {}
    for a in allsrc:
        b = '<1.2 竖/方' if a < 1.2 else '1.2-1.6' if a < 1.6 else '1.6-1.9 近16:9' if a < 1.9 else '1.9-2.3 宽图' if a < 2.3 else '>=2.3 超宽'
        buckets[b] = buckets.get(b, 0) + 1
    print()
    print('【原图比例分布】共 %d 张' % len(allsrc))
    for b in ['<1.2 竖/方', '1.2-1.6', '1.6-1.9 近16:9', '1.9-2.3 宽图', '>=2.3 超宽']:
        c = buckets.get(b, 0)
        print('  %-14s %4d  %s' % (b, c, '#' * min(60, c)))

os.makedirs(os.path.dirname(OUTJSON), exist_ok=True)
io.open(OUTJSON, 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1))
print()
print('原始数据 ->', OUTJSON)
