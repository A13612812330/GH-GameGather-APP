# electron/ · 游戏情报客户端壳

> 建立：**2026-10-15**　｜　**最近更新：2026-10-22（壳侧 v24；v25~v27 未改壳）**
> 上游 `game-aggregator` **零改动**（只 fork、只读）。方案全文见 `../PACK-GameHub-exe.md`。
>
> ⚠️ **先读 §七** —— 那是**壳现在的样子**（967 行，扫盘 + 下载器 + 8 个 IPC）。
> §一～§六 是 **2026-10-15 的 P0 最小验证记录**，保留作证据链，**不代表当前能力**。
> （P0 结论仍有效：「Electron 的 Node 能跑 express」这条真风险点已证伪。）

## 一、这是什么

一个最小 Electron 壳：**fork 上游 `server.js` 起本地服务 → 开原生窗口加载 `127.0.0.1`**。

它存在的唯一目的是**证伪整条 exe 路线**（PACK 方案 §二 第 1 步）——
按方案的说法：「过了第 1 步，后面都是体力活」。

## 二、怎么看（三个运行模式）

```bash
cd <项目根>/electron

# ① 正常开窗（用户实际用法）
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .

# ② 冒烟测试（不开窗，只验证 fork/探活/清理，CLI 可跑）
env -u ELECTRON_RUN_AS_NODE GAMEHUB_PORT=8199 ./node_modules/electron/dist/electron.exe . --smoke

# ③ 真实窗口截图（打包前的「成品像素」证据）
env -u ELECTRON_RUN_AS_NODE SHOT_WAIT_MS=9000 ./node_modules/electron/dist/electron.exe . \
  "--shot=<输出.png 绝对路径>"
```

**④ 零命令行（双击）** —— 已放好启动器，不用敲上面三条命令：

```
E:\新建文件夹\启动-GameHub壳.cmd
```

双击即可开窗。脚本用 `%~dp0` 相对定位到本目录，**内容全 ASCII**（避开中文路径在 cmd 下的编码坑），
内部自动清掉 `ELECTRON_RUN_AS_NODE`，跑完 `start` 就退回（黑框一闪即走）。

> 实测（2026-10-15 17:2x）：双击等效执行 → `Starting GameHub shell...` → 4 个 `electron.exe` 进程
> （主/GPU/渲染/工具，符合 Electron 进程模型）→ 窗口显示。壳侧 `--smoke` 同步跑 **PASS**（复用 8123，22 ms）。
> ⚠️ 从自动化终端里跑，窗口会随该终端会话回收而消失，**这是工具侧的进程树回收，不是脚本问题**；
> 手动双击时父进程是 explorer，不受影响。
> **等第 5 步打出成品 exe 后，这个 .cmd 可以删掉。**

> ⚠️ **`env -u ELECTRON_RUN_AS_NODE` 不是可选项** —— 本机环境变量里**已经存在** `ELECTRON_RUN_AS_NODE=1`
> （WorkBuddy 客户端设的）。带着它跑 `electron.exe`，主进程会退化成纯 Node，
> `require('electron')` 拿到的是**路径字符串而非 API 对象**，报
> `TypeError: Cannot read properties of undefined (reading 'on')`。
> **打包成 exe 后不受影响**（双击的 exe 不继承这个环境变量），但**开发和调试时必须清掉**。

## 三、P0 验证结果（2026-10-15，全部实测）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| ① | **启动等待** | ✅ **1061 ~ 1079 ms** | 空闲端口 fork → `内嵌服务就绪，耗时 1079 ms` |
| ② | **端口不撞** | ✅ 复用而非报错 | 8123 有服务时：`已有健康服务 ⇒ 直接复用，不 fork`，全过程 **21 ms** |
| ③ | **关窗无残留** | ✅ 端口释放、无孤儿进程 | 关窗后 `8199` 只剩 `TIME_WAIT`（非 LISTENING）、`tasklist` 无 `electron.exe` |
| ④ | **窗口真实显示** | ✅ 真窗口 + 真实页面 | `窗口已显示`；截图为 **1424×861** 真实渲染（见 `../exe-preview/shots/real-electron-window.png`） |

**最关键的一条**：`ELECTRON_RUN_AS_NODE=1` 环境下 **express 正常跑起来了** ——
这是整条路线唯一的真风险点（「Electron 的 Node 能不能跑 express」），现在证实**能**。

**未测项**：⑤ 断网可用 —— 未实拔网线。机制上可判定：页面与数据都走 `127.0.0.1` + 本地 `data/`，
**框架与列表一定可渲染**；外链封面图会挂（demo 自 v1 起就是外链图，属已知性质，非壳引入）。

## 四、文件

| 文件 | 作用 |
|---|---|
| `package.json` | 只声明 `electron@39.8.10`（命中本机已有缓存，`added 70 packages in 17s`） |
| `main.js` | 壳全部逻辑：探活 → fork / 复用 → 开窗 → 关窗清理；含 `--smoke` / `--shot` 两个调试模式 |
| `node_modules/` | 70 包，**零原生模块**（无 ABI 问题）；`electron.exe` 210 MB |

**配置项**（走环境变量，P0 用绝对路径，打包时改包内相对路径）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `GAMEHUB_ROOT` | `../../2026-09-03-16-11-58/game-aggregator` | 上游目录 |
| `GAMEHUB_PORT` | `8123` | 端口（上游 `server.js:37` 本来就读 `PORT`，壳只是传进去） |
| `SHOT_WAIT_MS` | `2600` | 截图前等待（外链封面慢，建议 7000~9000） |

## 五、P0 阶段查清的两件事（影响后面的步骤）

1. **上游启动期零写盘** —— `saveIdxState()` 只在抓取任务里调（`server.js:1697/1700/1701/1705/2091/2121`），
   启动只 `loadIdxState()`（读）。⇒ **fork 一个只做 GET 的实例不会污染 `data/`**，
   与正在跑的 8123/8124 并存是安全的（这次 P0 就是这么测的）。
2. **`server.js:670` 确实是唯一会坏的代码点** —— `spawn(process.execPath, …)` 在 Electron 下指向
   壳自己的 exe。影响面仅 `POST /api/bh/refresh` 一条路由，**其余 92 条路由无碍**。
   （另一处 `spawn('explorer.exe', …)` 在 2719 行，是系统程序，不受影响。）

## 六、下一步（方案 §二 第 2 步）

**demo 改造**：加 hash 深链（`?tab=pcNew`）+ 取数层改「API 优先、失败回落快照」。
这是第 3 步「合并 + 分页导航」的前置 —— 壳的左侧导航要能直接跳到 demo 的某个 Tab。

⚠️ 第 2 步会**改动 `demo/index.html`**，v12 指纹（`80d9dea4…`）随之变化，
必须重跑 `_t_demo.js`（345 条）与 `_counterproof.py`（25 处）。

---

## 七、★ 壳现在的样子（v15 · 2026-10-16）

> `main.js` **433 → 967 行**；`preload.js` **22 → 69 行**。
> 指纹：`main.js` = `bb6d66be8786f8017e5307c0edbc879b`、`preload.js` = `558bf967c23a35d77cc40d492d68ea08`。

### 7.1 它现在负责四件事

| # | 职责 | 落点 |
|---|---|---|
| ① | **起上游服务**（实时接口的唯一来源） | `fork` `upstream/server.js`；端口探活，**已有健康服务就复用**（21 ms） |
| ② | **开窗口加载情报站** | `loadFile(__dirname/intel/index.html)`。**不起本地静态服务** |
| ③ | **扫盘 + 匹配**（「我的游戏」） | `scanGames()` —— Steam 库 `libraryfolders.vdf` + `appmanifest_*.acf` + 桌面/开始菜单 `*.lnk` + 常见安装根目录。**不读注册表** |
| ④ | **下载器**（「下载管理」） | `startDownload()` / `cancelDownload()` —— Node `http/https` 取流、自定义 Referer、逐块上报、真 abort、白名单校验 |

### 7.2 IPC 清单（`ipcMain.handle` 11 个）

| 通道 | 页面侧（`__SHELL__`） | 作用 |
|---|---|---|
| `shell:fetch` | （兼容层）`__SHELL_FETCH__` | 壳内 HTTP（主进程侧白名单校验） |
| `shell:open` | （兼容层）`__SHELL_OPEN__` | 壳内打开上游页面 |
| `shell:scanGames` | `scanGames()` | 扫盘 |
| `shell:dl-start` | `startDownload({id,url,name})` | 开始下载（异步，进度走事件） |
| `shell:dl-cancel` | `cancelDownload(id)` | 中止（真 abort，不是只改 UI 状态） |
| `shell:copy` | `copyText(t)` | 复制到剪贴板（网盘分享链接用） |
| `shell:netdisk` | `openNetdisk(u)` | 唤起/打开网盘。**只接受常见网盘域名**，否则返回 `{ok:false}` 而**不抛错** |
| `shell:openPath` | `openPath(p)` | 打开已下载的文件。**白名单：只能打开本 APP 下载过的**（实测 `System32\calc.exe` 被拒） |
| `shell:revealPath` | `revealPath(p)` | 在资源管理器中定位 |
| `shell:describe` | `describe()` | 壳自述（版本 / 数据源 / 能力），页面据此决定降级 |
| `shell:titlebar` | `setTitlebar(dark)` | 同步窗口按钮配色（页面用 `MutationObserver` 观察 `data-theme`，**不去改 `applyTheme()`**，避免它提前引用 `SHELL` 踩 TDZ） |

**进度是主进程推、渲染进程收**：`ipcRenderer.on('shell:dl-progress', …)` → `__SHELL__.onDownload(cb)` 注册回调。
节流 **400 ms**；落盘目录 `app.getPath('downloads')/GameIntel`。

### 7.3 环境变量（全部）

| 变量 | 默认 | 说明 |
|---|---|---|
| `GAMEHUB_ROOT` | 包内 `../upstream` | 上游目录 |
| `GAMEHUB_PORT` | `8123` | 端口（上游 `server.js:37` 本来就读 `PORT`） |
| **`GAMEHUB_INTEL`** | 包内 `intel/index.html` | **开发期专用口子** —— 开发时没有 `intel/` 目录，不指路壳会弹「找不到情报站页面」。**成品不传** |
| `GAMEHUB_START` | — | 改落地页（⚠️ **Git Bash 会把它当路径改写**，要加 `MSYS_NO_PATHCONV=1`） |
| `SHOT_WAIT_MS` | `2600` | 截图前等待（外链封面建议 **7000~9000**） |
| `SHOT_JS` / `SHOT_JS_WAIT_MS` | — | 截图前注入脚本（拍特定弹窗/切页用） |

### 7.4 ★ 截图模式的两条硬规矩

1. **`--shot=` 不能传中文路径** —— 会**静默失败**（窗口自行关闭、不存盘、不报错）。
2. **窗口在后台时 `capturePage()` 返回陈旧合成帧** —— 本机实测：`goTab()` 成功、DOM 也对，
   但抓出来的是**首页**。修法（只在 `--shot` 下生效）：

```js
if (SHOT_PATH) {
  try { win.webContents.setBackgroundThrottling(false); } catch (e) { /* 忽略 */ }
}
/* …抓帧前… */
try { win.webContents.invalidate(); } catch (e) { /* 老版本无此 API 时忽略 */ }
await new Promise((r) => setTimeout(r, 600));
const img = await win.webContents.capturePage();
```

> **教训**：截图「看着不对」时，先分清**是产品不对还是相机不对** ——
> 用 `cur` trace + 源码审计证明功能正常，再去修工具。否则会为一个假象去改一处好代码。

### 7.5 与 `pack.py` 的关系

`pack.py` 把 `main.js` / `preload.js` / `package.json` / `assets/` 拷进
`dist/GameIntel/resources/app/`，情报站拷进 `resources/app/intel/`，上游拷进 `resources/app/upstream/`，
最后把图标烧进 `GameIntel.exe` 的 PE 资源段。

> **exe md5 在 v14 → v15 之间没有变**（都是 `874c11c72ab4169f38cc932f2bd31d4f`）——
> 这是**正常**的：壳源码在 `resources/app/`，**不在 exe 里**；只要图标与 Electron 本体不变，exe 字节就一样。
> 判断「包是不是新的」要看 `resources/app/intel/index.html` 的 md5。

---

## 八、★v18：工作台 = App 的「管理页」（独立窗口 · 双向关联）

> 用户 2026-10-16 晚口径：「**后续我想将工作台变成该 APP 的管理页面，如果需要关联需要做什么**」。
> 拍板：形态 = **独立窗口**（App 与管理页并存）；关联 = **双向（含回写）**；上游 = **授权**改 3 处语义。

### 8.1 新增的两个文件（都**不跑 Electron**）

| 文件 | 干什么 | 怎么跑 |
|---|---|---|
| `_t_shell.js` | **源码级契约断言 31 条**：`shell:admin` / `shell:openDlRoot` / `shell:focusApp` 的**入参边界**、管理窗三道纪律、上游归属判定、`preload` 暴露面、上游那两处授权改动 | `node _t_shell.js` |
| `_counterproof_shell.py` | **壳层独立反证 24 点**：把上面每条契约**实际打坏**，确认断言真会变红，再自动还原。**不写被测文件**（临时目录 + `GAMEHUB_MAIN` / `GAMEHUB_PRELOAD` / `GAMEHUB_SERVER` 指过去），结尾打印三个 md5 佐证 | `D:/Python311/python.exe _counterproof_shell.py`（全量约 **3 秒**） |

> **为什么必须单独立一套**：`require('electron')` 在纯 Node 里**直接抛** ⇒ jsdom 测不到壳；
> 而壳恰恰是**安全边界**所在的那一层（管理页能干什么、上游绑不绑回环）。
> 行为验证交给 `--smoke` 实跑与**成品窗口实拍**（`PACK` §十七.7 / §十七.10）。

### 8.2 IPC 清单（v18 新增 **3** 个，共 **14** 个 `ipcMain.handle`）

> 实测清点：`fetch / open / **admin** / **focusApp** / **openDlRoot** / scanGames / dl-start / dl-cancel / copy / netdisk / openPath / revealPath / describe / titlebar`（**14** 个）。
> `shell:describe` 是 v15 就有的，v18 只是把自述内容升到 `version:'v18'` 并加了实例归属字段。

| IPC | 入参 | 干什么 | 边界 |
|---|---|---|---|
| `shell:admin` | `act`（只认 `open`/`toggle`/`focus`/`close`）+ 可选 `startPath` | 开/切/关独立管理窗 | 未知动作**拒绝并回执** `{ok:false,error:'action not allowed'}`；`startPath` 在**主进程侧**过正则 `/^\/[A-Za-z0-9._\-/?=&%]*$/` 且**禁 `..`** |
| `shell:focusApp` | **无** | 把主窗调回前台 | 主窗不存在 ⇒ `{ok:false,error:'主窗不存在'}` |
| `shell:openDlRoot` | **无** | 打开本 APP 的下载目录 | 目录由主进程 `dlDir()` 自己算 —— **页面上拿不到「打开任意路径」的能力** |
| `shell:describe` | **无** | 本壳自述（`version:'v18'` + `upOwner`/`upPid`/`upShellFlag`/`listenPort`/`adminOpen`） | 不含任何敏感路径 |

`preload.js` 新增暴露面：`window.__SHELL_ADMIN__(act)` + `__SHELL__.adminPage(act)` / `focusApp()` / `openDlRoot()`。

### 8.3 管理窗的三道纪律（★ 一条都不许破）

1. **单例** —— 已开则 `focus()`，不再开第二个；
2. `closed` **只置 `null`** —— **绝不 `app.quit()`**（关管理页不能把整个 App 带走）；
3. `closed` **不碰上游子进程** —— 上游归**主窗**生命周期管。

**★ 另附一条机制**：`setWindowOpenHandler` 是**每 `webContents` 一套**，**不会从主窗继承**
⇒ 管理窗必须**自己再挂一次**（否则工作台里的外链会直接在 Electron 里开）。

### 8.4 管理页里那排「本机动作条」是**注入**的

`did-finish-load` 时 `executeJavaScript(ADMIN_BAR_JS, true)`（同 `BACK_BTN_JS` 的既有套路）——
上游 `public/` 里的 HTML **一个字节不动**。注入的内容：`📁 下载目录` / `🕹 扫描本机游戏` / `↩ 回到 App` / `⟳ 刷新`，
左侧「本机」胶囊**直接显示上游实例归属**（`本机 · 上游由 App 托管` / `…是外部实例` / `…归属未知（旧版）`）。

> 动作条**刻意只挂「无页面上下文」的动作** —— **不去猜工作台的 DOM**（上游页面会演进，猜必坏）。

### 8.5 截图模式新增 `SHOT_ADMIN=1`

`--shot=` 原来只拍主窗。`SHOT_ADMIN=1` 会在拍完主窗后**顺带把管理窗也开出来拍一张**（`<名>-admin.png`），
日志里多打一行「管理窗 url=… · 动作条按钮=4」**供验收**。
两个窗口**没法被同一次 `capturePage()` 拍到**（各拍各的 `webContents`）⇒ 交给 `E:/gishots/_compose_shots.py`
横向拼成一张同屏对照图。

## 九、★v19：下载引擎（aria2）**已接入**（2026-10-22）

> 两步走：先「契约预留」（接口定死、引擎未装）→ 再「实装」（真起 aria2c + 回环 JSON-RPC）。
> 用户口径依次是「接口调用（管理页面）预留，后续我将接入磁力链下载」→「先建设好，记得关联和预留管理接口」。

### 9.1 三个文件，各管一层

| 文件 | 职责 | 能不能单测 |
|---|---|---|
| **`aria2.js`**（新） | 引擎本体：spawn / 等待 RPC / 轮询转事件 / 磁力预览 / 管理动作 | ✅ **能** —— 它**不 require electron**，`_t_aria2.js` 27 条真跑 |
| `main.js` | 接线：懒启动 + 失败退避 + **gid ↔ 页面 id 映射** + IPC | ❌ 只能源码级契约（`_t_shell.js` §⑤）+ 成品 smoke |
| `preload.js` | 白名单：9 个方法（4 引擎 + 5 管理） | ❌ 同上 |

### 9.2 IPC 清单（v19 下载相关共 **10** 个，全量 `ipcMain.handle` 共 **23** 个）

| IPC | 入参 | 返回 | 说明 |
|---|---|---|---|
| `shell:dl-start` | `{id,url,name?,selectFile?}` | aria2 回 `{ok,id(gid),engine:'aria2'}`；回落时等同旧行为 | **唯一入口**：有引擎走 aria2，失败/缺失**自动回落**内置单连下载器 |
| `shell:dl-cancel` | `id` | `{ok,engine}` | 先查 gid，查不到才走旧的 `cancelDownload` |
| `shell:dl-engine` | `force?`（布尔） | `{ok,engine:{available,running,version,dir,reason}}` | **懒启动**一次；失败带原因回去 + 30s 退避 |
| `shell:dl-magnet-preview` | `magnet` | `{ok,files:[{idx,path,length,selected}],totalBytes,name}` | 只取元数据出清单，**不下正文** |
| `shell:dl-pause` / `dl-resume` | `id` | `{ok}` / `code:'not-supported'` | 只对引擎任务有效；内置下载器如实拒绝 |
| `shell:dl-list` | — | `{ok,engine,tasks[]}` | **管理接口**：引擎真值（重开 App 靠它捞回任务） |
| `shell:dl-remove` | `id` | `{ok}` | **只删记录，不删已落盘文件** |
| `shell:dl-clear` | — | `{ok,removed}` | 清「已结束」 |
| `shell:dl-stats` | — | `{ok,global:{speed,active,waiting,stopped},features,uptime}` | **管理接口**：全局速度/活动数/编译特性 |
| `shell:dl-options` | 无=读；有=写 | `{ok,options,editable}` / `{ok,applied}` | **管理接口**：写 `dir` 会被 `code:'dir-locked'` 拒绝 |

### 9.3 ★ 关联怎么做的（这是本轮最容易搞错的地方）

页面**早就**用自己的 id 登记任务、并靠这个 id 匹配进度事件；aria2 给的是 **gid**。
⇒ `main.js` 里维护 `gidAlias: Map<gid, pageId>`：

```
add 成功 → gidAlias.set(gid, 页面传来的 id)
进度回推 → Object.assign({}, t, { id: pageIdOf(t.id), engine: 'aria2' })
暂停/取消 → 用页面 id 反查 gid
```

**不映射的后果**：页面收不到自己的进度（表现成「任务卡在 0%」）。
**成品 smoke 的硬证据**：
```
真下载结果 : {"r":{"ok":true,"engine":"aria2"},
              "last":{"id":"smoke2-…","state":"done","got":144,"total":144,"engine":"aria2"}}
```
事件里的 id 是**页面自己传的那个** ⇒ 映射通了。

### 9.4 安全边界（写死在代码里，不是配置项）

1. **RPC 只绑回环**：`--rpc-listen-all=false` + `--rpc-allow-origin-all=false` + 只 `127.0.0.1`。
   （aria2 的 `dir` 能指任何路径 ⇒ RPC 被局域网够到 = 「往任意目录写文件」公开。）
2. **`--rpc-secret` 每次启动随机**（`crypto.randomBytes(16)`），且**永不离开主进程** ——
   `info()` 只回 `{available,running,version,dir,reason}`，不含 port/secret（断言守着）。
3. **`dir` 由主进程算**（`dlDir()`）；页面传 `dir` 会被 `dir-locked` 拒绝。
4. **`ARIA2_BIN` 只看包内 `vendor/aria2/`，不从 PATH 找**（否则会碰巧用上系统里另一个 aria2）。
5. `spawn` 一律 `windowsHide: true`、**不走 shell**（无命令注入面）。

### 9.5 两个实测坑（都写进了代码注释 + 断言）

**① `--input-file` 指向不存在的文件 ⇒ aria2 直接异常退出**
`Exception: [download_helper.cc:562] errorCode=1 Failed to open the file …, cause: File not found`
⇒ 首次启动前**必须先建空 session 文件**。而且**别加 `--quiet`**（它会把这条吞掉，表现成「RPC 一直起不来」）。

**② RPC 的 `addUri` 不认 `bt-metadata-only`**
那是**全局**选项，不是 per-download 选项 ⇒ 传进去被忽略 ⇒ aria2 把**整个正文**开下
（实测是 756 MB 的 ISO），`followedBy` 永远不出现、预览超时，还在后台白下几百兆。
⇒ 磁力预览改成**独立短命进程**（命令行全局参数 `--bt-metadata-only=true`）+ 自己解 `.torrent`（内置 bencode 解码），实测 **6 秒**出清单。

### 9.6 GPLv2 合规（不能省）

```
electron/vendor/aria2/aria2c.exe        aria2 1.37.0 · 5,649,408 B
                                        sha256 = be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2
electron/vendor/aria2/COPYING           GPLv2 全文（18,092 B，官方包自带）
electron/vendor/aria2/SOURCE-OFFER.txt  版本 / 官方发布页 / sha256 / 源码获取方式 / 为何属「聚合」
electron/vendor/aria2/AUTHORS, LICENSE.OpenSSL
```

`pack.py` 的 **②.5** 会 `vendor/` **有就拷、没有就跳过**（换版本只换文件，不改脚本）。

### 9.7 断言

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `electron/_t_aria2.js` | **27** | 真起引擎 / 真下载 / 进度事件（含 running）/ session 预建 / info 不泄露 / preview 出清单 / 预览后无残留 / 选项读写的范围与 `dir` 拒绝 |
| `electron/_t_shell.js` | **60**（v18 是 31） | §⑤ 新增：一个入口两后端 / gid 映射 / 进度形状 / 5 个管理接口 / 回环绑定 / secret 随机 / `dir-locked` / 两个坑位 / 打包清单 |
| `demo/_t_demo.js` | **720**（v18 是 694） | §22：无壳不渲染磁力入口 / 勾选清单 / `select-file` / 暂停按钮只在引擎任务上 / 过期文案不得残留 |

> ⚠️ **`_counterproof_shell.py`（24 点）尚未覆盖本轮新增的 IPC 与 `aria2.js`** —— 断言已覆盖，反证待补（`NEXT` N-27）。
