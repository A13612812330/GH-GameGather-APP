# -*- coding: utf-8 -*-
"""比较 v8（浅色基线）与 v9（浅色）两图，证明浅色主题未退化。
输出：差异像素占比 + 差异边界框 + 按行分布（定位差异集中在哪一带）。"""
import io, sys
from PIL import Image, ImageChops

A = r"E:/新建文件夹/WorkBuddy/2026-10-08-14-02-06/demo/_shots/cmp-v8-light.png"
B = r"E:/新建文件夹/WorkBuddy/2026-10-08-14-02-06/demo/_shots/cmp-v9-light.png"
TOL = int(sys.argv[1]) if len(sys.argv) > 1 else 3

a = Image.open(A).convert("RGB")
b = Image.open(B).convert("RGB")
print("尺寸  v8=%s  v9=%s" % (a.size, b.size))
if a.size != b.size:
    print("尺寸不同，无法逐像素比。"); sys.exit(1)

W, H = a.size
d = ImageChops.difference(a, b).convert("L")
px = d.load()

total = W * H
n_any = 0
n_vis = 0            # 超过容差
rows = [0] * H       # 每行超容差像素数
cols = [0] * W
for y in range(H):
    r = 0
    for x in range(W):
        v = px[x, y]
        if v:
            n_any += 1
        if v > TOL:
            n_vis += 1
            r += 1
            cols[x] += 1
    rows[y] = r

print("总像素        %d" % total)
print("有差异像素    %d  (%.4f%%)" % (n_any, n_any * 100.0 / total))
print("超容差(>%d)   %d  (%.4f%%)" % (TOL, n_vis, n_vis * 100.0 / total))

if n_vis:
    ys = [y for y in range(H) if rows[y] > 0]
    xs = [x for x in range(W) if cols[x] > 0]
    print("差异行范围    y=%d..%d" % (ys[0], ys[-1]))
    print("差异列范围    x=%d..%d" % (xs[0], xs[-1]))
    # 差异最密集的 6 行
    top = sorted(range(H), key=lambda y: -rows[y])[:6]
    print("差异最多的行  " + ", ".join("y=%d(%d)" % (y, rows[y]) for y in sorted(top)))
else:
    print("=> 结论：浅色主题与原 v8 基线**逐像素一致**（容差 %d 内零差异）" % TOL)
