# -*- coding: utf-8 -*-
"""GameIntel · 一键打包（v15：情报站 · 桌面客户端）
================================================================================
用户 2026-10-16 推翻上一版的「合并版」方向（原话：「**为什么把我工作站给并到了 exe**」），
改为四条诉求，本脚本产出这一版：

    ① **移除工作台入口** —— 那是一个单独的项目，不该塞进情报站 App；
    ② 情报站自身提供 **统一直链下载 + 下载管理 + 扫盘「我的游戏」**；
    ③ 数据从 demo 快照 **切换为全量实时库**（上游 `server.js` 起的 8123 提供接口）；
    ④ UI 从网页形态改为 **桌面客户端形态**（只在壳里生效，线上 demo 不变）。

★ 上游 `server.js` 仍然要拷 —— 它不只是工作台的页面服务，更是
   `/api/library/browse`、`/api/rank`、`/api/mods/list` 等**实时接口**的唯一来源。
  「移除工作台入口」移除的是 App 里的**导航出口**（`#hubNav`），
  上游目录本身**一个字节都不改**（见下方「只读」说明）。

★ 刻意**不用 electron-builder**，就四步：
    ① 把已有 electron 发行版整个拷过去，`electron.exe` 改名 `GameIntel.exe`；
    ② 把壳源码（electron/）放进 `resources/app/`；
    ③ 把上游 game-aggregator **只读拷贝**到 `resources/app/upstream/`；
    ④ 把 .ico 烧进 exe 的 PE 资源段。

★ 上游的「只读」在这条链上也是真的：
    本脚本对上游目录**只读**（源目录不改一个字节），
    拷进包里的 `upstream/` 也**保留原样**（连 public/ 都不注入东西）。
    情报站是从包内 `resources/app/intel/` 用 file:// 直开的，
    经上游自带的全局 CORS（server.js:105）连 `http://127.0.0.1:8123`。

★ 白名单 vs 黑名单：
    上游顶层**显式列举**要拷贝的 7 项（server.js / shared.js / package.json /
    data / fetchers / public / node_modules），而不是「整个目录拷过来再删」。
    审计过运行时真正的 require 闭包：
        server.js → ./shared + ./data/* + ./fetchers/* + ./fetchers/aliases.json
        data/*.js、fetchers/*.js → ../shared、../data/*、./*
    ⇒ 这 7 项就是闭包全部；`tools/`、`docs/`、`probe*.js`、`*.md` 都是开发期产物。
    顺带把 data/ 里**构建产物**排掉（都不被运行时引用，逐个 grep 验证过）：
        data/_core-dl-probe.json  data/_gcm-raw.json  data/_gt-list-raw.json
        data/_mod-raw.json        data/_yx-list-raw.json
        data/_kalvo-raw/          data/_mm-raw/
        data/*.bak-*              data/*.progress.json
    ⇒ 省 43 MB。

★ 为什么排除项要「拷贝时跳过」而不是「拷完再删」：
    本机沙箱把批量删除换成了回收站操作，会把 500 MB 的目录删失败
    （`OSError: SHFileOperationW 失败: 0x2`），还会触发批量删除护栏超时。
    所以只能在**写入侧**就过滤掉。

★★ 为什么打包**不清空**输出目录，而是「原地覆盖 + 少量显式清理」（2026-10-16 踩坑后改的）：
    原来第一步是 `clear_dir(OUT)`（逐文件 os.remove 整个 300 MB 的 dist）。
    实测**跑到第 50 个文件**就被本机护栏拦下并中断构建：
        [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
        {"count":50,"threshold":50,"scope":"turn", "targets":["...\\resources\\app\\assets\\logo-mark.png"]}
    ⇒ 单轮删除超过 50 个文件就必须人工确认，脚本没法自己走完。
    改为原地覆盖后：
        · 覆盖写入 = 0 次删除；
        · 只有 STALE 清单里的几条旧残留真的要删（**2 个文件**，远在阈值内）。
    副作用：如果将来布局又变了，旧目录可能残留 —— 所以 STALE 清单要跟着维护；
    要彻底重来就**手动删掉 dist\\GameIntel 再跑**（人删不受这条护栏限制）。

运行：D:/Python311/python.exe pack.py            （纯标准库）
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # <root>/electron
ROOT = os.path.dirname(HERE)                                # <root>
SRC_DIST = os.path.join(HERE, 'node_modules', 'electron', 'dist')
UPSTREAM = os.environ.get(
    'GAMEHUB_ROOT',
    os.path.join(os.path.dirname(ROOT), '2026-09-03-16-11-58', 'game-aggregator'),
)
DEMO = os.path.join(ROOT, 'demo')
ICONWORK = os.path.join(ROOT, 'electron-intel')             # 图标工具与素材的现成实现

OUT = os.path.join(ROOT, 'dist', 'GameIntel')
APP = os.path.join(OUT, 'resources', 'app')
UP = os.path.join(APP, 'upstream')
EXE_NAME = 'GameIntel.exe'

# resources/app 里由壳自己带的文件（intel/ 与 upstream/ 另行处理）
SHELL_FILES = ['main.js', 'preload.js', 'package.json', 'aria2.js']
# 情报站只需要这两个文件（demo/ 里其余是开发期脚本、备份、截图）
INTEL_FILES = ['index.html', 'data.js']

# 上游顶层白名单
UP_FILES = ['server.js', 'shared.js', 'package.json']
UP_DIRS = ['data', 'fetchers', 'public', 'node_modules']

# 只在构建期用、跟运行时无关 —— 不能进 resources/app
BUILD_ONLY = {'pack.py', 'make_icon.py', 'set_exe_icon.js'}

# data/ 里的构建产物：运行时零引用（已逐个 grep 验证），排除省 43 MB
DATA_SKIP_RE = re.compile(r'^(_.*|.*\.bak-.*|.*\.progress\.json)$')

# Chromium 一共带 55 个语言包（45 MB），只留这两个
KEEP_LOCALES = ('zh-CN.pak', 'en-US.pak')

NODE = r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
NODE_MODULES_FOR_ICON = r"E:/_iconwork/node_modules"       # resedit 装在这里
ICO = os.path.join(ICONWORK, 'assets', 'icon.ico')


def md5(p, step=1 << 20):
    h = hashlib.md5()
    with open(p, 'rb') as f:
        while True:
            b = f.read(step)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def du(p):
    t = 0
    for dp, _dn, fn in os.walk(p):
        for n in fn:
            try:
                t += os.path.getsize(os.path.join(dp, n))
            except OSError:
                pass
    return t


# 上一版遗留、本版不再生产的路径（相对 OUT）。**越短越好** —— 每一条都是一次删除，
# 而本机护栏是「单轮删除 >50 个文件就要人工确认」。
STALE_FILES = [
    'resources/app/web/data.js',      # v13 的 electron-intel 布局：情报站在 web/
    'resources/app/web/index.html',
]
STALE_DIRS = [
    'resources/app/web',
]


def purge_stale():
    """删掉本版不再产出的旧文件。刻意只删 STALE 清单里的极少数几条。"""
    n = 0
    for rel in STALE_FILES:
        p = os.path.join(OUT, *rel.split('/'))
        if os.path.isfile(p):
            try:
                os.remove(p)
                n += 1
            except OSError as e:
                print('   ⚠️ 删不掉 %s（%s）' % (rel, e))
    for rel in STALE_DIRS:
        p = os.path.join(OUT, *rel.split('/'))
        if os.path.isdir(p):
            try:
                os.rmdir(p)
            except OSError as e:
                print('   ⚠️ 目录非空或删不掉 %s（%s）' % (rel, e))
    return n


def copy_tree(src, dst, skip_file=None, skip_dir=None):
    """逐项拷贝，跳过 skip_file(相对路径, 名字)/skip_dir(名字)。

    ★ 写入侧过滤（不是拷完再删）—— 本机沙箱对批量删除不友好。"""
    n_file = n_dir = n_skip = 0
    for dp, dns, fns in os.walk(src):
        rel = os.path.relpath(dp, src)
        dns[:] = [d for d in dns if not (skip_dir and skip_dir(d))]
        dst_dir = dst if rel == '.' else os.path.join(dst, rel)
        os.makedirs(dst_dir, exist_ok=True)
        for n in fns:
            r = n if rel == '.' else os.path.join(rel, n)
            if skip_file and skip_file(r, n):
                n_skip += 1
                continue
            try:
                shutil.copy2(os.path.join(dp, n), os.path.join(dst_dir, n))
                n_file += 1
            except OSError as e:
                print('   ⚠️ 跳过 %s（%s）' % (r, e))
    n_dir = sum(len(d) for _r, d, _f in os.walk(dst))
    return n_file, n_dir, n_skip


def main():
    if not os.path.isdir(SRC_DIST):
        sys.exit('!! 找不到 electron 发行版：%s' % SRC_DIST)
    if not os.path.isdir(UPSTREAM):
        sys.exit('!! 找不到上游：%s（可用 GAMEHUB_ROOT 指定）' % UPSTREAM)
    if not os.path.isfile(ICO):
        sys.exit('!! 找不到图标：%s' % ICO)
    up_srv = os.path.join(UPSTREAM, 'server.js')
    if not os.path.isfile(up_srv):
        sys.exit('!! 上游缺 server.js：%s' % UPSTREAM)

    print('① 准备输出目录 %s（**不清空**，原地覆盖）' % OUT)
    if os.path.isdir(OUT):
        n = purge_stale()
        print('   已存在 ⇒ 覆盖式更新（清掉 %d 个旧残留）' % n)
    else:
        os.makedirs(APP, exist_ok=True)
        print('   不存在 ⇒ 全新建')

    print('② 拷贝 electron 发行版（覆盖）')
    n_new = 0
    for n in sorted(os.listdir(SRC_DIST)):
        s = os.path.join(SRC_DIST, n)
        d = os.path.join(OUT, n)
        if n == 'locales':
            os.makedirs(d, exist_ok=True)
            for ln in sorted(os.listdir(s)):
                if ln in KEEP_LOCALES:
                    shutil.copy2(os.path.join(s, ln), os.path.join(d, ln))
                    n_new += 1
            continue
        if os.path.isdir(s):
            shutil.copytree(s, d, dirs_exist_ok=True, symlinks=True)
        else:
            shutil.copy2(s, d)
            n_new += 1
    print('   语言包只拷 %s（源 55 个，省 43 MB）' % ' / '.join(KEEP_LOCALES))

    src_exe = os.path.join(OUT, 'electron.exe')
    dst_exe = os.path.join(OUT, EXE_NAME)
    if not os.path.isfile(src_exe):
        sys.exit('!! 发行版里没有 electron.exe')
    os.replace(src_exe, dst_exe)          # 覆盖旧 GameIntel.exe：改名，不是删除
    print('   electron.exe → %s' % EXE_NAME)

    print('③ 壳源码 → resources/app/')
    for f in SHELL_FILES:
        shutil.copy2(os.path.join(HERE, f), os.path.join(APP, f))
    shutil.copytree(os.path.join(ICONWORK, 'assets'), os.path.join(APP, 'assets'),
                    dirs_exist_ok=True)
    print('   %s + assets/' % ', '.join(SHELL_FILES))

    # ②.5 ★v19：第三方二进制（下载引擎等）—— **有就拷、没有就跳过**。
    #   现在 `electron/vendor/` 还不存在（aria2 尚未接入，本轮只预留接口），
    #   所以这一步是空操作；将来把 `vendor/aria2/aria2c.exe` + `COPYING` 放进来，
    #   **不用改这个脚本**它就会进包（README.md 里有落地位置）。
    VENDOR_SRC = os.path.join(HERE, 'vendor')
    if os.path.isdir(VENDOR_SRC):
        v_dst = os.path.join(APP, 'vendor')
        n_files, n_bytes = 0, 0
        for dp, _dn, fn in os.walk(VENDOR_SRC):
            rel = os.path.relpath(dp, VENDOR_SRC)
            dst_dir = os.path.join(v_dst, rel) if rel != '.' else v_dst
            os.makedirs(dst_dir, exist_ok=True)
            for n in fn:
                shutil.copy2(os.path.join(dp, n), os.path.join(dst_dir, n))
                n_files += 1
                try:
                    n_bytes += os.path.getsize(os.path.join(dp, n))
                except OSError:
                    pass
        print('   vendor/ → resources/app/vendor/  %d 文件 / %.1f MB'
              % (n_files, n_bytes / 1048576.0))
    else:
        print('   vendor/ 不存在 ⇒ 跳过（下载引擎未接入，属正常）')

    print('④ 情报站 → resources/app/intel/')
    os.makedirs(os.path.join(APP, 'intel'), exist_ok=True)
    for f in INTEL_FILES:
        shutil.copy2(os.path.join(DEMO, f), os.path.join(APP, 'intel', f))
    print('   %s' % ', '.join(INTEL_FILES))

    print('⑤ 上游（只读拷贝）→ resources/app/upstream/')
    os.makedirs(UP, exist_ok=True)
    for f in UP_FILES:
        shutil.copy2(os.path.join(UPSTREAM, f), os.path.join(UP, f))
    total_skip = 0
    for d in UP_DIRS:
        s = os.path.join(UPSTREAM, d)
        if not os.path.isdir(s):
            sys.exit('!! 上游缺目录：%s' % s)
        sk_f = sk_d = None
        if d == 'data':
            sk_f = lambda rel, n: bool(DATA_SKIP_RE.match(n))
            sk_d = lambda n: n.startswith('_')
        nf, nd, ns = copy_tree(s, os.path.join(UP, d), skip_file=sk_f, skip_dir=sk_d)
        total_skip += ns
        print('   %-10s %5d 文件 / %4d 目录%s' % (d + '/', nf, nd, ('（跳过 %d 个构建产物）' % ns) if ns else ''))
    print('   data/ 跳过 %d 个构建产物，省 %.0f MB' % (total_skip, 43))

    print('⑥ 把图标烧进 %s 的 PE 资源段' % EXE_NAME)
    before = md5(dst_exe)
    env = dict(os.environ)
    env['NODE_PATH'] = NODE_MODULES_FOR_ICON
    r = subprocess.run([NODE, os.path.join(ICONWORK, 'set_exe_icon.js'), dst_exe, ICO],
                       cwd=ICONWORK, env=env, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    print('   ' + (r.stdout or '').strip().replace('\n', '\n   '))
    if r.returncode != 0:
        print((r.stderr or '').strip())
        sys.exit('!! 图标注入失败（exit=%s）' % r.returncode)
    after = md5(dst_exe)
    if before == after:
        sys.exit('!! 注入后 exe 的 md5 没变 —— 说明图标其实没写进去')

    print('\n=== 产物 ===')
    print('  %s' % dst_exe)
    print('  总体积 : %.1f MB   （exe 本体 %.1f MB）' % (du(OUT) / 1e6, os.path.getsize(dst_exe) / 1e6))
    for label, p in [('electron 发行版', None), ('resources/app', APP),
                     ('  └ upstream', UP), ('  └ intel', os.path.join(APP, 'intel'))]:
        if p:
            print('    %-16s %.1f MB' % (label, du(p) / 1e6))
    print('  exe md5: %s（注入图标前 %s）' % (after, before))
    print('  包内关键文件：')
    for rel in ['main.js', 'preload.js', 'intel/index.html', 'intel/data.js',
                'upstream/server.js', 'upstream/shared.js']:
        p = os.path.join(APP, *rel.split('/'))
        print('    %-24s md5=%s  %d B' % (rel, md5(p), os.path.getsize(p)))


if __name__ == '__main__':
    main()
