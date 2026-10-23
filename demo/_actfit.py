# -*- coding: utf-8 -*-
"""★v16-F 探针：手游「活动 / 新游」配图的**源比例**实测。

用户 2026-10-16 ⑦：「根据游戏活动图片进行适配优化，如果是游戏icon/正方形的图片
则再优化下完整显示」。

本项目在图片适配上的既定口径（v11 定下，见 MEMORY）：**看「最狠裁切」不看「均值」**
—— 均值好看不代表没有一张被裁爆的图，而用户永远只看到那一张。

本探针只做一件事：把 mEvent / mNew 的图**真下下来**量宽高比，然后按「当前容器比例」
算裁切率，输出直方图与最狠的几条。**不改任何文件、不写库**。

用法：
    D:/Python311/python.exe _actfit.py            # 各取 40 条（够看分布）
    D:/Python311/python.exe _actfit.py 80         # 加大样本
"""
import io
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

N = int(sys.argv[1]) if len(sys.argv) > 1 else 40


def load_data():
    """从 data.js 里抠出 __DEMO_DATA__（与 _t_demo.js 同一套做法）。"""
    s = io.open(os.path.join(HERE, 'data.js'), encoding='utf-8').read()
    i = s.find('{')
    return json.loads(s[i:].rstrip().rstrip(';'))


def head_size(url, timeout=12):
    """只取头部若干字节，用 Pillow 解出 (w, h)。比整张下完快得多。"""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Range': 'bytes=0-65535'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(65536)
        from PIL import Image
        im = Image.open(io.BytesIO(raw))
        return im.size
    except Exception:
        # Range 不被支持 / 头部不够解 → 老实整张下
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read(4 * 1024 * 1024)
            from PIL import Image
            im = Image.open(io.BytesIO(raw))
            return im.size
        except Exception:
            return None


def crop_rate(ar, box_ar):
    """按 object-fit:cover 算「被裁掉的比例」：短边方向丢掉的面积占比。"""
    if not ar or not box_ar:
        return 1.0
    return 1.0 - (min(ar, box_ar) / max(ar, box_ar))


def pick(tab, n):
    d = load_data().get(tab) or []
    out = []
    for a in d:
        u = a.get('img') or ''
        if u.startswith('http'):
            out.append((a.get('game') or a.get('title') or '', u))
        if len(out) >= n:
            break
    return out


def measure(tab, n):
    items = pick(tab, n)
    if not items:
        print('== %s：没有可下载的图（img 可能不是 http）' % tab)
        return []
    with ThreadPoolExecutor(max_workers=8) as ex:
        sizes = list(ex.map(lambda it: head_size(it[1]), items))
    rows = []
    for (nm, u), sz in zip(items, sizes):
        if not sz:
            continue
        w, h = sz
        rows.append({'title': nm, 'w': w, 'h': h, 'ar': round(w / h, 3), 'url': u})
    return rows


def report(tab, rows, box_ar, box_txt):
    print('\n== %s ==  样本 %d 张（容器 %s）' % (tab, len(rows), box_txt))
    if not rows:
        return
    sq = [r for r in rows if 0.85 <= r['ar'] <= 1.18]
    wide = [r for r in rows if r['ar'] > 1.18]
    tall = [r for r in rows if r['ar'] < 0.85]
    print('   形状分布：正方/icon(<1.18) %d ｜ 横版 %d ｜ 竖版 %d'
          % (len(sq), len(wide), len(tall)))
    # ★ 排序键必须只取 rate —— 直接 sort 元组 (rate, dict) 时，
    #   一旦有并列的 rate，Python 会去比 dict 而抛 TypeError（本轮实测踩到）。
    rates = sorted(rows, key=lambda r: crop_rate(r['ar'], box_ar), reverse=True)
    worst = crop_rate(rates[0]['ar'], box_ar)
    print('   最狠裁切：%.1f%%' % (worst * 100))
    print('   前 6 狠：')
    for r in rates[:6]:
        print('     %5.1f%%  %-14s ar=%-6s %dx%d'
              % (crop_rate(r['ar'], box_ar) * 100, r['title'][:14], r['ar'], r['w'], r['h']))
    # 换容器的效果对比
    for ar, name in [(16 / 10, '当前 16:10'), (16 / 9, '16:9'), (3 / 2, '3:2'),
                     (4 / 3, '4:3'), (1.0, '1:1'), (1.91, '1.91:1')]:
        rates2 = [crop_rate(r['ar'], ar) for r in rows]
        print('   若换 %-9s ⇒ 最狠 %5.1f%%  均值 %5.1f%%'
              % (name, max(rates2) * 100, sum(rates2) / len(rates2) * 100))


def main():
    print('★v16-F 配图源比例实测（样本 %d/类）' % N)
    for tab, box_ar, box_txt in [('mEvent', 16 / 10, '.mth.wd 88px × 16:10'),
                                 ('mNew', 1.0, '.mth.sq 72px × 1:1')]:
        rows = measure(tab, N)
        report(tab, rows, box_ar, box_txt)
        with io.open(os.path.join(HERE, '_actfit_%s.json' % tab), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
