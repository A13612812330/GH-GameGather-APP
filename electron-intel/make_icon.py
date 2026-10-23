# -*- coding: utf-8 -*-
"""游戏情报客户端 · 应用图标生成（★v13）

素材：`E:\\新建文件夹\\游戏库导航栏素材留档\\小光.png`（600×600，深灰底 + 白色手柄 + 挖空「HALO」）
产出：electron-intel/assets/ 下的 PNG 各尺寸 + 多尺寸 .ico

★ 为什么要「去背景再上底盘」而不是直接把原图当图标：
  原图是**不透明**的（四角 RGB≈(38,39,40)），直接拿来当图标就是一整块方形深灰 ——
  在 Windows 圆角/悬浮的图标位里会露出四个尖角。所以流程是：
    ① 按亮度抠出白色手柄（含抗锯齿软边）→ 透明前景；
    ② 裁到 alpha 包围盒 → 居中重排，保证任何尺寸都不偏；
    ③ 贴到一张圆角方形底盘上 → 这才是真正能当应用图标的产物。

★ 抠图阈值是**实测出来的**，不是拍的：源图亮度直方图强双峰 ——
  16~47 占 70.7%（底色，均值≈38）、240~255 占 28.1%（手柄），中间 48~239 合计仅 1.2%。
  所以把软边斜坡放在 60~200 之间：底色一点不漏，手柄边缘的抗锯齿也保住了。

运行：D:/Python311/python.exe make_icon.py      （需要 PIL，托管 Python 3.13 里没有）
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
SRC = r"E:\新建文件夹\游戏库导航栏素材留档\小光.png"
os.makedirs(OUT, exist_ok=True)

S = 1024                      # 主图尺寸
LO, HI = 60, 200              # 抠图软边斜坡（见文件头说明）
PAD_BIG, PAD_SMALL = 0.085, 0.045   # 手柄在底盘内的留白：大尺寸多留、小尺寸少留（否则 16px 糊成一团）

# 底盘配色（两套，默认深色那套＝忠实还原素材本身的底）
PLATES = {
    'dark': ('#333536', '#1b1c1e'),     # 取自源图实测底色 (38,39,40) → 略下压一档
    'blue': ('#1e3a6e', '#1e4ed8'),     # 取项目自身 token：--hdr → --accent
}


def deemblem(path, lo=LO, hi=HI):
    """把「白 glyph / 深底」的图抠成透明前景（保留抗锯齿软边）"""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px, o = im.load(), Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = o.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            if lum <= lo:
                continue                                  # 纯底色 → 全透明
            a = 255 if lum >= hi else int((lum - lo) * 255 / (hi - lo))
            op[x, y] = (255, 255, 255, a)                 # 前景一律纯白，与原图一致
    return o


def bbox_square(im):
    """裁到 alpha 包围盒，并补成正方形（居中）—— 保证缩放时手柄始终居中"""
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    w, h = im.size
    n = max(w, h)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(im, ((n - w) // 2, (n - h) // 2))
    return out


def rounded_gradient(size, c_from, c_to, radius_ratio=0.22):
    """圆角方形底盘（135° 线性渐变）—— 用一张渐变图当蒙版的填充层"""
    w = h = size
    g = Image.new('RGB', (w, h))
    gp = g.load()
    a = tuple(int(c_from[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(c_to[i:i + 2], 16) for i in (1, 3, 5))
    for y in range(h):
        for x in range(w):
            t = (x + y) / (2.0 * (w - 1))                 # 135°
            gp[x, y] = tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1],
                                           radius=int(size * radius_ratio), fill=255)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(g, (0, 0), mask)
    return out


def compose(glyph, size, plate, pad_ratio):
    """把抠好的手柄贴到圆角底盘上，返回指定尺寸的成品"""
    c_from, c_to = PLATES[plate]
    base = rounded_gradient(size, c_from, c_to)
    inner = int(size * (1 - 2 * pad_ratio))
    g = glyph.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    base.alpha_composite(g, (off, off))
    return base


def main():
    glyph = bbox_square(deemblem(SRC))
    print('抠图后包围盒:', glyph.size)

    # ① 透明前景（可回收进 UI 用：侧栏/顶栏 logo）
    glyph.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'logo-mark.png'))
    print('写出 logo-mark.png (512, 透明)')

    for plate in PLATES:
        # ② 主图 PNG（大尺寸多留白）
        big = compose(glyph, S, plate, PAD_BIG)
        name = 'icon' if plate == 'dark' else 'icon-alt-blue'
        big.save(os.path.join(OUT, name + '.png'))
        # ③ 多尺寸 ICO。★ 小尺寸单独用更小的留白重排，而不是由 1024 直接缩 ——
        #    直接缩的话 16px 里手柄只占 ~13px，糊成一坨；重排后能占满 ~15px。
        ico_sizes = [256, 128, 64, 48, 32, 24, 16]
        frames, bmp = [], {}
        for s in ico_sizes:
            fr = compose(glyph, s, plate, PAD_SMALL if s < 64 else PAD_BIG)
            frames.append(fr)
            bmp[s] = fr
        frames[0].save(os.path.join(OUT, name + '.ico'),
                       format='ICO', sizes=[(s, s) for s in ico_sizes],
                       append_images=frames[1:],
                       # ★ 强制走 BMP 帧。Pillow 默认把每一帧都存成 PNG 压缩帧（实测读回来 7 帧全 PNG）。
                       #   PNG 帧虽然 Vista+ 认，但「小尺寸 BMP、只有 256 用 PNG」才是事实标准 ——
                       #   用 BMP 换最大兼容性，这个 exe 本来就 200MB，多这 ~300KB 无感。
                       bitmap_format='bmp')
        # ④ 预览拼图（16→256 一排，用来肉眼确认小尺寸没糊）
        row = Image.new('RGBA', (sum(ico_sizes) + 8 * (len(ico_sizes) - 1), 256), (0, 0, 0, 0))
        x = 0
        for s in ico_sizes:
            row.alpha_composite(bmp[s], (x, 256 - s))
            x += s + 8
        row.save(os.path.join(OUT, name + '-sizes.png'))
        print('写出 %s.png / %s.ico / %s-sizes.png' % (name, name, name))


if __name__ == '__main__':
    main()
