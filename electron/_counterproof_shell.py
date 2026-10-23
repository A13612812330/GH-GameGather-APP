# -*- coding: utf-8 -*-
"""反证（★v18 **壳层**）：把壳 / preload / 上游的静态契约**实际打坏**，
确认 `_t_shell.js` 的断言真会变红；每条还原后必须复绿。

为什么壳层要单独一个反证 —— 与 `demo/_counterproof.py` 是**同一套理由**：
  断言可能「恒真」：正则写宽了、或查的东西根本不在文件里。
  `_t_shell.js` 守的是**安全边界**（管理页能干什么、上游绑不绑回环），
  这一层如果没有反证，31 条断言等于「自说自话」。
  实测代价很低：本文件不跑 Electron，每次 `_t_shell.js` 只做源码正则，全量约 3 秒。

★★ 三条纪律（与 demo 那边一致，逐条都踩过）：
   ① `old` 串必须在**同一个文件里恰好出现 1 次**（启动自检直接拦）；
   ② 打坏必须让断言**变红**，不许让 `_t_shell.js` **崩溃**（判据不纯 ⇒ 验不到断言）；
   ③ **不写被测文件** —— 打坏版写进系统临时目录，靠 `GAMEHUB_MAIN` / `GAMEHUB_PRELOAD` /
      `GAMEHUB_SERVER` 三个环境变量把 `_t_shell.js` 指过去（`_t_shell.js` 为此加了 env 支持）。
      真源码（`main.js` / `preload.js` / `server.js`）**全程零写入**，结尾打印三者 md5 佐证。

运行：python _counterproof_shell.py
      CP_ONLY=S9 python _counterproof_shell.py    # 调试单点（**交付前必须跑全量**）
"""
import atexit, ctypes, hashlib, io, os, re, shutil, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UPSTREAM = os.path.join(os.path.dirname(ROOT), '2026-09-03-16-11-58', 'game-aggregator', 'server.js')
T_SHELL = os.path.join(HERE, '_t_shell.js')
NODE = r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
NODE_PATH = r"C:/Users/komo/.workbuddy/binaries/node/workspace/node_modules"

# ★★ 并发护栏：两个实例会互相覆写临时文件 ⇒ 结果全是废数据（2026-10-16 在 demo 那边踩过）。
LOCK = os.path.join(HERE, '_cp_shell.lock')


def _pid_alive(pid):
    """★ 不能用 `os.kill(pid, 0)` —— Windows 上它会**真的把那个进程杀掉**。"""
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259


if os.path.exists(LOCK):
    try:
        _old = int((io.open(LOCK, encoding='utf-8').read() or '').strip() or 0)
    except Exception:
        _old = 0
    if _old and _old != os.getpid() and _pid_alive(_old):
        print('!! 已有一个壳层反证实例在跑（PID %d）—— 拒绝并发。' % _old)
        raise SystemExit(2)
io.open(LOCK, 'w', encoding='utf-8').write(str(os.getpid()))
atexit.register(lambda: os.path.exists(LOCK) and os.remove(LOCK))

SRCPATH = {'main': os.path.join(HERE, 'main.js'),
           'preload': os.path.join(HERE, 'preload.js'),
           'upstream': UPSTREAM}
SRC = {k: io.open(SRCPATH[k], encoding='utf-8').read() for k in SRCPATH}
ENVKEY = {'main': 'GAMEHUB_MAIN', 'preload': 'GAMEHUB_PRELOAD', 'upstream': 'GAMEHUB_SERVER'}
TMP = tempfile.mkdtemp(prefix='gish_shellcp_')
atexit.register(lambda: shutil.rmtree(TMP, ignore_errors=True))

_UNIQ = []


def _sub1(target, old, new):
    """精确单次替换；`old` 必须在**该 target 的文件里唯一**（启动自检会验）。"""
    _UNIQ.append((target, old))
    return (target, old, new)


def _suball(target, old, new):
    return (target, old, new)


MUT = [
    # ---- ① 管理页入参边界（页面拿不到任意路径 / 任意 URL）----
    ('S1 `shell:openDlRoot` 加回入参（页面就能让壳打开**任意**路径）',
     _sub1('main',
           "ipcMain.handle('shell:openDlRoot', async () => {\n      try {\n        const d = dlDir();",
           "ipcMain.handle('shell:openDlRoot', async (_e, p) => {\n      try {\n        const d = p || dlDir();")),

    ('S2 非法管理页动作**放行**（不再拒绝回执 —— 静默失败变静默执行）',
     _sub1('main',
           "      log('[ipc] 拒绝非法管理页动作: ' + a);\n      return { ok: false, error: 'action not allowed' };",
           "      const w0 = createAdminWindow(startPath);\n      return { ok: true, open: !!(w0 && !w0.isDestroyed()) };")),

    ('S3 起始页不再过主进程正则（页面可指定任意串当起始页）',
     _sub1('main',
           "  const p = /^\\/[A-Za-z0-9._\\-/?=&%]*$/.test(String(startPath || '')) ? startPath : '/index.html';",
           "  const p = String(startPath || '/index.html');")),

    ('S4 `shell:admin` 回执里不再带上游归属（页面失去「这实例是不是我拉的」判据）',
     _sub1('main',
           'return { ok: true, open: !!(w && !w.isDestroyed()), owner: upInfo.owner, pid: upInfo.pid };',
           'return { ok: true, open: !!(w && !w.isDestroyed()) };')),

    # ---- ② 管理窗三道纪律 ----
    ('S5 管理窗 `closed` 里加 `app.quit()`（**关管理页会带走整个 App**）',
     _sub1('main',
           "  adminWin.on('closed', () => {\n    adminWin = null;\n    log('[shell] 管理窗已关闭（主窗与上游服务均不受影响）');",
           "  adminWin.on('closed', () => {\n    adminWin = null;\n    app.quit();\n    log('[shell] 管理窗已关闭（主窗与上游服务均不受影响）');")),

    ('S6 关管理窗时顺手杀掉上游子进程（上游归主窗生命周期管，越权）',
     _sub1('main',
           "  adminWin.on('closed', () => {\n    adminWin = null;",
           "  adminWin.on('closed', () => {\n    if (child) child.kill();\n    adminWin = null;")),

    ('S7 管理窗不再单例（每次点「管理页」都再开一个窗口）',
     _sub1('main',
           "  if (adminWin && !adminWin.isDestroyed()) { adminWin.focus(); return adminWin; }",
           "  if (false && adminWin && !adminWin.isDestroyed()) { adminWin.focus(); return adminWin; }")),

    ('S8 管理窗不挂自己那套 `setWindowOpenHandler`（以为会从主窗继承 ⇒ 外链直接在 Electron 里开）',
     _sub1('main',
           "  adminWin.webContents.setWindowOpenHandler(({ url }) => {\n    if (url.startsWith(SERVICE)) {",
           "  const __noWinOpen = (({ url }) => {\n    if (url.startsWith(SERVICE)) {")),

    ('S9 动作条改为**改上游 HTML**（不再注入 ⇒ 上游被写入，破「上游零改动」）',
     _sub1('main',
           '    adminWin.webContents.executeJavaScript(ADMIN_BAR_JS, true)',
           "    Promise.resolve('skipped')")),

    ('S10 管理窗 webPreferences 关掉 contextIsolation（页面直连 Node）',
     # ⚠️ 这个 old 串**必须带上管理窗那行注释**才唯一 ——
     #    `contextIsolation: true, nodeIntegration: false,` 在 main.js 里出现 **2 次**
     #    （主窗 + 管理窗各一次），短串会让 `str.replace(...,1)` 打在**主窗**上 ⇒ 反证出现盲区。
     #    启动自检就是这么把它拦下来的（实测第 0 秒报「出现 2 次」）。
     _sub1('main',
           '      /* 动作条要用 `__SHELL_*` ⇒ 必须挂**同一个 preload**（contextIsolation 保持不变）。 */\n'
           "      preload: path.join(__dirname, 'preload.js'),\n"
           '      contextIsolation: true,\n'
           '      nodeIntegration: false,',
           '      /* 动作条要用 `__SHELL_*` ⇒ 必须挂**同一个 preload**（contextIsolation 保持不变）。 */\n'
           "      preload: path.join(__dirname, 'preload.js'),\n"
           '      contextIsolation: false,\n'
           '      nodeIntegration: true,')),

    # ---- ③ 上游实例归属（不许猜）----
    ('S11 归属判定去掉 `!reused`（复用外部实例时**冒认**成自己拉的）',
     _sub1('main',
           '  const owned = !reused && !!child && child.pid === pid;',
           '  const owned = !!child && child.pid === pid;')),

    ('S12 health 里没 pid 也硬报 `shell`（旧版上游时凭空断言归属）',
     _sub1('main',
           "    owner: pid ? (owned ? 'shell' : 'external') : 'unknown',",
           "    owner: owned ? 'shell' : 'external',")),

    ('S13 health 回的不是 JSON 就抛（旧版上游会让探活整段炸掉）',
     _sub1('main',
           'try { resolve(JSON.parse(buf)); } catch (e) { resolve(null); }',
           'resolve(JSON.parse(buf));')),

    ('S14 `shell:describe` 版本号不升（页面判不出「这壳有没有管理页能力」）',
     _sub1('main',
           "      version: 'v18',",
           "      version: 'v17',")),

    # ---- ④ preload 暴露面 ----
    ('S15 preload 把 `ipcRenderer` 本体暴露出去（contextIsolation 的意义全没了）',
     _sub1('preload',
           "contextBridge.exposeInMainWorld('__SHELL_ADMIN__', (act) =>",
           "contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer);\ncontextBridge.exposeInMainWorld('__SHELL_ADMIN__', (act) =>")),

    ('S16 `openDlRoot` 接受入参并转发（preload 层先破一次边界）',
     _sub1('preload',
           "  openDlRoot: () => ipcRenderer.invoke('shell:openDlRoot'),",
           "  openDlRoot: (p) => ipcRenderer.invoke('shell:openDlRoot', p),")),

    ('S17 `__SHELL_ADMIN__` 不再收窄成动作名（String 包一层是页面→主进程的第一次收口）',
     _sub1('preload',
           "  ipcRenderer.invoke('shell:admin', String(act || 'open'))",
           "  ipcRenderer.invoke('shell:admin', act)")),

    # ---- ⑤ 上游两处授权改动（越权 = 回到改动前）----
    ('S18 `app.listen(port)` 去掉 HOST（**又绑回 0.0.0.0**，安全收口作废）',
     _sub1('upstream',
           '  const srv = app.listen(port, HOST, () => {',
           '  const srv = app.listen(port, () => {')),

    ('S19 `HOST` 默认改回 `0.0.0.0`（逃生开关保留，但默认面又开了）',
     _sub1('upstream',
           "const HOST = process.env.GAMEHUB_HOST || '127.0.0.1';",
           "const HOST = process.env.GAMEHUB_HOST || '0.0.0.0';")),

    ('S20 启动日志打回 `localhost`（排查时会以为还是 0.0.0.0，实测地址不可信）',
     _sub1('upstream',
           '聚合站已启动: http://${HOST}:${port}',
           '聚合站已启动: http://localhost:${port}')),

    ('S21 `/api/health` 删掉 pid（壳再也分不清「App 拉起的」还是「用户自己的」实例）',
     _sub1('upstream',
           '    pid: process.pid,\n',
           '')),

    ('S22 `/api/health` 把 pid 写成假值（比删更阴：字段在、内容骗人）',
     _sub1('upstream',
           '    pid: process.pid,',
           '    pid: 0,')),

    ('S23 `BOOT_AT` 每次请求现算（startedAt 变成「最后一次探活时刻」，等于没有启动时间）',
     _sub1('upstream',
           '    startedAt: BOOT_AT,',
           '    startedAt: Date.now(),')),

    ('S24 `/api/health` 的老字段改名（**只增不改**的承诺破了 ⇒ 老调用方受影响）',
     _sub1('upstream',
           '    ok: true, ts: Date.now(), ttl: { feed: 180, detail: 600 },',
           '    ok: true, timestamp: Date.now(), ttl: { feed: 180, detail: 600 },')),
]


def run(over=None):
    env = dict(os.environ)
    env['NODE_PATH'] = NODE_PATH
    if over:
        env.update(over)
    p = subprocess.run([NODE, T_SHELL], cwd=HERE, env=env,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    m = re.search(r'通过 (\d+) / (\d+)', out)
    fails = re.findall(r'✗ (.+)', out)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None), fails


# ★ 启动自检：old 串在**对应文件**里必须恰好出现 1 次。
_bad = [(t, o, SRC[t].count(o)) for t, o in _UNIQ if SRC[t].count(o) != 1]
if _bad:
    print('!! 打坏点自检失败（old 串必须在其目标文件里恰好出现 1 次）：')
    for t, o, n in _bad:
        print('   [%s] 出现 %d 次: %r' % (t, n, o[:90]))
    raise SystemExit('请把上述 old 串改到唯一，否则 str.replace(...,1) 可能打偏。')
print('打坏点自检：%d 个 old 串在各自文件里唯一 ✓' % len(_UNIQ))

MD5 = {k: hashlib.md5(io.open(SRCPATH[k], 'rb').read()).hexdigest() for k in SRC}
print('=== 基线 ===')
base, _ = run()
print('  基线 %s/%s' % base)
if base[0] is None:
    raise SystemExit('基线跑不起来，先修 _t_shell.js')

_ONLY = os.environ.get('CP_ONLY', '').strip()
_ran, bad = 0, 0
if _ONLY:
    if not [n for n, _ in MUT if _ONLY in n]:
        raise SystemExit('CP_ONLY=%r 没匹配到任何打坏点' % _ONLY)
    print('⚠️  CP_ONLY=%s ⇒ 只跑 %d 个点，**这不是全量反证**'
          % (_ONLY, len([n for n, _ in MUT if _ONLY in n])))

for name, (target, old, new) in MUT:
    if _ONLY and _ONLY not in name:
        continue
    _ran += 1
    mut = SRC[target].replace(old, new, 1)
    if mut == SRC[target]:
        print('  !! %s —— 替换未命中（脚本要修，说明源码已变）' % name)
        bad += 1
        continue
    tmpf = os.path.join(TMP, 'mut_' + target + '.js')
    io.open(tmpf, 'w', encoding='utf-8').write(mut)
    (pp, tt), fails = run({ENVKEY[target]: tmpf})
    after, _ = run()                       # 还原 = 指回真文件（真文件全程没动过）
    status = 'OK' if (pp is not None and pp < base[0] and after == base) else 'FAIL'
    if status == 'FAIL':
        bad += 1
    note = '  ⟵ 打坏后**崩溃**（不是断言红，判据不纯，要换打坏点）' if pp is None else ''
    print('%s  %-46s 打坏 %s/%s → 变红 %s 条 → 还原 %s/%s%s'
          % (status, name, pp, tt, len(fails), after[0], after[1], note))
    for f in fails[:3]:
        print('        ✗ ' + f[:92])

print('\n最终还原：%s/%s' % run()[0])
_now = {k: hashlib.md5(io.open(SRCPATH[k], 'rb').read()).hexdigest() for k in SRC}
for k in SRC:
    print('  %-9s 未写入 %s  (%s)' % (k, '✓' if _now[k] == MD5[k] else '✗ 变了！', MD5[k]))
print('反证结论：%s%s' % (
    '全部命中 ✓' if bad == 0 else '有 %d 项未命中 ✗' % bad,
    ('　⚠️ 但只跑了 %d 个点（CP_ONLY=%s），**不是全量**，交付前请补跑全量' % (_ran, _ONLY))
    if _ONLY else ''))
raise SystemExit(1 if bad else 0)
