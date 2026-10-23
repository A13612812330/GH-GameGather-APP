# -*- coding: utf-8 -*-
"""v25 深色色板对比度核验 —— 只读 index.html 的 token，不改任何文件。
为什么单独做：jsdom 不解析 CSS 变量，截图又只能看「看起来行不行」；
对比度是可计算的硬指标，用来兜住「token 推导时把某个前景/背景拉太近」这类问题。
阈值：正文 >= 4.5，大字/次要 >= 3.0（WCAG AA）。
"""
import io, os, re

DIR = os.path.dirname(os.path.abspath(__file__))
code = io.open(os.path.join(DIR, 'index.html'), encoding='utf-8').read()

m = re.search(r'html\[data-theme="dark"\]\{(.*?)\n\}', code, re.S)
block = m.group(1)
tok = dict(re.findall(r'(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})', block))


def lum(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4) for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


PAIRS = [
    ('正文 txt / 页面底 bg', '--txt', '--bg', 4.5),
    ('正文 txt / 卡片 card', '--txt', '--card', 4.5),
    ('正文 txt / 次级面 soft', '--txt', '--soft', 4.5),
    ('正文 txt / 内嵌 sunken', '--txt', '--sunken', 4.5),
    ('正文 txt / 浮起 raise', '--txt', '--raise', 4.5),
    ('次要 sub / 卡片 card', '--sub', '--card', 3.0),
    ('次要 sub / 次级面 soft', '--sub', '--soft', 3.0),
    ('主色 accent / 页面底 bg', '--accent', '--bg', 3.0),
    ('主色 accent / 卡片 card', '--accent', '--card', 3.0),
    ('主色底文字 on-accent / accent', '--on-accent', '--accent', 4.5),
    ('警示 warn-tx / note-bg', '--warn-tx', '--note-bg', 4.5),
    ('信息 info-tx / info-panel', '--info-tx', '--info-panel', 4.5),
    ('失败 bad-tx / bad-bg', '--bad-tx', '--bad-bg', 4.5),
    ('成功 ok / okbg', '--ok', '--okbg', 3.0),
]

bad = 0
print('%-34s %6s %6s %s' % ('配对', '比值', '阈值', '判定'))
for name, fg, bgk, need in PAIRS:
    if fg not in tok or bgk not in tok:
        print('%-34s  !! token 缺失 (%s / %s)' % (name, fg, bgk))
        bad += 1
        continue
    r = ratio(tok[fg], tok[bgk])
    okmark = 'OK' if r >= need else 'FAIL'
    if r < need:
        bad += 1
    print('%-34s %6.2f %6.1f  %s   %s on %s' % (name, r, need, okmark, tok[fg], tok[bgk]))

print()
print('不合格 %d / %d' % (bad, len(PAIRS)))
