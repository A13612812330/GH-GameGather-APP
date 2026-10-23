# -*- coding: utf-8 -*-
"""反证（★v10）：逐条**打坏被断言守护的实现**，确认断言真会变红；每条还原后必须复绿。

为什么必须做：断言可能「恒真」——比如正则写宽了、或查的东西根本不在页面上。
只有把被守护的行为**实际改坏**、看到它变红，才证明这条断言真的在守着东西。

覆盖：
  v8  ① 端游卡片标题英文名用（）包含        → M3
      ② PC 排行榜改列表式分榜               → M4
      ③ 手游新游卡：时间去重 / 平台标签右上角 → M5 / M6
      ④ 手游活动卡补上线时间                 → M7
      ⑤ 新增首页与大图轮播                   → M8 / M9
      ★ 图片可见性交给 CSS（不再依赖 onload）→ M1 / M2
  v9  ★ 双主题（深色/浅色可切换）            → M10 / M11 / M12 / M13
      ★ 版式对齐 TapTap（多列榜 / 1大2小）   → M14 / M15 / M16
  v10 ★ 排行榜 4 榜 + 不设搜索/筛选          → M17 / M18 / M19 / M20
      ★ 首页精选块固定列数（去孤行）          → M21 / M22
      ★ MOD 来源 / 死筛选 / 原帖与游戏页分离  → M23 / M24 / M25
  v13 ★ 搜索字段白名单 / 五档加权             → M26 / M27
      ★ 搜索只重刷列表（外壳不重建）          → M28
      ★ 3 档响应式断点且都在 1424 以下        → M29 / M30
  v14 ★ 详情弹窗下载区块（探不到服务必须整块消失）→ M39
  v15 ★ 壳内下载入口 / 名字闸门 / 默认视图 / 计数 → M31 ~ M38
      ★ 顶栏实时态常驻（svcPin，不再闪 4 秒还原）  → M40
      ★ 游戏库默认 scope=pc / 扫盘状态收尾顺序    → M41 / M42
      ★ manual 态按钮判据（按 state 而非 kind）   → M43
  v16 ★ 分页（默认页长 / 切片 / 换页长回第 1 页）  → M44 / M45 / M48
      ★ 「不显示数量」（侧栏 CSS 隐藏 / 分页条同步）→ M46 / M47
      （v14 那批打 hubNav 的点已随模块下线退场：代码里连 id 都没了，
        留着只会报「替换未命中」——按红线，断言的增减要随模块一起报账。）
      ★ v16-H 网盘直链外挂（OpenList）        → M84 ~ M95
        守四条：① 只调用不分发；② olReady 三条件缺一不可且 probed 不落盘；
        ③ 未就绪连按钮都不渲染、连请求都不发；④ 失败原样带出上游报错。

★★ 三条「别再来一遍」的硬教训（前两条写在启动自检里，跑之前就会拦下）：
   ① `_sub1` 的 old 串必须在源文件里**唯一** —— `str.replace(...,1)` 只替换第一处，
      打偏到注释上 ⇒ 打坏「成功」但真代码没动 ⇒ 变红 0 条，反证出现**盲区**。
      实例：M31 的 `data-dlstart="1"`（注释里也写了一遍）。**这条自检能拦。**
   ② 「变红 0 条」有两种成因，别混为一谈：
      · 打坏点打偏了（如上）        ⇒ 修**打坏点**
      · 断言没覆盖这个联动          ⇒ 修**断言**
      实例：M36 删掉 `TABS.downloads` ⇒ `goTab()` 的 `if(!TABS[tab]) return;`
      会静默不切页，而侧栏是**静态 HTML**、三个 `#c-*` 计数也是硬编码的，
      所以「计数元素存在」那条断言删掉 TABS 照样绿 ⇒ 补了一条真调 `goTab` 的断言。
   ③ ★★ **打坏点必须落在「可达路径」上** —— 这是 2026-10-16 v16 全量跑出来的第三个成因，
      **自检拦不住**（old 串确实唯一、替换确实命中、只是那段代码根本到不了）：
      实例：M82 原来只打 `const ar = w / h;`，而上面 `if(!w || !h) return;` 早就把
      「图没解出来」挡掉了 ⇒ 打坏不可达代码，行为一字不变、**变红 0 条**。
      ⇒ 这类只能靠**全量跑**发现。**改完打坏点后，至少要 CP_ONLY 单点复验一次。**
   ④ ★★ **绝不许并发跑两个实例**（2026-10-16 实测踩过，白跑 70 分钟）——
      打坏版写的是**同一个 `_mut.html`**，两个实例互相覆写 ⇒ 两边几乎每条都是
      「打坏 636/636 → **变红 0 条**」，而汇总只报「N 项未命中」，
      **从输出里看不出是并发**，极易被误读成「断言全都很弱」。
      ⇒ 已加 **PID 锁**（`_cp.lock`）：第二个实例启动即拒绝并退出（码 2）。
      另外 **边跑边改 `_t_demo.js` 也会污染**：断言数在跑到一半时变化 ⇒ 还原值对不上基线
      （实测见过 636 → 633 → 635 一路漂）。**要改先停。**

运行：python _counterproof.py     （内部会调 _t_demo.js，需先装好 jsdom）
"""
import atexit, ctypes, io, os, re, subprocess

DIR = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(DIR, 'index.html')
# ★ 打坏版写到临时文件，**绝不触碰 index.html**。
#   旧写法是「就地打坏 → 测 → 就地写回快照」，有两个致命问题：
#     ① 中途被打断（Ctrl-C / 超时 kill）⇒ index.html 停在打坏版上；
#     ② 快照是启动那一刻读的 ⇒ 跑的过程中若有人编辑 index.html，还原会把编辑一起抹掉。
#   这两条都实际发生过（2026-10-16），所以改成临时文件 + 环境变量指定被测文件。
MUT_HTML = os.path.join(DIR, '_mut.html')

# ★★ 并发护栏（2026-10-16 新增）：**同一目录只允许一个反证实例**。
#   为什么必须拦：打坏版写的是**同一个** `_mut.html`。两个实例并存时，
#   A 刚写完就被 B 覆写 ⇒ A 的 `_t_demo.js` 读到的是 B 的那份（或干净版）⇒
#   **几乎每条都「打坏 636/636 → 变红 0 条」**，而汇总只报「N 项未命中」，
#   **从输出里完全看不出是并发造成的**。
#   实测代价：两个实例各跑 ~36 分钟，两份结果全是废数据；
#   更险的是它长得像「所有断言都守不住东西」，会把下一个人引去「修断言」——方向完全错。
#   用 PID + 存活性判断；进程崩了留下的**陈旧锁会被自动接管**（不会永久锁死）。
LOCK = os.path.join(DIR, '_cp.lock')


def _pid_alive(pid):
    """不依赖 psutil 的存活性判断。
    ★ 这里**不能用** `os.kill(pid, 0)` —— Windows 上 os.kill 走的是 TerminateProcess，
      传 0 会**真的把那个进程杀掉**（这是本条护栏最容易踩的坑）。"""
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259          # STILL_ACTIVE


def _acquire_lock():
    if os.path.exists(LOCK):
        try:
            old = int((io.open(LOCK, encoding='utf-8').read() or '').strip() or 0)
        except Exception:
            old = 0
        if old and old != os.getpid() and _pid_alive(old):
            print('!! 已有一个反证实例在跑（PID %d）—— **拒绝并发**。' % old)
            print('   两个实例会互相覆写 %s：两边都会变成「变红 0 条」的废数据，'
                  % os.path.basename(MUT_HTML))
            print('   而汇总只报「N 项未命中」，**看不出是并发造成的**（2026-10-16 踩过，白跑 70 分钟）。')
            print('   要重来先杀掉它：taskkill /F /PID %d' % old)
            raise SystemExit(2)
    io.open(LOCK, 'w', encoding='utf-8').write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(LOCK) and os.remove(LOCK))


_acquire_lock()

CLEAN = io.open(HTML, encoding='utf-8').read()
if os.path.exists(MUT_HTML):
    os.remove(MUT_HTML)

NODE = r"C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
ENV = dict(os.environ)
ENV['NODE_PATH'] = r"C:/Users/komo/.workbuddy/binaries/node/workspace/node_modules"
ENV['T_DEMO_HTML'] = '_mut.html'


_UNIQ = []          # 收集 _sub1 的 old 串，供启动自检（见文件下方的「启动自检」块）


def _sub1(old, new):
    """精确单次替换；未命中则返回原串（外层会报错）。

    ★ old 必须在源文件里**唯一**出现 —— `str.replace(old, new, 1)` 只替换**第一处**。
      若同一个串在别处（最阴的是**注释**里）也写了一遍，替换就可能落在注释上，
      真代码纹丝不动 ⇒ 打坏「看起来成功」但断言全绿，反证出现**盲区**。
      （实例：M31 的 `data-dlstart="1"` 在注释里也写了一次 ⇒ 变红 0 条。）
      启动时的自检会把这种情况直接拦下，不用等跑完 39 个点。"""
    _UNIQ.append(old)
    return lambda s: s.replace(old, new, 1)


def _suball(old, new):
    """全量替换。用于「同一个串在**多个渲染分支**里各出现一次、
    且每一处都该被打坏**」的点 —— 只打第一处会让「打坏」不彻底，
    断言可能因为它查的是别的那处而漏红。
    （实例：M2 的 `<img decoding="async" …` 在 4 个卡片模板里各出现一次。）"""
    return lambda s: s.replace(old, new)


MUT = [
    # ---- ① 标题英文名（）----
    ('M3 让 nameParts 不再拆英文名（标题不会带（））',
     _sub1("  return {main:zh.join(' / '), en:en.join(' / '), changed:true};",
           "  return {main:s, en:'', changed:false};")),

    # ---- ② 排行榜列表分榜 ----
    # 注：打坏点必须选「页面能跑、但断言该红」的。历史上试过两种更粗暴的都不行：
    #   · 把 `else if(cfg.rankBoard)` 判假 → pcRank 掉进普通网格分支，渲染期就抛错；
    #   · 把榜单 HTML 换成空串 → `.rlist` 消失，测试脚本自己在 querySelectorAll 上抛错而终止，
    #     跑出 `通过 None/None`。
    #   两者都是「崩」而不是「断言红」，验不到断言本身。
    #   ★v10：原打坏点是「删掉热度榜/容量榜」（榜名已不存在）。改为删掉两个手机榜 ——
    #   页面照常渲染（PC 两榜 + 空位），专门看那批「4 个榜」的断言会不会红。
    ('M4 分榜只剩 PC 两个（手机两榜被删）',
     lambda s: re.sub(r"\n  \{ nm:'手机新游榜'.*?chip:a=>a\.hotLabel \|\| '' \},\n", '',
                      s, count=1, flags=re.S)),

    # ---- ③ 手游新游卡 ----
    ('M5 状态后缀改回带日期的 suffix（时间重复出现两次）',
     _sub1("  const st = String(a.status||'').trim();          /* ★v8：只用状态词，不带日期 */",
           "  const st = String(a.suffix||a.status||'').trim();")),
    ('M6 平台标签区改回 static（不再固定在右上角）',
     _sub1('.mcard .mtop{\n  position:absolute;', '.mcard .mtop{\n  position:static;')),

    # ---- ④ 活动卡上线时间 ----
    ('M7 活动卡去掉 .mtime（不再显示上线时间）',
     _sub1('${t?`<span class="mtime" title="上线 / 开始时间">${esc(t)}</span>`:\'\'}', '')),

    # ---- ⑤ 首页 + 轮播 ----
    ('M8 render 开头不再停轮播计时器（切走后泄漏 interval）',
     lambda s: re.sub(r'stopHero\(\);\s*/\* ★ 离开首页前先停掉轮播计时器 \*/',
                      '/* 已停用 */', s, count=1)),
    ('M9 默认落地页改回「新游」（不再默认首页）',
     _sub1("resetState('home');", "resetState('pcNew');")),

    # ---- ★ 图片可见性交给 CSS ----
    ('M1 .cv img 改回 opacity:0（可见性又绑回 onload 回调）',
     _sub1('  position:relative;z-index:1;\n}', '  position:relative;opacity:0;\n}')),
    # ★ 用 _suball：这个串在 4 个卡片模板（PC 卡 / 手机新游卡 / 手机活动卡 / 榜单行）里
    #   各出现一次，只打第一处的话「打坏」不彻底。
    ('M2 给卡片 img 挂回 loading="lazy"',
     _suball('<img decoding="async" referrerpolicy="no-referrer"',
             '<img loading="lazy" decoding="async" referrerpolicy="no-referrer"')),

    # ---- ★v9 双主题 ----
    # 注：这一批打的是「token 层」，页面照样能跑，专门验断言是不是真在守 token。
    ('M10 整块删掉深色主题 token 覆盖',
     lambda s: re.sub(r'\nhtml\[data-theme="dark"\]\{.*?\n\}\n', '\n', s, count=1, flags=re.S)),
    ('M11 深色下来源 pill 不再反色（浅底深字压深背景）',
     lambda s: re.sub(r'\nhtml\[data-theme="dark"\] \.pill\.src-xd\{[^\n]*\n', '\n', s, count=1)),
    ('M12 大标题色改回 var(--hdr)（深色下标题会变纯黑）',
     _sub1('line-height:1.32;color:var(--title-strong);', 'line-height:1.32;color:var(--hdr);')),
    ('M13 顶栏去掉主题切换按钮',
     _sub1('<button class="btn ghost" id="themeBtn" title="切换深色 / 浅色主题">\U0001F319 夜间</button>', '')),

    # ---- ★v9 版式（对齐 TapTap）----
    # ★v10：原打坏点是「.rankboards 退回单列」，锚点写的是 auto-fit/minmax(340px) ——
    # 该 CSS 已改成固定 2 列，所以这里改成「退回 auto-fit 自适应」：
    # 4 个榜在 1424 宽下会排成 3+1 孤行，正是本轮首页那个毛病的翻版。
    ('M14 排行榜列数退回 minmax(340px) 自适应（4 榜会变 3+1 孤行）',
     _sub1('.rankboards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;margin-bottom:16px}',
           '.rankboards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start;margin-bottom:16px}')),
    ('M15 Hero 右侧预览小卡整套去掉（退回单张全宽）',
     _sub1('<div class="hside" id="heroSide">${sets}</div>', '')),
    ('M16 .hside-set 改回 display:none 切换（小卡图不再预加载）',
     _sub1('.hside-set{\n  position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;\n  opacity:0;pointer-events:none;transition:opacity .25s ease;\n}\n.hside-set.on{opacity:1;pointer-events:auto}',
           '.hside-set{display:none}\n.hside-set.on{display:flex}')),

    # ---- ★v10 排行榜：4 榜 / 不设搜索与筛选 ----
    ('M17 排行榜塞回搜索框（用户口径：本页不要搜索）',
     _sub1("    main.innerHTML = head + noticeFor(cur) + rankBoardsHTML() + footNote();",
           "    main.innerHTML = head + noticeFor(cur) + '<div class=\"filter-bar\"><input id=\"kw\"></div>' + rankBoardsHTML() + footNote();")),
    ('M18 排行榜塞回筛选按钮（用户口径：本页不要品类筛选）',
     _sub1("    main.innerHTML = head + noticeFor(cur) + rankBoardsHTML() + footNote();",
           "    main.innerHTML = head + noticeFor(cur) + '<div class=\"filter-bar\"><button class=\"tg\" data-fg=\"genre\" data-fv=\"动作\">动作</button></div>' + rankBoardsHTML() + footNote();")),
    ('M19 手机热游榜退回「纯 hot 降序」（不再按源归一化）',
     _sub1('    sort:(a,b)=>(hotPct(b)-hotPct(a)) || (Number(b.hot)-Number(a.hot)),',
           '    sort:(a,b)=>Number(b.hot)-Number(a.hot),')),
    ('M20 榜单行 data-d 写死 pcRank（跨 Tab 取数被破坏）',
     _sub1('return `<div class="rrow" data-d="${b.tab}" data-i="${gi}"',
           'return `<div class="rrow" data-d="pcRank" data-i="${gi}"')),

    # ---- ★v10 首页精选块：固定列数去孤行 ----
    ('M21 首页 PC 精选块退回每块 6 张（固定 5 列下又出现 5+1 孤行）',
     _sub1("const pcNew  = wrap('pcNew', 10, byTs);",
           "const pcNew  = wrap('pcNew', 6, byTs);")),
    ('M22 .hseclist.pc 退回 auto-fill 自适应（列数不再固定）',
     _sub1('.hseclist.pc{grid-template-columns:repeat(5,minmax(0,1fr))}',
           '.hseclist.pc{grid-template-columns:repeat(auto-fill,minmax(212px,1fr))}')),

    # ---- ★v10 MOD：来源 / 死筛选 / 双链接 ----
    ('M23 MOD 的「类型」筛选组加回来（点「修改器」必然筛出空集）',
     _sub1('  pcMod:  [],',
           "  pcMod:  [ {k:'kindKey',lb:'类型',field:'kindKey',opts:[['mod','MOD'],['modifier','修改器']]} ],")),
    ('M24 MOD 卡片左上角改回挂类型「MOD」（不再是来源「机地」）',
     _sub1("    tag: srcTag(a), badge:a.pv?`\U0001F441 ${fmtHot(a.pv)}`:'',",
           "    tag: {cls:'modk', text:a.kind}, badge:a.pv?`\U0001F441 ${fmtHot(a.pv)}`:'',")),
    ('M25 MOD 弹窗退回单个链接（丢掉「原帖（机地）」，只剩库页面）',
     _sub1("        a.postUrl ? {t: '打开原帖（机地）', url: a.postUrl} : null,",
           "        null,")),

    # ---- ★v13 搜索重做 / 局部刷新 / 响应式 ----
    # 注：这一批打的是「搜索的匹配口径」与「渲染范围」，页面照样能跑，
    #     专门验 11a/11b/11c 那批断言是不是真在守着它们。
    ('M26 搜索退回 JSON.stringify 全量匹配（URL 也参与，搜 http 命中全部）',
     _sub1('function searchScore(a, k) {',
           "function searchScore(a, k) { if (JSON.stringify(a).toLowerCase().includes(k)) return 1;")),
    ('M27 丢掉五档加权（所有命中一律返回 1）',
     _sub1('        if (String(x).toLowerCase().includes(k)) return SEARCH_FIELDS.length - i;',
           '        if (String(x).toLowerCase().includes(k)) return 1;')),
    ('M28 搜索退回整页重渲染 + focus hack（#kw 节点被重建，焦点靠手工捞回）',
     _sub1("    inp.addEventListener('input', e=>{\n      kw = e.target.value;\n      refreshList();\n    });",
           "    inp.addEventListener('input', e=>{\n      kw = e.target.value; const p=e.target.selectionStart; render();\n"
           "      const n=document.getElementById('kw'); if(n){ n.focus(); n.setSelectionRange(p,p); }\n    });")),
    ('M29 最宽一档断点抬到 1500px（越过了默认窗口 1424，默认观感会被改掉）',
     _sub1('@media (max-width:1200px){', '@media (max-width:1500px){')),
    ('M30 整块删掉响应式档 1（精选块不再切列，断点从 3 档掉到 2 档）',
     lambda s: re.sub(r'@media \(max-width:1200px\)\{.*?\n\}\n', '', s, count=1, flags=re.S)),

    # ---- ★v15 本机三页（游戏库 / 我的游戏 / 下载管理）----
    # 注：v14 那批打 hubNav 的打坏点已随模块下线一起退场（代码里连 id 都没了，
    #     留着只会报「替换未命中」）。这里换成 v15 新增守卫点的反证。
    # 判据同前：打坏后**页面照跑**，只是「不该发生的行为发生了」，断言必须变红。
    # ★ old 串带上 ` data-url=` 这段上下文才唯一 ——
    #   光写 `data-dlstart="1"` 会先命中 dlBtns 上面那句注释（本文件里注释也写了这个字面量），
    #   真代码没被打坏 ⇒ 打坏 442/442、变红 0 条（这是本轮反证唯一一次 FAIL，已记进文档）。
    ('M31 data-dlstart 写成空属性（dataset.dlstart === "" 是 falsy ⇒ 按钮点了没反应）',
     _sub1('data-dlstart="1" data-url=', 'data-dlstart data-url=')),
    ('M32 dlBtns 一律当直链（网盘分享页也画成「客户端下载」，假装能直下）',
     _sub1('const direct = isDirectFile(url);', 'const direct = true;')),
    ('M33 我的游戏默认渲染全部候选（把 7-Zip / 飞书 这类非游戏快捷方式也铺满页面）',
     _sub1('const list = showAll ? G : hits;', 'const list = G;')),
    ('M34 matchLocal 撤掉 simName 闸门（模糊搜索返回什么就认什么 ⇒ 假匹配）',
     _sub1('hits.find(h => simName(nm, h.title))', 'hits.find(h => true)')),
    # ★ 2026-10-16 收紧判据后重写：原锚点是 `return parts.some(y => x === y || x.includes(y) …)`
    #   （字符级包含）。实拍发现它会把 Run 认成 Runehaven、Paint 认成 City Painter …，
    #   于是 simName 改成「整串归一化相等 / 词集完全相同」，锚点随之换。
    ('M35 simName 退回「字符级包含」（Run 被认成 Runehaven —— 实拍量到的假阳性回归）',
     _sub1('    if(xs.length && xs.length === ys.length && xs.every(w => ys.includes(w))) return true;',
           '    if(xs.some(w => ys.some(y => y.includes(w)))) return true;')),
    ('M36 侧栏「本机」三页少一个（下载管理从 TABS 里摘掉，早退分支指向不存在的页）',
     _sub1("downloads:{t:'下载管理', kind:'dl'},", '')),
    ('M37 侧栏计数元素 id 改掉（c-lib 找不到 ⇒ 游戏库计数永远显示「—」）',
     _sub1('id="c-lib"', 'id="c-libX"')),
    ('M38 HAS_SHELL 硬编码为 true（离线态也画出「开始扫描」死按钮）',
     _sub1('const HAS_SHELL = !!SHELL;', 'const HAS_SHELL = true;')),
    ('M39 详情弹窗下载区块的占位块 #dlBlock 不进 DOM（详情里不再有下载区）',
     _sub1('<div class="dblock" id="dlBlock">', '<div class="dblock" id="dlBlockX">')),

    # ---- ★v15 顶栏实时态必须**常驻**（2026-10-16 追加）----
    # 原实现走 svcFlash：闪 4 秒就还原成「数据快照 · 2026-10-15 18:25」，
    # 于是**常驻**文案反而在暗示「数据是旧的、没实时同步」—— 与用户诉求正好相反。
    # 注：svcFlash 多收两个参数没关系（JS 忽略多余实参），页面照常跑。
    # ★ 锚点用「已载」而不是旧的「PC 侧」—— 文案已按「同时报已载与库共」改过（2026-10-16 实拍发现）。
    ('M40 实时态退回 svcFlash（闪 4 秒就还原成「数据快照」，常驻文案反在说「没实时同步」）',
     _sub1("svcPin('实时库已接入',",
           "svcFlash('实时库已接入',")),

    # ---- ★v15 另两处实测驱动的口径（2026-10-16 追加）----
    # 上游 scope=mob 的 total 是 3,351、scope=pc 是 19,590 —— 差一个数量级，
    # 而 UI 上的「PC 端游」高亮只反映 L.scope==='pc'，抓不到「默认值被写错」。
    ('M41 游戏库默认 scope 改成 mob（首屏从 PC 端游全量变成手游，19,590 → 3,351）',
     _sub1("sort:'updated', scope:'pc'", "sort:'updated', scope:'mob'")),
    # 去掉最后那句 scanning=false ⇒ 状态顺序被破坏，断言该红。
    ('M42 去掉扫盘收尾的 scanning=false（状态与界面不再同步）',
     _sub1('  LOCAL.games = games;\n  LOCAL.scanned = true;\n  LOCAL.scanning = false;',
           '  LOCAL.games = games;\n  LOCAL.scanned = true;')),
    # manual 的按钮判据：应按 state 给「复制链接」，不是只给 kind==='netdisk' 那类
    # （无后缀的 URL 也会落进 manual，但 kind 仍是 'file'）。
    ('M43 manual 的「复制链接」退回「只给网盘」（非网盘的手动任务拿不到任何操作）',
     _sub1("${j.state === 'manual' && j.url ?", "${j.kind === 'netdisk' && j.url ?")),

    # ---- ★v16-A 分页 + 「不显示数量」（2026-10-16 追加）----
    # 用户 ① 口径：「不显示数量，避免出问题（一页显示 50 个，设置多页…页面跳转）」。

    # 默认页长改掉 ⇒ 「20/50/100，默认 50」这条直接红。
    ('M44 默认页长 50 → 500（一页铺 500 条，等于把「分页」变成「一次全刷」）',
     _sub1('const PG_DEF = 50;', 'const PG_DEF = 500;')),
    # 切片函数改成不切 ⇒ 「第 1 页条数 = 页长」这条红（页码会换、数据却不换）。
    ('M45 pgSlice 不再切片（页码照跳、数据纹丝不动 ⇒ 分页是假的）',
     _sub1('  const start = (p.page - 1) * p.size;\n  return list.slice(start, start + p.size);',
           '  const start = (p.page - 1) * p.size;\n  return list;')),
    # 搜索时不同步换分页条 ⇒ 「共 N 条」停在上一次结果上，与新列表自相矛盾。
    ('M46 refreshList 不再同步替换分页条（条上的「共 N 条」会停在旧结果）',
     _sub1("  const old = main.querySelector('.pager');",
           "  const old = null;")),
    # 侧栏计数取消隐藏 ⇒ ① 的口径被破坏（数字又上屏，与分页条的「共 N 条」打架）。
    # ★ 锚串带前导 `\n`：`.nav .cnt{display:none}` 这个**字面量极容易被写进说明注释**
    #   （v18 就真的写进去过一次 —— 见 index.html 里 `.ext` 那段注释），
    #   带 `\n` 后只可能命中真 CSS 那一行，注释里的引用不会再抢走替换点。
    ('M47 侧栏计数取消 CSS 隐藏（数字重新上屏，与分页条的两个口径打架）',
     _sub1('\n.nav .cnt{display:none}', '\n.nav .cnt{display:inline}')),
    # 页长切换不回第 1 页 ⇒ 用户从第 9 页把页长调大，会落在空页上。
    ('M48 换页长后不回第 1 页（从小页长切到大页长会落进空页）',
     _sub1("    p.size = parseInt(sel.value, 10) || PG_DEF;\n    p.page = 1;",
           "    p.size = parseInt(sel.value, 10) || PG_DEF;")),

    # ---- ★v16-B 全局搜索弹窗（2026-10-16 追加）----
    # 用户 ② 口径：「补充全局搜索入口弹窗，且搜索后也是弹窗显示」。

    # 点结果不开详情 ⇒ 「搜索 → 看详情」这条链断掉，结果只能看不能进。
    # ★v16-D 重写锚点：点击入口已从「直接 openDetailRec」改成**一个分派点** searchPick()
    #   （详情 / 关联 / 加入 三选一）。要打坏的是「点下去没反应」，
    #   所以直接把那次调用换成空操作 —— 意图与 v16-B 时一致。
    ('M49 搜索弹窗点结果行没反应（结果点不进去，也关联/加入不了）',
     _sub1('searchPick(SSEARCH.items[Number(r.dataset.si)])',
           'void 0')),
    # Ctrl+K 失效 ⇒ 全局搜索入口少一条（用户要的就是「入口」）。
    ('M50 去掉 Ctrl+K 快捷键（只剩顶栏按钮这一个入口）',
     _sub1("    if((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')){",
           "    if(false){")),
    # Esc 关不掉 ⇒ 键盘用户被关在弹窗里（只有鼠标能出）。
    ('M51 去掉 Esc 关闭（键盘用户被关在搜索弹窗里）',
     _sub1("    if(e.key === 'Escape' && open){ e.preventDefault(); closeSearch(); }",
           "    if(false){ /* 去掉 Esc 关闭 */ }")),
    # 空关键词不清空 ⇒ `includes('')` 恒真，会把「全部结果」当成空关键词的结果铺出来。
    ('M52 空关键词不清空结果（includes(\'\') 恒真 ⇒ 空搜索反而铺出全部结果）',
     _sub1("  if(!k){ S.items = []; S.total = 0; S.loading = false; searchRender(); return; }",
           "  if(false){ /* 去掉空词清空 */ }")),

    # ---- v16-C：自动获取 / 资源角标 / 429 口径 ----
    # 0 也出角标 ⇒ 角标不再代表「有资源」，变成噪音（用户看角标反而更迷惑）。
    ('M53 资源角标把 0 也画出来（`if(n(r.mod))` 改成 `!== undefined` ⇒ 0 条也出 🧩0）',
     _sub1('if(n(r.mod))', 'if(n(r.mod) !== undefined)')),
    # 429 走「真没有」分支 ⇒ 把源站限流说成「这款游戏没有本体」，就是对用户撒谎（④ 的核心）。
    ('M54 限流分支改 if(false)（429 掉进「没有可直接打开的网盘地址」⇒ 口径撒谎）',
     _sub1('      if (d.rateLimited || d.transient) {', '      if (false) {')),
    # 重试不清缓存 ⇒ 按钮取回同一份失败结果 = 摆设。
    ('M55 重试不清缓存（按钮点下去取回的是同一份失败结果，等于没重试）',
     _sub1('    DL_CACHE.delete(dlCacheKey(dlSt, k));', '    /* 不清缓存 */')),
    # 失败也进缓存 ⇒ 10 分钟内怎么点都在读同一份坏数据。
    ('M56 失败结果也进缓存（限流 10 分钟内被钉死，重试永远无效）',
     _sub1("  if (d && !d.err && !(k === 'body' && (d.rateLimited || d.transient))) dlCacheSet(st, k, d);",
           '  if (d) dlCacheSet(st, k, d);')),
    # 两个 data-dlretry 撞名 ⇒ 「重试某页签数据」与「重试某下载任务」共用一个选择器。
    ('M57 弹窗重试退回 data-dlretry（与下载任务重试撞名，共用一个选择器）',
     _sub1('data-dlretryk="${esc(k)}"', 'data-dlretry="${esc(k)}"')),
    # appid 透传退回写死空串 ⇒ 本机扫盘的 steam id 无法与库记录对上（v16-D 的命根）。
    ('M58 livePC 的 appid 退回写死空串（本机 Steam id 无法与库记录关联）',
     _sub1("appid: a.appid ? String(a.appid) : ''", "appid: ''")),

    # ---- v16-D：本机游戏 ↔ 库记录 关联 ----
    # 关联键退回名字 ⇒ 游戏改名 / 繁简 / 后缀一变，之前的关联全部失效。
    ('M59 关联键不再优先 appid（改用归一化名 ⇒ 游戏改名后关联全丢）',
     _sub1("if(sid) return 'sid:' + sid;", "if(false) return 'sid:' + sid;")),
    # 不套已存关联 ⇒ 每次打开都要重打一轮上游；离线直接全空。
    ('M60 linkApply 不套已存关联（重扫零请求复用失效，离线全空）',
     _sub1("    if(rec){ g.hit = rec; g.via = rec.via || 'auto'; }",
           '    if(false){ /* 不套已存关联 */ }')),
    # 解除关联无效 ⇒ 用户改错了也退不回来（比不能关联更糟）。
    ('M61 linkDel 变成空操作（关联错了永远解不掉）',
     _sub1("  if(k && LOCAL.links[k]){ delete LOCAL.links[k]; linkSave(); return true; }",
           '  if(k) return true;')),
    # appid 硬命中挪到名字闸门之后 ⇒ 名字闸门一旦先命中，Steam id 这条硬证据就永远用不上。
    ('M62 appid 硬命中挪到名字闸门之后（硬证据被软判据抢先）',
     _sub1("        if(sid){\n          const m = hits.find(h => String(h.appid || '') === sid);\n          if(m){ pick = m; via = 'appid'; }\n        }\n        /* ③ 名字闸门（归一化整串相等 / 词集相同），与 v15 同一条口径 */\n        if(!pick){\n          const m = hits.find(h => simName(nm, h.title));\n          if(m){ pick = m; via = 'name'; }\n        }",
           "        if(!pick){\n          const m = hits.find(h => simName(nm, h.title));\n          if(m){ pick = m; via = 'name'; }\n        }\n        if(sid){\n          const m = hits.find(h => String(h.appid || '') === sid);\n          if(m){ pick = m; via = 'appid'; }\n        }")),
    # 未匹配行也给 data-d ⇒ 假交互：点没匹配的行会弹出别人的下载弹窗。
    ('M63 未匹配行也挂 data-d（点没匹配的行会弹出别人的资源弹窗）',
     _sub1("${matched ? ` data-d=\"myGames\" data-i=\"${idx}\"` : ''}",
           ' data-d="myGames" data-i="${idx}"')),
    # 用页内下标当关联下标 ⇒ 翻页 / 切「显示全部候选」之后下标漂移，绑错游戏。
    ('M64 关联下标改用页内下标（翻页/切换候选后绑到别的游戏上）',
     _sub1('      return mgRowHTML(x, idx, G.indexOf(x));', '      return mgRowHTML(x, idx, idx);')),
    # 分派点丢掉关联分支 ⇒ 「关联到库…」点了只会开详情，关联永远落不下去。
    ('M65 分派点丢掉关联分支（点结果只开详情，关联永不生效）',
     _sub1("  if(LOCAL.pendingLink){ linkCommit(a); return; }", '  if(false){ linkCommit(a); return; }')),
    # 关搜索不退出关联模式 ⇒ pending 残留，下一次随手 Ctrl+K 点结果会把本机那条绑到别的游戏。
    ('M66 关搜索不退出关联模式（pending 残留 ⇒ 下次搜游戏会误绑本机那条）',
     _sub1("  linkModeEnd();      /* ★v16-D：Esc / ✕ 关掉搜索 = 放弃本次「关联 / 加入」 */",
           '  /* 不退出关联模式 */')),

    # ---- v16-E：手游评分关联 + 标签筛选 ----
    # 不读上游本来就给的 libScore ⇒ 回归成「这页 60 张卡全是白板」。
    ('M67 liveMH 丢掉 libScore（手游可玩页回归「60 张卡一个评分都没有」）',
     _sub1("score: sc || '', scoreV: sc, scoreLab: '端游库评分',",
           "score: '', scoreV: 0, scoreLab: '端游库评分',")),
    # 把语义不明的 dl 当热度 ⇒ 编一个「下载量」标签误导用户（红线：宁可不显示也不猜）。
    ('M68 把语义不明的 dl 当热度用（给用户编一个「下载量」假标签）',
     _sub1("score: sc || '', scoreV: sc, scoreLab: '端游库评分',",
           "score: sc || '', scoreV: sc, scoreLab: '端游库评分', hot: Number(a.dl) || 0,")),
    # 无 hasTr/hasSv 也造 res ⇒ 角标变成噪音（🧩0 / 💾0 满屏）。
    ('M69 没有 hasTr/hasSv 也造 res 对象（角标退化成满屏 🧩0 噪音）',
     _sub1("    res: (a.hasTr || a.hasSv) ? { trainers: a.hasTr ? 1 : 0, saves: a.hasSv ? 1 : 0 } : null,",
           '    res: { trainers: a.hasTr ? 1 : 0, saves: a.hasSv ? 1 : 0 },')),
    # optsFor 不摊平数组 ⇒ 数组字段的筛选按钮全点不动（原实现的真实缺陷）。
    ('M70 optsFor 不摊平数组字段（标签筛选全点不动 —— 原实现缺陷回归）',
     _sub1('    const vals = Array.isArray(v) ? v : [v];', '    const vals = [v];')),
    # top 不截断 ⇒ 标签栏铺出上百个按钮。
    ('M71 optsFor 不截断 top（标签栏铺出上百个按钮）',
     _sub1('  if(grp.top) arr=arr.slice(0,grp.top);', '  if(false) arr=arr.slice(0,grp.top);')),
    # 卡上标签不可点 ⇒ 标签只能靠筛选栏筛（用户 ⑥ 要的是「标签能筛选」，点卡上标签是最短路径）。
    ('M72 卡上标签不再挂筛选协议（点标签变成点卡片、弹出无关弹窗）',
     _sub1('data-fg="tags" data-fv="${esc(t)}"', 'data-fg="tagx" data-fv="${esc(t)}"')),
    # refreshList 不重绑 ⇒ 搜索框里敲一个字之后，卡上标签就点不动了。
    ('M73 refreshList 不重绑标签（搜索框敲一个字后就点不动了）',
     _sub1('  bindTagPills(box);', '  /* 不重绑 */')),
    # 两处都绑 ⇒ 一次点击 toggle 两次 = 等于没点（自反）。
    ('M74 筛选栏绑定不排除 .tap（一次点击 toggle 两次 = 等于没点）',
     _sub1("main.querySelectorAll('[data-fg]:not(.tap)')", "main.querySelectorAll('[data-fg]')")),
    # 活动卡不显示评分 ⇒ 41/131 条有分却上不了卡。
    ('M75 活动卡不显示评分（41/131 条有分却上不了卡）',
     _sub1('  if(Number(a.score) > 0) top.push(`<span class="pill score" title="源站评分">★ ${esc(fmtScore(a.score))}</span>`);',
           '  if(false) top.push(`<span class="pill score" title="源站评分">★ ${esc(fmtScore(a.score))}</span>`);')),
    # recent 走字符串比较 ⇒ unix 秒按字典序排，顺序完全错。
    ('M76 「最近更新」用字符串比较（unix 秒按字典序排 ⇒ 顺序完全错）',
     _sub1("  recent:(a,b)=> (Number(gv(b,'recent'))||0)-(Number(gv(a,'recent'))||0),",
           "  recent:(a,b)=> String(gv(b,'recent')).localeCompare(String(gv(a,'recent'))),")),

    # ---- v16-F：活动图逐图适配 ----
    # 判定不限 .wd ⇒ 新游卡的 1:1 icon 也被塞进 .fit（那一页本来零裁切，等于无事生非）。
    ('M77 fitThumb 不限 .wd 容器（新游卡也被改，那页本来零裁切）',
     _sub1("  if(!box.classList.contains('wd')) return;      /* 新游卡本来就是 1:1（实测 59/59 零裁切） */",
           '  if(false) return;')),
    # 所有图都判成正方 ⇒ 48/60 的横版图被塞进正方框（修好 20%、弄坏 80%）。
    ('M78 所有图都判成正方（把 48/60 的横版图也塞进正方框）',
     _sub1("  box.classList.toggle('fit', ar >= 0.85 && ar <= 1.18);",
           '  box.classList.toggle(\'fit\', true);')),
    # 只改 contain 不换容器 ⇒ 宽容器里左右留衬底（v11 已实测排除过的做法）。
    ('M79 只改 contain 不换容器（宽框里留衬底 —— v11 已排除的做法）',
     _sub1('.mth.wd.fit{width:var(--mb-thw);aspect-ratio:1 / 1}\n', '')),
    # 图片退回 88px ⇒ 用户 ⑦「放大」没做。
    ('M80 活动图退回 88px 宽（用户 ⑦「图片放大一点」没做）',
     _sub1('  --mb-tw:112px;', '  --mb-tw:88px;')),
    # 卡高退回 106 ⇒ 图放大了但卡没跟上（图片被挤扁/溢出）。
    ('M81 活动卡高度退回 106px（图放大了卡没跟上，会挤扁）',
     _sub1('.mcard{height:118px;padding-top:26px}', '.mcard{height:106px;padding-top:26px}')),
    # 图没解出来也硬算比例 ⇒ 0/0=NaN 被 `||1` 兜成 1 ⇒ 把未解出的图也判成正方。
    # 图没解出来也硬算比例 ⇒ 未解出的图全被当正方。
    # ★★ 这条的**第一版打坏点是无效的**（2026-10-16 全量跑出来「变红 0 条」）：
    #    原来只打 `const ar = w / h;`，可上面那行 `if(!w || !h) return;` 早就把
    #    「没解出来」挡掉了 ⇒ 打坏的是**不可达路径**，行为一字不变、断言当然不红。
    #    ⇒ 按判据「打坏点打偏了 → 修打坏点」，改成**同时打掉守卫 + 补 0/0 兜底**，
    #      这才真的把「未解出的图当正方」造出来（M59 那种「打偏到注释」的同类问题，
    #      区别是那次自检能拦、这次只能靠全量跑出来 —— 所以全量还是不能不跑）。
    ('M82 图没解出来也硬算比例（0/0 兜成 1 ⇒ 未解出的图全被当正方）',
     # 用正则而不是 `_sub1`：那两行之间/行尾带注释，逐字符抄容易抄错空白，
     # 而 `[^\n]*` 把「行尾注释」整段吃掉，锚点稳得多（同 M4 / M8 / M10 的做法）。
     lambda s: re.sub(r'\n  if\(!w \|\| !h\) return;[^\n]*\n  const ar = w / h;',
                      '\n  const ar = (w / h) || 1;', s, count=1)),
    # 标题不放大 ⇒ 用户 ⑦「标题放大一点」没做。
    ('M83 活动卡标题不放大（用户 ⑦「标题放大一点」没做）',
     _sub1('.mcard.ev .mt{font-size:14.5px;line-height:22px;height:22px}',
           '.mcard.ev .mt{font-size:13px;line-height:22px;height:22px}')),

    # ---- ★v16-H 网盘直链外挂（OpenList / AList）----
    # 三条件缺一 ⇒ 「不验证也自称已连接」。这里专门去掉 probed（最容易被顺手放过的一个），
    # 因为它「看起来」只是缓存：一个刚启动、还没连过任何东西的 App 会直接亮绿灯。
    ('M84 olReady 少一个条件（去掉 probed ⇒ 不验证就是已连接）',
     _sub1('function olReady(){ return !!(OL.base && OL.probed && OL.exp); }',
           'function olReady(){ return !!(OL.base && OL.exp); }')),
    # probed/tried 落盘 ⇒ 下次启动读回一个「上次连过」的假状态。
    ('M85 probed 也落盘（下次启动不验证也自称已连接）',
     _sub1('dir:OL.dir, exp:OL.exp })); }catch(e){}',
           'dir:OL.dir, exp:OL.exp, probed:OL.probed })); }catch(e){}')),
    # 未就绪也渲染转存按钮 ⇒ 正好是用户点名不要的那种「点了必然报错」的按钮。
    ('M86 未就绪也渲染「↪ 转存到网盘」按钮（给用户一个点了必然报错的按钮）',
     _sub1('+ ((!direct && olReady()) ?', '+ ((!direct) ?')),
    # 从同一个 document 级委托里漏掉 ⇒ 页面里没有第二处 ⇒ 死按钮。
    ('M87 转存按钮没挂进下载委托（漏在 closest 里 ⇒ 点了完全没反应）',
     _sub1(",[data-dlretry],[data-olput]');", ",[data-dlretry]');")),
    # 未就绪不拒绝 ⇒ 白打一个必然失败的请求，而且把「没配好」说成「服务端报错」。
    ('M88 未就绪时 olTransfer 也照发请求（拿服务端报错当配置错误的兜底）',
     _sub1("  if(!olReady()) return { ok:false, err:'OpenList 未就绪（需先连接测试并勾选实验开关）' };",
           "  if(false) return { ok:false, err:'x' };")),
    # AList/OpenList 的错误写在 body 的 code 里（HTTP 仍是 200）⇒ 不看 body 会全漏。
    ('M89 只看 HTTP 状态、不看 body 里的 code（AList 的错误全在 body 里 ⇒ 静默当成功）',
     _sub1("    if(j && j.code !== undefined && Number(j.code) !== 200) throw new Error('code=' + j.code + ' · ' + (j.message || ''));",
           "    if(false && j) throw new Error('code');")),
    # 非 JSON（地址填到了别的服务）当成功 ⇒ 用户永远不知道自己填错了地址。
    ('M90 返回不是 JSON 也当成功（地址填到别的服务上，用户永远看不出来）',
     _sub1("    if(!j) throw new Error('返回不是 JSON（可能地址填到了别的服务）');",
           "    if(!j) return {};")),
    # 自检报「连接成功」四个字，不转述真实存储 ⇒ 用户无法判断到底通没通到他的网盘。
    ('M91 连接测试不回真实存储列表（说了等于没说，用户无从判断通没通到自己的网盘）',
     _sub1("    OL.note = names.length ? ('已连接 · ' + names.length + ' 个存储：' + names.slice(0, 4).join(' / ') + (names.length > 4 ? ' …' : '')) : '已连接，但根目录下没有挂载任何存储';",
           "    OL.note = '已连接';")),
    # 自检没过却不关实验开关 ⇒ 状态与视图打架（看着关着、其实开着）。
    ('M92 自检失败不关实验开关（状态与视图打架：看着是关的，OL.exp 还是 true）',
     _sub1('    if(!OL.probed && OL.exp){ OL.exp = false; olSave(); }\n',
           '')),
    # 勾选框回读只看 OL.exp ⇒ 与「转存按钮出不出来」的判据不一致。
    ('M93 勾选框回读只看 OL.exp（与「按钮出不出来」的判据不一致）',
     _sub1('c.checked = !!(OL.probed && OL.exp);', 'c.checked = !!OL.exp;')),
    # 配置块不进下载页 ⇒ 用户根本没有入口去配它（功能等于不存在）。
    ('M94 配置块没渲染进下载管理页（功能等于不存在：没有任何入口）',
     _sub1('+ olCardHTML() + footNote();', '+ footNote();')),
    # 结果不标红/标好在视觉上不区分 ⇒ 成功失败一个样。
    ('M95 转存结果不分成功/失败两态（视觉上一样 ⇒ 用户看不出成没成）',
     _sub1("el.className = 'olres' + (ok ? ' ok' : (text ? ' bad' : ''));",
           "el.className = 'olres';")),

    # ---- ★v16-B 修正：带 prefill 打开搜索必须真的搜 ----
    # 这条是**成品实拍**才发现的（633 条断言全绿，但用户看到的是「框里有字、下面空态」）：
    # 程序化赋 value 不派发 input，而搜索只挂在 input 的防抖上。
    # ⇒ 退回到「只填字不搜」，断言必须变红。**这类缺口正是实拍存在的理由。**
    ('M96 带关键词打开搜索只填字不搜（用户看到「框里有字、结果区空态」⇒ 以为搜索坏了）',
     _sub1('  if(prefill != null && String(prefill).trim()) searchRun(String(prefill).trim(), 1);',
           '  if(false) searchRun(String(prefill).trim(), 1);')),

    # ---- ★v17 详情页同步工作台 + 跨源同款合并（用户 2026-10-16 口径）----
    # 列表层合并：跨源同款只出一条。
    # 不截「/」前段 ⇒「剑星/Stellar Blade」与「剑星」归一到不同键 ⇒ 该并的没并。
    ('M97 归一化不截「/」前段（「剑星/Stellar Blade」不再与「剑星」并成一条）',
     _sub1("  return String(s || '').split('/')[0]",
           "  return String(s || '')")),
    # 认出了重复却不记 skip ⇒ 屏幕上照样两条（等于没合并）。
    ('M98 合并索引不记 skip（同款照旧渲染两次 —— 等于没合并）',
     _sub1('      skip.add(i);', '      void 0;')),
    # 合并算出来了，渲染时却没用 ⇒ 白算。
    ('M99 渲染时不用 skip 过滤（合并算了却没用上）',
     _sub1('    if (MG.skip.has(i)) return;', '    if (false) return;')),
    # 同款标记删掉 ⇒ 用户会以为库里就这一条（另外几条凭空消失）。
    ('M100 主条不出「⊕ 另有 N 条同款」标记（用户会以为库里就这一条）',
     _sub1('class="pill mg"', 'class="pill"')),

    # ---- 详情页补水（对齐工作台 /api/detail/merged）----
    # 探不到服务时不摘占位 ⇒ 线上静态部署多出一排空块（违背「零副作用」契约）。
    ('M101 探不到服务时不摘占位（线上静态部署会多出一排空块）',
     _sub1("    DD_SLOTS.forEach(id => ddSet(id, ''));", '    void 0;')),
    # 去掉「节点还在文档里」的校验 ⇒ 异步回包会写进已销毁的弹窗（换游戏就串台）。
    ('M102 ddSet 去掉「节点还在文档里」的校验（回包晚到会写错弹窗）',
     _sub1('  if (!el || !document.body.contains(el)) return;', '  if (!el) return;')),
    # 不递增会话号 ⇒ 第 1 款游戏的异步回包会漏进第 2 款。
    ('M103 开弹窗不递增会话号（第 1 款的回包会流进第 2 款）',
     _sub1('  const seq = ++DD_SEQ;', '  const seq = DD_SEQ;')),
    ('M104 关弹窗不作废会话号（关窗后回包仍会被接受）',
     _sub1('  DD_SEQ++;', '  void 0;')),
    # 翻页不夹索引 ⇒ 点过头翻到空白（图没了、计数还在）。
    ('M105 画廊翻页不夹索引（点过头翻到空白页）',
     _sub1('  i = Math.max(0, Math.min(n - 1, i));', '  i = i | 0;')),

    # ---- ★v17 顺带修掉的既有缺陷：实时库的域名是 xdgamer.com，不是 xdgame.com ----
    ('M106 DL_URL_RE 又漏掉 xdgamer.com（实时库的详情页一律取不到源站 URL）',
     _sub1('xdgame(?:r)?\\.com\\/game\\/', 'xdgame\\.com\\/game\\/')),

    # ---- ★v18 管理页入口（用户 2026-10-16 口径：工作台 = 这个 App 的管理页）----
    # 这 7 条守的是**同一件事**：demo 同时要跑在浏览器 / 线上静态部署里，**那里没有壳**。
    # 「无壳优雅降级」一旦破，用户看到的就是一个点了必然没反应的按钮。
    ('M107 入口 HTML 去掉 `hidden`（先闪出一个点了没反应的按钮，再被 JS 藏回去）',
     _sub1('<a href="#" id="adminNav" hidden>', '<a href="#" id="adminNav">')),
    ('M108 入口误挂 `data-tab`（它不是本页 Tab ⇒ 会被事件委托当成切页，触发`无法解析`）',
     _sub1('<a href="#" id="adminNav" hidden>', '<a href="#" id="adminNav" data-tab="admin" hidden>')),
    ('M109 有壳判据改用旧全局 `SHELL`（v15/v16 壳也有 SHELL ⇒ 显示一个点了静默失败的入口）',
     _sub1("const ADMIN_OPEN = (typeof window !== 'undefined' && typeof window.__SHELL_ADMIN__ === 'function')",
           "const ADMIN_OPEN = (typeof window !== 'undefined' && typeof SHELL === 'object')")),
    ('M110 无壳时不清场（入口留在半截状态：有壳没壳都显示）',
     _sub1("  if(!ADMIN_OPEN){ a.hidden = true; return; }", "  if(false){ a.hidden = true; return; }")),
    ('M111 点击不 `preventDefault`（`href="#"` 会把页面顶到最上面）',
     _sub1("a.addEventListener('click', e => { e.preventDefault(); ADMIN_OPEN('toggle'); });",
           "a.addEventListener('click', e => { ADMIN_OPEN('toggle'); });")),
    ('M112 页面把 URL 也塞给壳（越过「只传动作名」的边界，起始页就不再由主进程决定）',
     _sub1("a.addEventListener('click', e => { e.preventDefault(); ADMIN_OPEN('toggle'); });",
           "a.addEventListener('click', e => { e.preventDefault(); ADMIN_OPEN('open:/index.html'); });")),
    ('M113 ↗ 提示复用 `.cnt`（v16-A 后 `.nav .cnt{display:none}` ⇒ 箭头被一起藏掉）',
     _sub1('<span class="ext">↗</span>', '<span class="cnt">↗</span>')),
    ('M119 `.nav a .ext` 的样式规则被改名（类名在 HTML 里、样式却挂不上）',
     _sub1('.nav a .ext{', '.nav a .cnt{')),

    # ---- ★v18 上游服务回读卡（只读两接口 / 归属照实说 / 探测式契约）----
    ('M114 两个只读请求改成串行（白等一趟 RTT，页面卡着不动）',
     _sub1("  const [pr, hi] = await Promise.all([\n"
           "    ddJson(base, '/api/library/progress', 8000),\n"
           "    ddJson(base, '/api/extract/history?n=6', 8000),\n"
           "  ]);",
           "  const pr = await ddJson(base, '/api/library/progress', 8000);\n"
           "  const hi = await ddJson(base, '/api/extract/history?n=6', 8000);")),
    ('M115 探不到本机服务时不摘卡（线上静态部署会多一张「正在读取…」的空卡）',
     _sub1("  if(!base){ card.remove(); return; }", "  if(!base){ return; }")),
    ('M116 归属三态退化 —— 外部实例也吹成「由 App 托管」（不许「应该是我拉的吧」）',
     _sub1("    : owner === 'external' ? '外部实例（App 只复用，不冒认）'",
           "    : owner === 'external' ? '由 App 托管（本壳 fork 的）'")),
    ('M117 `upFill` 不挂在 `olBind` 之后（翻页重渲染后这张卡变成空壳）',
     _sub1('  upFill(main);', '  void 0;')),
    ('M118 `upStateCls` 不再把 error / need-password 标红（失败与成功看着一样）',
     _sub1("  return v === 'done' ? 'done' : (v === 'error' || v === 'need-password' ? 'bad' : '');",
           "  return v === 'done' ? 'done' : '';")),

    # ---- ★v18 端口：页面必须用**壳自述的**监听端口，不能用死 8123 ----
    # 壳的上游端口会漂（`listen(port, triesLeft)` 端口被占自动 +1；`GAMEHUB_PORT` 也能被改），
    # 而情报站是从包内 file:// 直开的 ⇒ 只认死 8123 会去读**别人的实例**。
    ('M120 `dlBoot` 不问壳的端口（壳端口一漂，页面就去读别人家的上游）',
     _sub1("    if (SHELL && typeof SHELL.describe === 'function') {\n"
           "      try {\n"
           "        const d = await SHELL.describe();\n"
           "        const lp = d && Number(d.listenPort);\n"
           "        if (lp > 0) cands.push('http://127.0.0.1:' + lp);\n"
           "      } catch (_) { /* 自述失败 ⇒ 退回下面的默认候选，不影响任何既有路径 */ }\n"
           "    }\n", "")),

    # ---- ★v18 **实拍抓出来的真 bug**（692 条断言全绿也没拦住）----
    # `getElementById` 只在 `Document` / `DocumentFragment` 上，**`Element` 上没有**。
    # 调用处传的是 `#main` 这个 Element ⇒ 抛 `TypeError: scope.getElementById is not a function`，
    # 被 async 函数吞掉（无 catch）⇒ 上游服务卡永远停在「○ 探测中…」。
    # 为什么断言没拦住：原来那条行为断言传的是 **`document`**，恰好绕开了这个事实
    # ⇒ 现在同时补了「源码判据 + 传真 Element 的行为判据」两条，这条打坏必须让两条都红。
    ('M121 `upFill` 取卡退回 `(scope||document).getElementById` —— 传 `#main` 时抛 TypeError、'
     '卡片永远「○ 探测中…」（实拍抓出的 bug）',
     _sub1("  const card = (scope && scope.querySelector) ? scope.querySelector('#upcard') : document.getElementById('upcard');",
           "  const card = (scope || document).getElementById('upcard');")),
]


def run():
    p = subprocess.run([NODE, os.path.join(DIR, '_t_demo.js')],
                       cwd=DIR, env=ENV, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    m = re.search(r'通过 (\d+) / (\d+)', out)
    fails = re.findall(r'✗ (.+)', out)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None), fails


# ★★ 启动自检：_sub1 的 old 串必须在源文件里**唯一**出现。
#    理由见 _sub1 的 docstring —— 打偏到注释上会让反证出现盲区（M31 就是实例：
#    打坏「成功」，但真代码没动，于是「变红 0 条」被误读成「断言很弱」，
#    实际是**打坏点自己打偏了**，断言根本没被考到）。
#    这一条把「跑满 39 个点、约 10 分钟后才发现」变成「第 0 秒就报错」。
_dup = [(o, CLEAN.count(o)) for o in _UNIQ if CLEAN.count(o) != 1]
if _dup:
    print('!! _sub1 打坏点自检失败（old 串必须恰好出现 1 次）：')
    for _o, _n in _dup:
        print('   出现 %d 次: %r' % (_n, _o[:80]))
    raise SystemExit('请把上述打坏点的 old 串改到唯一（或改用 _suball 全量替换），'
                     '否则 str.replace(...,1) 可能打偏。')
print('打坏点自检：%d 个 _sub1 的 old 串在 index.html 里唯一 ✓' % len(_UNIQ))

print('=== 基线 ===')
# 基线也走 _mut.html（先写入与 index.html 完全一致的内容）——
# 这样「基线 / 打坏 / 还原」三条路径**读的是同一个文件**，不会出现
# 「基线读 index.html、打坏读 _mut.html」这种来源不一致的假象。
io.open(MUT_HTML, 'w', encoding='utf-8').write(CLEAN)
base, _ = run()
print('  基线 %s/%s' % base)
if base[0] is None:
    raise SystemExit('基线跑不起来，先修 _t_demo.js')

bad = 0
# ★ 单点重跑（2026-10-16 新增）：CP_ONLY=M40 只跑名字里含 "M40" 的打坏点。
# 动机：全量 43 处跑一遍约 15 分钟；改一处代码后只需要验与它相关的那几点。
# **只在调试时用** —— 交付前必须跑一次不带 CP_ONLY 的全量。
_ONLY = os.environ.get('CP_ONLY', '').strip()
_ran = 0
if _ONLY:
    _hit = [n for n, _ in MUT if _ONLY in n]
    if not _hit:
        raise SystemExit('CP_ONLY=%r 没匹配到任何打坏点（现有：%s）'
                         % (_ONLY, ', '.join(n.split()[0] for n, _ in MUT)))
    print('⚠️  CP_ONLY=%s ⇒ 只跑 %d 个点，**这不是全量反证**' % (_ONLY, len(_hit)))

for name, fn in MUT:
    if _ONLY and _ONLY not in name:
        continue
    _ran += 1
    mut = fn(CLEAN)
    if mut == CLEAN:
        print('  !! %s —— 替换未命中（脚本要修，说明源码已变）' % name)
        bad += 1
        continue
    io.open(MUT_HTML, 'w', encoding='utf-8').write(mut)
    (pp, tt), fails = run()
    # 还原 = 把干净内容写回 _mut.html（**不是删文件**：删了下次 run() 就读不到被测文件）
    io.open(MUT_HTML, 'w', encoding='utf-8').write(CLEAN)
    after, _ = run()
    status = 'OK' if (pp is not None and pp < base[0] and after == base) else 'FAIL'
    if status == 'FAIL':
        bad += 1
    note = '  ⟵ 打坏后测试**崩溃**（不是断言红，判据不够纯，要换打坏点）' if pp is None else ''
    print('%s  %-44s 打坏 %s/%s → 变红 %s 条 → 还原 %s/%s%s'
          % (status, name, pp, tt, len(fails), after[0], after[1], note))
    for f in fails[:3]:
        print('        ✗ ' + f[:88])

print('\n最终还原：%s/%s' % run()[0])
if os.path.exists(MUT_HTML):
    os.remove(MUT_HTML)
print('index.html 全程未被写入（md5: %s）' % __import__('hashlib').md5(
    io.open(HTML, 'rb').read()).hexdigest())
print('反证结论：%s%s' % (
    '全部命中 ✓' if bad == 0 else '有 %d 项未命中 ✗' % bad,
    ('　⚠️ 但只跑了 %d 个点（CP_ONLY=%s），**不是全量**，交付前请补跑全量' % (_ran, _ONLY))
    if _ONLY else ''))
raise SystemExit(1 if bad else 0)
