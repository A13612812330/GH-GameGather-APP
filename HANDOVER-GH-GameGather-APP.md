# GH-GameGather APP · 移交说明

> 建立：**2026-10-26**　｜　移交时版本：**v28**　｜　代码状态：三套断言全绿（803 + 73 + 27）
>
> 写给**接手的人**。读完 §1 与 §2 就能跑起来，§7 是一定会踩的坑。
> 更细的实现决策在 `PACK-GameHub-exe.md`（逐版记录）、`NEXT-游戏情报客户端.md`（待办与现状锚点）。

---

## 0. 一句话

**PC / 手游情报站 + 资源检索 + 桌面下载管理**，最终产物是一个双击即用的 Windows 桌面应用。

只做**信息聚合与索引**，不托管、不分发任何游戏文件；所有条目指向原始出处，下载能力只覆盖**磁力/BT 与真实直链**。

### 0.1 只有仓库链接能做到哪一步（读这一格就够）

**仓库是纯源码，不含运行时、不含数据服务、不含成品。** 所以「把链接丢给 AI 让它跑」只到第 2 行：

| 想达到 | 只给链接够不够 | 还缺什么 |
|---|---|---|
| 读代码 / 改代码 / 让 AI 帮你继续开发 | ✅ **够了** | `git clone` 即可，无构建步骤 |
| 看界面长什么样（离线原型） | ✅ **够了** | 双击 `demo/index.html`，0 依赖，走 `demo/data.js` 快照（2026-10-15 打包时点） |
| 跑原生桌面窗口 | ⚠️ 差一步 | `cd electron && npm i`（拉 Electron 39.8.10，约 200 MB）+ **上游**（见下） |
| 有实时数据（搜索 / 详情 / 评分 / 榜单刷新） | ⚠️ 差一步 | 上游已单独发布 → [GH-GameGather-UPSTREAM](https://github.com/A13612812330/GH-GameGather-UPSTREAM) |
| 自己打 exe | ⚠️ 差一步 | 上面两样 + Python 3.11+（跑 `electron/pack.py`） |
| 直接双击就用 | ✅ **够了（另一条路）** | 下 [Release v28 成品包](https://github.com/A13612812330/GH-GameGather-APP/releases/tag/v28)，262 MB，解压双击 |

> **结论一句话**：**代码 + 数据 + 成品三样都在 GitHub 上了，只是分在三个地方。**
> 本仓库只有代码；上游在 `GH-GameGather-UPSTREAM`；成品在 Releases。
> 只想「跑起来看看」的人走 Release，只想「改代码」的人 clone 本仓。

### 0.2 三条复刻路线（照抄即可）

**路线 A · 只想用**：下 Release 的 zip → 完整解压 → 双击 `GameIntel/GameIntel.exe`。

**路线 B · 要跑开发壳**：

```bash
git clone https://github.com/A13612812330/GH-GameGather-APP.git
git clone https://github.com/A13612812330/GH-GameGather-UPSTREAM.git upstream
cd GH-GameGather-APP/electron && npm install
export GAMEHUB_ROOT="$(cd ../../upstream && pwd)"
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

**路线 C · 要出 exe**：在路线 B 基础上 `python electron/pack.py`，产出 `dist/GameIntel/`（约 2~4 分钟）。

---

## 1. 拿到了什么、没拿到什么

### 1.1 在仓库里（clone 就有）

| 内容 | 路径 | 说明 |
|---|---|---|
| 前端全部代码 | `demo/index.html` | 单文件，**6,448 行 / 384,985 B**，无构建、无 npm 依赖 |
| 离线数据快照 | `demo/data.js` | 497,152 B，双击 `index.html` 时只用它 |
| 页面行为断言 | `demo/_t_demo.js` | **803 条**，jsdom |
| Electron 壳 | `electron/main.js` `preload.js` `aria2.js` | 窗口 / 托盘 / IPC / 上游子进程 / 下载引擎封装 |
| 壳与引擎断言 | `electron/_t_shell.js` `_t_aria2.js` | **73 条** + **27 条** |
| 打包脚本 | `electron/pack.py` | 纯标准库，产出 `dist/GameIntel` |
| **aria2 引擎** | `electron/vendor/aria2/` | `aria2c.exe` 5.4 MB + GPLv2 三件（`COPYING` / `LICENSE.OpenSSL` / `SOURCE-OFFER.txt`） |
| 图标素材 | `electron-intel/assets/` | `icon.ico` 等，`pack.py` 会用它烧图标 |
| 方案与决策 | `SOP` / `PLAN` / `NEXT` / `PACK` 四份 md | 规范与红线、方案与模块、待办与现状锚点、exe 打包逐版实录 |

### 1.2 **不在**仓库里（必须单独拿）

| 内容 | 为什么不入库 | 没有它会怎样 |
|---|---|---|
| **上游聚合服务** `game-aggregator` | 独立项目、独立维护，本仓库只读依赖 | **跑不起实时库**：只能看 `demo/data.js` 的离线快照。**已单独发布**：[GH-GameGather-UPSTREAM](https://github.com/A13612812330/GH-GameGather-UPSTREAM)（123 文件 / 109.6 MB，`npm i` 后 `PORT=8199 node server.js` 即可） |
| **Electron 发行版** `electron/node_modules/` | 体积大，可重装 | 打不了包、开不了原生窗口（看原型不受影响） |
| **成品** `dist/GameIntel/` | **10,100 个文件 / 591.3 MB** | 直接下 [Release v28](https://github.com/A13612812330/GH-GameGather-APP/releases/tag/v28)（262 MB zip），或自己跑一次打包（约 2~4 分钟） |
| 实拍截图 `exe-preview/shots/` | 77 张 / 35 MB，可重拍 | 只有 `exe-preview/index.html` 里会有空图位 |
| `_ref/` `_probe/` `_audit/` `_archive/` | 本地过程材料 | 不影响运行 |

> **三样东西分三处**：代码 → 本仓库；数据服务 → `GH-GameGather-UPSTREAM`；成品 → Releases。

---

## 2. 从零跑起来

### 2.1 环境

| 依赖 | 版本 | 用途 |
|---|---|---|
| Windows | 10 / 11 x64 | 唯一支持目标 |
| Node.js | **22.x** | 跑断言；jsdom 需装在能 `NODE_PATH` 指到的地方 |
| Python | **3.11+**（纯标准库） | 只用于 `electron/pack.py` |
| Electron | **39.8.10** | `cd electron && npm i` 自动装 |

### 2.2 第一条路：只看原型（0 依赖，1 分钟）

双击 `demo/index.html`。它只读 `data.js` 的离线快照，**不连任何服务**，不需要装任何东西。

### 2.3 第二条路：跑开发壳（需要上游）

```bash
cd electron
npm install                                   # 装 electron 39.8.10

# 上游在哪：默认找 <项目根上一级>/2026-09-03-16-11-58/game-aggregator
# 路径不一样就显式指定（Git Bash / PowerShell 用 export / $env:，cmd 用 set）
export GAMEHUB_ROOT="D:/path/to/game-aggregator"

# ★ 必须先清掉这个环境变量，否则主进程会退化成纯 Node，require('electron') 拿到的是路径字符串
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

> 上游目录只需含 `server.js` / `shared.js` / `package.json` / `data` / `fetchers` / `public` / `node_modules` 这 7 项
> —— 即 `pack.py` 会拷进包里的那些。开发期的 `_ref` / `_bak` / `_probe` 之类一律不需要。

冒烟（不开窗，只验 fork / 探活 / 清理）：

```bash
env -u ELECTRON_RUN_AS_NODE GAMEHUB_PORT=8199 ./node_modules/electron/dist/electron.exe . --smoke
```

### 2.4 第三条路：打成品 exe

```bash
python electron/pack.py
```

前置三件事，缺一直接 `sys.exit` 报错：

1. `electron/node_modules/electron/dist/` 存在（即 `npm i` 过了）
2. 上游目录存在且有 `server.js`
3. `electron-intel/assets/icon.ico` 存在（**仓库里已有**）

产物 `dist/GameIntel/`：**顶层 22 个条目 / 10,100 个文件 / 591.3 MB**。

> ⚠️ **不是绿色单文件**。只拷 `GameIntel.exe` 会报 `Invalid file descriptor to ICU data received.`；
> 补上 `icudtl.dat` 又换报 `Error loading V8 startup snapshot file`。
> **必须整个 `dist/GameIntel/` 目录一起搬**。要单文件分发只能另做安装包。
>
> ⚠️ `pack.py` **不清空**输出目录，是原地覆盖 + 清 2 个已知残留。要彻底重来请手动删 `dist/GameIntel` 再跑。

---

## 3. 结构定式（改之前必须知道）

```
GameIntel.exe
└─ resources/app/
   ├─ intel/index.html      ← 情报站（从 demo/ 拷来，file:// 直开）
   ├─ upstream/             ← 上游只读拷贝，起 127.0.0.1:<随机端口> 提供实时接口
   ├─ main.js preload.js aria2.js
   └─ vendor/aria2/aria2c.exe
```

四条定式，都是踩过坑才定的：

1. **情报站从包内 `file://` 直开**，用**绝对地址**调本机接口 —— 上游自带 `ACAO:*`，不需要反代。
2. **端口不能写死 8123**：壳的上游遇 `EADDRINUSE` 会自动 +1。页面取 `SHELL.describe().listenPort` 优先，取不到才退回 8123。写死就会读到**别人的实例**。
3. **上游 `server.js` 必须进包** —— 它是实时接口的唯一来源。但**不把 demo 拷进上游 `public/`**。
4. **壳源码在 `resources/app/`、不在 exe 里** ⇒ 改壳之后 **exe 的 md5 不变**，判新旧要看包内 `intel/index.html`。

---

## 4. 改动后必须做的验证

### 4.1 三套断言，全绿才算完成

```bash
# ① 页面行为（803 条）
cd demo && NODE_PATH=<jsdom 所在 node_modules> node _t_demo.js

# ② 壳契约（73 条）③ 引擎（27 条）
cd electron && node _t_shell.js && node _t_aria2.js
```

**改实现必须同轮改断言并写明理由**。本项目不接受「断言改小了但没解释」。

### 4.2 指纹对照表（2026-10-26 实测）

| 文件 | md5 | 规模 |
|---|---|---|
| `demo/index.html` | `5c952df3154bfc082a64798bc6cbdfe6` | 384,985 B / 6,448 行 |
| `demo/data.js` | `80dbf63b8409a42c406b016eb26610d0` | 497,152 B |
| `demo/_t_demo.js` | `c5f12ceab49fc57303d7c5e5d04400da` | 803 条 |
| `electron/main.js` | `b0fd2c99d6bdd74ac22788cec1925600` | 86,112 B |
| `electron/preload.js` | `d0bbe989d5ed0f92bf75d8bbb3dc1fbe` | — |
| `electron/aria2.js` | `3b783f577b37ea4b6e7cc439f20c6376` | — |
| `electron/_t_shell.js` | `6dbe3cd86aaabc4f0e0ae8ded3104743` | 73 条 |
| `electron/_t_aria2.js` | `ae74047b28e05904c2a8fb9e3a10d3db` | 27 条 |
| `electron/vendor/aria2/aria2c.exe` | sha256 `be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2` | 5.4 MB |

**纪律**：拿到手第一件事是 `md5sum` 比一遍。**一致就说明代码没变，§4.3 那些既有结论继续有效，不用重跑**。

### 4.3 已验证过的结论（指纹一致时不必重跑）

- 三套断言：**803 / 803 · 73 / 73 · 27 / 27** 全绿
- 打包：`exit=0`、跳过 0、包内 `intel/index.html` 与源 **逐字节 `cmp` 一致**
- 成品 smoke：全项通过；实时库 **19,764** 条
- ⚠️ **未验证**：磁力链路的**真种子端到端实跑**（见 N-45）—— 补的是这一条，不是重跑上面那些

---

## 5. 进度盘点

### 5.1 已交付

| 版本 | 内容 |
|---|---|
| v9 | 深色主题 + 按维度分榜 |
| v10–v12 | 分榜排版、图片适配（按「最狠裁切」定比例）、移除报告模块 |
| v15 | 本机三页：游戏库 / 我的游戏 / 下载管理 |
| v16 | 去数量展示、统一分页 50、搜索改弹窗、交互重做 |
| v17 | 详情页对齐工作台、多平台同款合并（列表页内 + 详情层） |
| v18 | 工作台变独立窗口「管理页」，关联双向回写 |
| v19–v24 | aria2 引擎接入 → 下载管理成型（四步网盘链、任务持久化与引擎对账） |
| v25 | 视觉重制（参考 games.gg）：深蓝黑 `#060d17` / 品牌绿 `#23db8c` / 6 级圆角 / 卡片上浮 |
| v26 | 排行榜下沉到首页底部，移除侧栏独立入口（页面保留作深链） |
| v27 | 首页榜单默认只露 Top 5，其余折叠 |
| **v28** | **链接四分类**：真直链→引擎直下 / **磁力→aria2 真下** / 迅雷·电驴链→只复制 / 网盘分享页→**打开网盘自己转存**。顺带修两个真 bug：进度回推把 `url` 覆盖成空、对账只按 url 匹配导致磁力任务重启后被判失败 |

### 5.2 没做完的（按建议优先级）

| 优先级 | 项 | 说明 |
|---|---|---|
| **P0** | **N-45 磁力端到端实跑** | 引擎与链路都齐了，但**没跑过真种子**。用公开合法磁力（开源游戏官方 torrent / archive.org / 发行版 ISO）走完：取元数据→选文件→下小样→暂停续→重启对账。**这是唯一悬着的技术缺口** |
| **P1** | N-44 磁力文件选择入口 | `startMagnet(url, idxs)` 已支持 `select-file`，但资源区点「🧲」时传的是空 idxs（全下）。要选文件得先「解析文件清单」再跳转 |
| **P1** | N-21 / N-32 单文件分发 | 现在必须整目录搬。要做需 NSIS / Inno Setup 安装包 |
| **P2** | N-33 网盘自动转存 | 外挂 OpenList，需用户自己部署；当前是「打开网盘手动转存」 |
| **P2** | N-29 下载进度拉推双通道 · N-30 下载独立浮窗 · N-37 任务导出 · N-38 批量操作 | 体验补齐，见 `NEXT` |
| **P2** | N-5 响应式三档 · N-6 键盘无障碍 | 当前只保证桌面宽度 |
| **P3** | N-7 / N-13 单文件 6,448 行待拆 | 硬约束：`file://` 双击必须能开 ⇒ 不能用打包器，只能手拆 |
| — | N-43 磁力来源 | **口径已定：不自建抓取**。不接 FitGirl / 1337x / RARBG 等盗版重打包站；只走「用户自贴 + 合法公开源」 |
| — | N-8 上游未冻结 | 上游仍在频繁改，包内是当时那版快照，接口形状可能变 |

完整 45 条在 `NEXT-游戏情报客户端.md`。

---

## 6. 关于名字

- **项目名 / 仓库名**：GH-GameGather APP（仓库 `GH-GameGather-APP`）
- **代码里仍叫 `GameIntel`**：目录 `dist/GameIntel`、exe `GameIntel.exe`、包内 `intel/`、`package.json` 的 `gameintel-shell`

**这是刻意的**，不是漏改。改名要同步改 `pack.py` 的 `OUT` / `EXE_NAME`、`main.js` 的窗口标题、`package.json`、以及五份文档里几十处路径，**会让 §4.2 的全部指纹作废**。移交当下不该做这种改动。

真要改，一次改干净的顺序：`pack.py` 的 `OUT`/`EXE_NAME` → `main.js` 标题 → `package.json` → 跑三套断言 → 重打包 → 用 `pack.py` 日志确认**跳过 0** → 重算指纹更新文档。

---

## 7. 红线（踩了会坏东西）

1. **上游 `game-aggregator` 默认只读**。历史上只经一次性授权改过一次（`server.js` 3 处语义 + `/api/health` 5 个只增字段），**该授权不延伸**，再动任何一行须重新取得同意。
2. **发布线上是覆盖动作**。线上入口 `https://game-intel-client.app.workbuddy.host/` 目前**停在 v12**，v13~v28 全在本地。发布前必须当轮明确要求，且判「线上是否最新」要**比 md5**，不能只看 HTTP 200。
3. **单轮删除超过 50 个文件会被本机护栏拦下**。所以构建脚本一律「写入侧过滤 / 原地覆盖」，**绝不批量删除**。这也是 `pack.py` 不清空 `dist` 的原因。
4. **断言不能「改小了不解释」**。断言守得住「实现符合设计」，但守不住「设计本身想错了」—— 交互链路必须实拍验证。
5. **跑完验证又改源码 = 结论当场过期**。改完立刻 `md5sum` 存证。

---

## 8. 常见故障

| 症状 | 原因 | 处理 |
|---|---|---|
| `Invalid file descriptor to ICU data received.` | 只拷了 `GameIntel.exe` | 整目录搬 |
| `Error loading V8 startup snapshot file` | 补了 `icudtl.dat` 但缺其余 | 整目录搬 |
| `require('electron')` 拿到字符串 / 窗口不开 | `ELECTRON_RUN_AS_NODE=1` 在环境里 | `env -u ELECTRON_RUN_AS_NODE` 再跑 |
| 页面读到的数据是别人的 / 接口 404 | 端口写死 8123，撞上别的实例 | 走 `SHELL.describe().listenPort` |
| `找不到上游：…（可用 GAMEHUB_ROOT 指定）` | 上游路径不对 | 设 `GAMEHUB_ROOT` |
| `找不到 electron 发行版` | 没 `npm i` | `cd electron && npm i` |
| 打包「跳过 N 个文件 / Permission denied` | 目标被占用（常见是浏览器扩展在读写 `public/`） | 关掉占用进程重跑；跳过数必须为 0 才算成功 |
| `openSearch(prefill)` 只填字不搜索 | 程序化赋 `value` 不派发 `input` 事件 | 这是已知行为，不是 bug |
| 截图没生成也不报错 | `SHOT_JS` 返回了 `Promise` 或裸表达式 | 必须写成 **IIFE 返回字符串** |

---

## 9. 接手后建议的前三步

1. **比指纹**（§4.2）→ 一致就跳过重跑，直接读 §3 与 §5。
2. **跑 P0：N-45** —— 用一条公开合法磁力把磁力链路真正跑通，这是唯一没验的环节。
3. **决定 N-21** —— 要不要做安装包。如果这份东西要给非技术同事用，安装包比「整目录搬」现实得多。
