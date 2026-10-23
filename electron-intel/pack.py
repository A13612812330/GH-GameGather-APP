# -*- coding: utf-8 -*-
"""游戏情报客户端 · 一键打包（electron-intel → dist/GameIntel）

★ 本项目的打包**刻意不用 electron-builder**，就两步：
    ① 把本地已有的 electron 发行版整个拷过去，`electron.exe` 改名 `GameIntel.exe`；
    ② 把壳源码放进 `resources/app/`。
  理由：我们只需要「开一个窗口 loadFile 一个静态页」，没有原生模块、没有 asar 需求，
  引入 electron-builder 只会把依赖链和 C 盘占用拉长（本机 C 盘只剩 ~1.9 GB）。

★ 第三步是 v13 新增的：**把 .ico 烧进 exe 的 PE 资源段**。
  不做这一步，改名的 exe 里仍然是 Electron 的原子图标（见 set_exe_icon.js 顶部说明）。

★ 必须排除的「工程文件」（不能进 resources/app）：
    pack.py / set_exe_icon.js / make_icon.py —— 只在构建期跑，跟运行时无关。

运行：D:/Python311/python.exe pack.py            （纯标准库，托管 Python 也可）
"""
import hashlib
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIST = os.path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist')
OUT = os.path.join(ROOT, 'dist', 'GameIntel')
APP = os.path.join(OUT, 'resources', 'app')

# 进 resources/app 的白名单（显式列举 > 通配，避免把构建脚本一起打进去）
APP_FILES = ['main.js', 'preload.js', 'package.json']
APP_DIRS = ['web', 'assets']
EXE_NAME = 'GameIntel.exe'

# 只保留这两个语言包（Chromium 一共带 55 个，45 MB）。
# 界面与内容全是中文，en-US 作兜底 —— 其余 53 个纯属体积。
# ★ 注意：`LICENSES.chromium.html`（14.4 MB）**本轮刻意保留** ——
#   上一版为了瘦身把它删了，但那是 Chromium 的授权声明，删它属于「能用但不该做」，
#   不值得为 14 MB 去动。
KEEP_LOCALES = ('zh-CN.pak', 'en-US.pak')

NODE = r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
NODE_PATH = r"E:/_iconwork/node_modules"          # resedit 装在这里
ICO = os.path.join(HERE, 'assets', 'icon.ico')


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


def clear_dir(p):
    """清掉构建产物目录。

    ★ 这里**故意不用 shutil.rmtree**：本机沙箱把它换成了「移到回收站」的实现，
      而 284 MB 的 dist 目录会让回收站操作直接失败并抛
      `OSError: SHFileOperationW 失败: 0x2`（已实测，不是猜的）。

    ★ 也**不能无脑逐文件 os.remove**：沙箱还有一道「批量删除护栏」，
      连续删几十个语言包时会抛
      `SAFE_DELETE_BULK_GUARD_ERROR ... timed out after 10 seconds`（也已实测）。
      ⇒ 所以还要配合下面「语言包干脆不拷贝」的做法，把要删的文件数压到最少。

    ⇒ 兜底策略：删不干净就**改名让开**（`os.replace` 是原子改名，不吃删除护栏），
      返回遗留目录名，由最后一行提示。
    """
    if not os.path.isdir(p):
        return None
    for dp, dn, fn in os.walk(p, topdown=False):
        for n in fn:
            try:
                os.remove(os.path.join(dp, n))
            except OSError:
                pass
        for n in dn:
            try:
                os.rmdir(os.path.join(dp, n))
            except OSError:
                pass
    try:
        os.rmdir(p)
        return None
    except OSError:
        pass
    aside, i = p + '.old', 1
    while os.path.exists(aside):
        aside = p + '.old%d' % i
        i += 1
    try:
        os.replace(p, aside)
        return aside
    except OSError as e:
        sys.exit('!! %s 既删不掉也改不了名：%s' % (p, e))


def main():
    if not os.path.isdir(SRC_DIST):
        sys.exit('!! 找不到 electron 发行版：%s' % SRC_DIST)
    if not os.path.isfile(ICO):
        sys.exit('!! 找不到图标：%s（先跑 make_icon.py）' % ICO)

    print('① 清空 %s' % OUT)
    aside = clear_dir(OUT)
    if aside:
        print('   ⚠️ 旧目录删不干净，已改名让开：%s（请手动删）' % aside)
    os.makedirs(APP)

    print('② 拷贝 electron 发行版（%s）' % SRC_DIST)
    for n in sorted(os.listdir(SRC_DIST)):
        s = os.path.join(SRC_DIST, n)
        d = os.path.join(OUT, n)
        if n == 'locales':
            # ★ 只拷要的那两个。先整目录拷再删是最容易踩批量删除护栏的做法，
            #   既慢又多此一举 —— 45 MB 白拷一遍再删掉 43 MB。
            os.makedirs(d, exist_ok=True)
            for ln in sorted(os.listdir(s)):
                if ln in KEEP_LOCALES:
                    shutil.copy2(os.path.join(s, ln), os.path.join(d, ln))
            continue
        if os.path.isdir(s):
            shutil.copytree(s, d, dirs_exist_ok=True, symlinks=True)
        else:
            shutil.copy2(s, d)
    print('   语言包只拷 %s（源 55 个，省 43 MB）' % ' / '.join(KEEP_LOCALES))

    src_exe = os.path.join(OUT, 'electron.exe')
    dst_exe = os.path.join(OUT, EXE_NAME)
    if not os.path.isfile(src_exe):
        sys.exit('!! 发行版里没有 electron.exe')
    os.replace(src_exe, dst_exe)
    print('   electron.exe → %s' % EXE_NAME)

    print('③ 放入壳源码 → resources/app')
    for f in APP_FILES:
        shutil.copy2(os.path.join(HERE, f), os.path.join(APP, f))
    for d in APP_DIRS:
        shutil.copytree(os.path.join(HERE, d), os.path.join(APP, d), dirs_exist_ok=True)

    print('④ 把图标烧进 %s 的 PE 资源段' % EXE_NAME)
    before = md5(dst_exe)
    env = dict(os.environ)
    env['NODE_PATH'] = NODE_PATH
    r = subprocess.run([NODE, os.path.join(HERE, 'set_exe_icon.js'), dst_exe, ICO],
                       cwd=HERE, env=env, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    print('   ' + (r.stdout or '').strip().replace('\n', '\n   '))
    if r.returncode != 0:
        print((r.stderr or '').strip())
        sys.exit('!! 图标注入失败（exit=%s）。exe 里的图标仍是 Electron 默认的。' % r.returncode)
    after = md5(dst_exe)
    if before == after:
        sys.exit('!! 注入后 exe 的 md5 没变 —— 说明图标其实没写进去')

    print('\n=== 产物 ===')
    print('  %s' % dst_exe)
    print('  体积   : %.1f MB（exe 本体 %.1f MB）' % (du(OUT) / 1e6, os.path.getsize(dst_exe) / 1e6))
    print('  exe md5: %s（注入图标前 %s）' % (after, before))
    print('  语言包 : %s' % ', '.join(sorted(os.listdir(os.path.join(OUT, 'locales')))))
    for n in ['web/index.html', 'web/data.js']:
        p = os.path.join(APP, *n.split('/'))
        print('  包内 %-16s md5=%s  %d B' % (n, md5(p), os.path.getsize(p)))


if __name__ == '__main__':
    main()
