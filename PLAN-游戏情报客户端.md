# 游戏情报客户端（exe + APK 同步更新）· 方案（现行唯一版）

> 制定时间：2026-10-08　｜　**本文只做方案设计，未创建任何项目代码、未改动任何既有项目**
> 线上入口：**https://game-intel-client.app.workbuddy.host/**（demo 原型；**线上当前仍是 v9，v10 本地已就绪、待确认后同步**）
> 配套：`SOP-游戏情报客户端.md`（规范与红线）、**`NEXT-游戏情报客户端.md`（优化清单与三条线的路线，2026-10-09 新增）**
> 关联项目：① PC游戏工作台（game-aggregator / GameHub）② NewsV3（GameNews）③ 端游可视报告（PC 端游三源周报）
> 技能基线：**komo-expert 1.2.0**（`komo-skill` 收窄为路由层 + 新增 `small-project-guide` 流程层）｜预检 **52 项 → OK 51 / INLINE 1 / UNKNOWN 0**（2026-10-08 实测，非记忆）
>
> **demo 迭代轨迹**（原型线，实物在 `demo/`）：v4 卡片骨架 → v5 手游卡 + 数据白名单 → v6 弹窗/定高 →
> v7 图片 cover 满幅 → v8 标题括号 / 排行榜分榜 / 首页轮播 → v9 双主题 + 版式对齐 TapTap →
> **v10 首页去孤行 + 排行榜收敛 4 榜 + MOD 来源修复**（验证：jsdom **358/358**、反证 **25/25**）。

---

## 版本语义（先讲清，避免误读）

之前出现过的「v1 → v2」是**方案文档的修订号**（因为中途加了一个模块，所以改了文档），**不是产品版本**。为避免再混淆，改为单文件、不带版本后缀：

| 概念 | 当前值 | 说明 |
|---|---|---|
| **方案文档** | 本文（现行唯一版，单文件） | 历史修订移入 `_archive/`：`PLAN-游戏情报客户端-方案-r1.md`（初版，3 模块契约） |
| **客户端产品版本** | **v0.1.0 · 未启动** | 项目尚未开工、零代码、零构建产物 ⇒ **不存在"v2 产品"**。首个可运行版本才会是 0.1.0 |
| **被集成的三个项目版本** | game-aggregator v10.42 / GameNews（在跑）/ 端游周报第 5 期 | 与客户端版本互不相干，各自独立演进；客户端只读它们，不反向影响 |

---

## 〇、结论先行

| 问题 | 结论 |
|---|---|
| 能不能做 | ✅ 能。**exe 可以真离线**，APK 只能是**联网薄壳**（Android 上没有 Node 运行时） |
| 最大工作量在哪 | **不在打包，在「统一数据契约」** —— 三个既有项目三套数据形状，客户端必须先有归一化出口，否则必然出现第二实现（违反项目铁律 C3） |
| 新增的第三块数据是什么 | **端游可视报告**：PC 端游三源周报（神策搜索 + 鲸云下载 + SteamDB），已出 5 期，线上三处 md5 一致 |
| 第三块数据独有的坑 | ⚠️ 现在**只有 639 KB 的 HTML 看板，没有机器可读数据层**。客户端要渲染就必须先补 `board-data.json`，且必须与 HTML 看板同源产出，否则必漂移 |
| 端游报告走哪条通道 | ✅ **走 GitHub Pages 直连**（`Access-Control-Allow-Origin: *` 已实测）—— 数据 JSON 随看板一起推 GH，客户端跨域直取。该模块**不经本地服务端**，是 6 个模块里唯一能**纯静态跑通**的，可当先行验证 |
| 「同步 APK 更新」的可行边界 | ⚠️ **APK 无法静默自动安装**（Android 系统限制）。能做到的：两端**同源同版本号 + 同一份更新清单**；exe 可静默升级，APK 只能「检查 → 下载 → 唤起系统安装器由用户点确认」 |
| 安全上最易被忽略的 | ⚠️ **「自动更新」= 给客户端开了个远程代码执行入口**。原方案零安全约束，本轮补 R12–R15（包签名校验 / Electron 加固 / 子进程契约 / 缓存迁盘） |
| 建议起点 | **P0 = 统一契约层（含安全约定章节）+ 用「现有游戏库」先跑通 3 个 PC 模块**（不改任何既有路由）。★demo 实测更正：原写"Steam 三模块"是错的，A 端无 Steam 商店源（见 R16） |

---

## 一、需求规范化（口语 → 可判定六字段）

| 字段 | 内容 |
|---|---|
| **目标** | 交付 Windows exe + Android APK 的「游戏情报客户端」，分模块展示 **6 类情报**：Steam 新游 / Steam 热游 / Steam 排行榜 / 手游新游 / 手游活动 / **端游可视报告**；两端版本同源、可同步更新 |
| **输入** | ① game-aggregator（v10.42，19,239 款游戏）② GameNews（手游爬虫 + 飞书三维表）③ **端游三源周报（`_gh_publish/` 5 期归档 + 线上三处 md5 一致的看板）** |
| **边界** | 只在既有项目里**新增只读出口**，不改既有路由语义与前端；不引入第二套计算逻辑；不碰下载/破解类内容（沿用 `onlineSearch.js` 合规红线）；**不改动已固化的看板样式基线** |
| **产出物** | ① `game-intel.v1` 契约文档 ② 各端只读出口 ③ Electron exe ④ Capacitor APK ⑤ 更新清单 `manifest.json` ⑥ 项目档案卡 + 日志 |
| **验收** | 每模块可实测：接口 `curl` 返回 schema 合法且条数 > 0；exe 双击可开、断网可用、关窗无残留进程；APK 装机可见 6 模块、无网给明确提示；版本号两端一致、更新清单 md5 与线上一致 |
| **失败/风险** | 端口撞车（8123 已改为响亮失败）／`process.execPath` 在 Electron 下失效（唯一预判坑）／Android 静默更新不可能／飞书凭据来自 Windows 用户级环境变量／**看板无数据层** |

---

## 二、当前已实测的现状（事实，非记忆）

### 2.1 三个数据源项目

| 项目 | 实测值 | 证据 |
|---|---|---|
| **game-aggregator** | **v10.42**；`catalog.json` 契约**尚未实现**；**8123 无监听（未运行）** | `docs/versions/` 尾部 v10.38~v10.42；项目根无 `catalog.json`；netstat |
| **GameNews** | **在跑**：64423 / 64424 / 64425 LISTENING（PID 14184 / 17068 / 5444）；33 条对外路由；**缺手游新游/活动统一出口** | netstat + grep |
| **端游可视报告** | 已出 **5 期**（`_gh_publish/` 下 2026-08-25 / 08-26 / 08-31 / 09-14 / 09-28 + `latest/` + `README.md` + `index.html`） | 目录实测 |

### 2.2 端游可视报告 —— 专项实测

| 项 | 实测值 | 证据 |
|---|---|---|
| 最新一期看板 | `端游三源周报看板_9.14-9.27.html`，**639,165 B** | 文件实测 |
| GitHub Pages `latest/` | **HTTP 200**，md5 `598b244bc0704ec3dc8d7f3f08bb561e`，639,165 B | curl + md5sum |
| 线上 `.app.workbuddy.host` | **HTTP 200**，md5 `598b244b…`，639,165 B | curl + md5sum |
| 线上 `.app.workbuddy.link` | **HTTP 200**，md5 `598b244b…`，639,165 B | curl + md5sum |
| ⇒ **三处线上 + 本地** | **md5 与字节数完全一致**，均为**跨期口径修正版**（不是旧的 W1/W2 版） | 四方 md5 全等 |
| 交付物 | `端游三源周报_大报告_2026-09-28.xlsx`（55,490 B）、看板 HTML（639,165 B） | 文件实测 |
| 数据目录 | `E:\新建文件夹\端游周报数据\` 下 `8.31-9.13`、`9.14-9.27` | 目录实测 |
| 已有技能脚本 | `endgame-three-source-analysis/scripts/` 00→07（探查 / 清洗 / 抽历史元数据 / Steam 筛选 / 出五表 / 出看板 / jsdom 回归 / 发布 GitHub） | 上一轮已固化 |

**端游报告的 4 条硬约定（必须继承，不许改）**

1. **样式基线强制**：浅色优雅风（`#f4f6fb` 底 / `#1e4ed8` 蓝，右上角可切深色）。深色霓虹风已归档到 `scripts/_deprecated/05_gen_board_newstyle.py` 并标注勿用。
2. **跨期口径**：本期两周合计 **vs** 上期两周合计（**不是**期内 W1 vs W2）。
3. **鲸云注册数据源已停用**（硬约束，禁止加回流程）。
4. 三源 = 神策搜索 + 鲸云下载 + SteamDB；发布走 `07_publish_github.py`，线上核验必须比 md5（只看 HTTP 200 不算通过）。

---

## 三、目标架构

```
     ┌──────────────────────── 三个数据源（既有，只加不改）────────────────────────┐
     │ game-aggregator v10.42 (8123)   GameNews (64424)      端游三源周报（5 期归档）│
     │ ├ games / trainers / saves      ├ 7 平台爬虫           ├ 看板 HTML 639 KB     │
     │ └ 74 条路由                     ├ 飞书三维表           └ ★ 缺数据层          │
     │                                 └ 33 条路由                                  │
     └──────────────┬───────────────────────────┬───────────────────────┬─────────┘
                    │  【P0/P1/P2 新增】只读聚合出口，既有路由一行不动        │
                    ▼                           ▼                       ▼
     ┌────────────────────────────────────────────────────────────────┐  ┌─────────────────────┐
     │  统一契约层 game-intel.v1（BFF，只读 GET）                       │  │ 【M6 旁路·新增】     │
     │  steam/new · steam/hot · steam/rank · mobile/new · mobile/events│  │ 05_gen_board.py     │
     │  search                                                         │  │  同源产出            │
     └──────────────┬────────────────────────────────────────────┬────┘  │  board-data.json    │
                    │                                            │       │  ↓ 推 GitHub Pages  │
                    │                                            │       │  CORS:* 实测可用    │
                    │                                            │       └──────────┬──────────┘
                    ▼                                            ▼                  │
       ┌────────────────────────┐                  ┌────────────────────────┐      │
       │  exe · Electron 壳      │                  │  APK · Capacitor 薄壳   │      │
       │  内嵌服务 · 离线可用     │                  │  必须联网               │      │
       │  可静默自动更新          │◄─── M6 报告页：直连 GitHub Pages ─────┤◄─────┘
       └────────────────────────┘                  └────────────────────────┘
                    └──────── 同一份 manifest.json + 同一版本号 ────────┘
```

> **M6 走旁路**：端游报告不经过本地契约层，客户端**直接 GET GitHub Pages 上的 `board-data.json`**（实测 `Access-Control-Allow-Origin: *`）。好处：该模块不依赖任何本地服务，8123 / 64424 挂了也照常看报告。

**三条设计铁律（沿用既有约定，不新造）**

1. **禁止第二实现**：6 类情报的计算全部留在服务端，客户端只渲染。
2. **只加不改**：三个既有项目的既有路由**一行不动**，只新增 `/api/cli/intel/*` 只读出口。
3. **凭据不进客户端**：飞书 tenant_access_token 等只在服务端（现存于 Windows 用户级环境变量），客户端永不持有。

---

## 四、模块拆分 · 每个模块 = 一个 Skill 组合 + 一段可复制 Prompt

> **M0~M6 是数据侧**（M0 契约层 + 6 类情报），**M7~M10 是客户端与工程侧**。

### 模块总览

| 客户端位置 | 模块 | 数据来源 | 主要 Skill |
|---|---|---|---|
| **Tab 1** | **M1 · PC 新游**（原「Steam 新游」，见 R16 更正） | `games.json`（xdgamer + 52jidi，19,239 条） | `web-internal-api-reverse` + `firecrawl` |
| **Tab 2** | **M2 · PC 热游** | 同上，`hot` 字段（多源合成见 M2 正文） | `endgame-three-source-analysis` + `multi-source-date-field` |
| **Tab 3** | **M3 · PC 排行榜** | 同上，评分 | `firecrawl` + `katana-crawl` + `fetch-failure-cache-poisoning` |
| **Tab 4** | **M11 · PC 修改器** ★新 | `trainers.json`（3,660 条 / 5 来源） | `firecrawl` + `cross-source-name-matching` |
| **Tab 5** | **M12 · PC MOD** ★新 | `mods.json`（8,943 条；**单一来源 = 机地** `jidiyouxi.com/modify/list`，采集入口 `tools/fetch-mods.js` + `fetchers/jidiModify.js`，见 SOP §1.3.8） | `firecrawl` + `multi-source-date-field` |
| **Tab 6** | **M4 · 手游新游** | GameNews `/api/articles` | `firecrawl` + `cross-source-name-matching` |
| **Tab 7** | **M5 · 手游活动** | GameNews（全量 301 条中活动类 11 条 + 版本更新 100 条；源码无独立出口，见 R17） | `firecrawl` + `multi-source-date-field` |
| **Tab 8** | **M13 · 手游可玩端游** ★新 | `mobilehub.json`（3,264 条 / 16,148 套配置） | `device-model-to-chip-translation` + `cross-source-name-matching` |
| **Tab 9** | **M6 · 端游可视报告**（数据接口托管 GitHub Pages） | 端游三源周报（5 期归档） | `endgame-three-source-analysis` + `generated-artifact-iteration` + `single-source-dual-page` |
| —（底座） | **M0 · 统一契约层 BFF** | 三源 | `product-design` + `sqlite-mcp-server` + `counterproof-assertions` |
| —（壳） | **M7 exe 壳** / **M8 APK 壳** / **M9 同步与更新** / **M10 契约防线** | — | 见各自正文 |

> **九个模块全部已在 demo 中点亮**（`demo/index.html`），是本轮从方案到实物的验证。

---

### M0 · 统一契约层（**最高优先级，先做这个**）

- **目标**：定义 `game-intel.v1` 条目 schema，并在各端加只读出口，让客户端只认一套形状
- **输入**：`game-aggregator/data/*.json`；GameNews `data/` 与飞书三维表；端游周报 `_gh_publish/`
- **边界**：只新增路由，**不动**现有 74 / 33 条路由；不改各端前端
- **产出**：`docs/契约-game-intel.v1.md` + 各端 `/api/cli/intel/*` 出口
- **验收**：`curl` 全部出口 200、schema 校验通过、条数 > 0；故意打坏一个字段，校验脚本必须变红（反证）
- **Skill**：`product-design`、`sqlite-mcp-server`、`counterproof-assertions`、**`prod-db-copy-preview-verify`**（要读生产 SQLite 取数 ⇒ 先拷副本再预览，绝不直接动生产库）、**`project-analysis`**（前置：先摸清三个既有项目架构再定契约，避免契约与实现打架）

**Prompt（可直接复制）**
```
角色：资深后端契约设计。目标：为三个既有 Node 项目设计统一数据契约 game-intel.v1，并各加只读出口。

输入（实测路径）：
- A 端 game-aggregator：E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator（v10.42，server.js 单文件 1,696 行，74 条路由，express 4）
- B 端 GameNews：E:\新建文件夹\Codex-GPT\GameNews（server/ 下 33 条路由，飞书三维表为手游数据源）
- C 端 端游三源周报：E:\新建文件夹\WorkBuddy\_gh_publish\（5 期归档 + latest + README 索引）

边界（硬约束，逐条遵守）：
1. 不修改任何既有路由 handler 的语义，只在文件末尾追加新的只读 GET 路由。
2. 不在客户端或前端做任何计算——计算留在服务端（项目铁律：禁止第二实现）。
3. 不把飞书 token/secret 写进代码或响应体；只读环境变量。
4. 先读这几份既有文档再动手，字段命名保持可对齐，不许造第三套命名：
   - game-aggregator\GameHub-打包方案-exe与APK.md
   - 游戏资源服务工具-适配方案-v0.6.0.md
   - endgame-three-source-analysis 技能目录下的 SOP（含 §5.0 样式基线、跨期口径）

产出：
1. docs/契约-game-intel.v1.md：字段表（类型/必填/别名兜底/枚举）
2. A 端：GET /api/cli/intel/steam/new|hot|rank
3. B 端：GET /api/cli/intel/mobile/new|events
4. C 端：GET /api/cli/intel/report/endgame 与 /report/endgame/issues
5. 共用校验脚本 tools/validate-intel-contract.js

验收（必须实测并贴出输出）：
- 全部出口 curl HTTP 200，JSON 可解析，条数 > 0
- 校验脚本对合法响应 PASS、对「抽掉 title 字段」FAIL（反证通过，证明断言非恒真）
- 交叉校验：同一游戏在两端出现的 gameName 归一化后一致

失败处理：某出口无数据时返回空数组 + reason 字段并登记为「待核验」，绝不编造条目。
```

---

### M1 · Steam 新游

- **目标**：近 N 天 Steam 新上架列表，带首图、价格、发行日、商店链接
- **数据来源（★做 demo 时实测更正）**：**A 端本机目前没有 Steam 商店数据源**。实测 `data/` 全量扫描结果：只有 `steam-req.json`（17,370 条**缓存请求记录**，抽样 key=10/70/219 均为 `miss:true`，不含商店字段）与 `tools/build-steam-req.js`；`games.json`（19,239 条）的 `source` 只有 `xdgamer`(15,592) 与 `jidi`(3,647)，**无 steam**。⇒ M1 不是"接现成数据"，而是**新建一条抓取链**，难度与 M4/M5 同级，不是 P0 的最省力项。
- **边界**：只做「读 + 展示 + 跳转」，不代理下载
- **验收**：抽 10 条核对发行日与商店页一致；时区统一 UTC+8
- **Skill**：`web-internal-api-reverse`、`firecrawl`、`multi-source-date-field`

**Prompt**
```
目标：为统一客户端提供「Steam 新游」模块数据。
输入：A 端现有 steam 相关 data 文件；Steam 商店 new releases 页。
边界：
1. 优先纯 HTTP 直调 Steam 商店接口（先做接口还原，不要默认上无头浏览器）。
2. 不做 Steam 登录、不抓私有数据、不代理下载。
3. 单条必含：id / title / titleZh(可空) / cover / releaseDate(ISO, UTC+8) / price / storeUrl / sourceLabel。
产出：GET /api/cli/intel/steam/new?days=30&limit=100，按 releaseDate DESC。
验收：条数 > 0；抽 10 条比对 storeUrl 可达且发行日一致；同日重复调用结果稳定。
失败：接口结构变化时返回上次本地缓存并标 stale=true，不返回空列表假装成功。
```

---

### M2 · Steam 热游

- **目标**：当前热度最高的 Steam 游戏，热度为多源合成
- **数据来源**：沿用既有三源口径（神策搜索 + 鲸云下载 + SteamDB 销量）。⚠️ **鲸云注册源已停用，禁止加回**
- **边界**：热度公式写进文档；缺源时降级并在响应标注
- **验收**：热度可复算（同输入同输出）；每条带 `sources[]`
- **Skill**：`endgame-three-source-analysis`、`multi-source-date-field`、`fetch-failure-cache-poisoning`

**Prompt**
```
目标：Steam 热游模块的数据出口，热度为多源合成。
输入：沿用既有端游三源口径（神策搜索 / 鲸云下载 / SteamDB 销量；鲸云注册源已停用，禁止加入）。
边界：
1. 热度公式外化为文档 + 代码常量，可复算。
2. 每条必带 sources[]，逐源标注贡献与原始值；缺源时按剩余源归一化并标 degradedSources。
3. 跨期口径遵循既有约定：当前两周合计 vs 前两周合计（不是期内 W1 vs W2）。
产出：GET /api/cli/intel/steam/hot?window=14d，含 rank/title/cover/heat/sources[]/trend。
验收：拿历史数据复算 heat，与人工手算误差为 0；degradedSources 非空时前端必须提示。
失败：某源失败不许静默丢弃——降级必须可见（沿用 fetch-failure-cache-poisoning 经验）。
```

---

### M3 · Steam 排行榜

- **目标**：热销榜 / 最多人玩 / 愿望单榜，多榜可切
- **边界**：保留源口径（哪家的榜、什么时间窗），不改写为自定义榜却沿用官方名
- **验收**：榜单条数与源页一致；`capturedAt` 写入响应
- **Skill**：`firecrawl`、`katana-crawl`、`fetch-failure-cache-poisoning`

**Prompt**
```
目标：Steam 排行榜模块（多榜）。
输入：Steam 官方 top sellers / most played / wishlist 源页；SteamDB 辅助。
边界：
1. 保留源口径，不得改写为自定义榜却沿用官方名。
2. 每条含 position / title / cover / sourceName / capturedAt(ISO) / sourceUrl。
3. 不改写排名顺序，允许过滤但不允许重排。
产出：GET /api/cli/intel/steam/rank?board=topsellers|mostplayed|wishlist&region=cn
验收：条数与源页实测一致；capturedAt 与抓取日志吻合；重复抓取去重不丢条目。
失败：源页结构变化时返回 stale=true + 上次快照，绝不返回空数组冒充「今日无榜」。
```

---

### M4 · 手游新游

- **目标**：在运营/预约的手游新品列表
- **数据来源**：GameNews 爬虫（好游快爆 / TapTap / 九游等 7 平台）+ 飞书「新游表」
- **边界**：⚠️ 飞书凭据只在服务端；客户端只读聚合结果；**取数必须翻页拉全量**（`/api/articles` 默认只回 50 条 —— v3 实测漏读 251 条，见 R17）
- **验收**：与飞书新游表逐条对数；跨源同名游戏不误合并；**断言行数 == 接口 total（防"只取第一页"回归）**
- **Skill**：`firecrawl`、`cross-source-name-matching`

**Prompt**
```
目标：手游新游模块数据出口，源为 GameNews 已抓内容 + 飞书「新游表」。
输入：B 端 GameNews（API 64424 在跑）；飞书多维表格「新游表」。
边界：
1. 飞书凭据只在服务端读环境变量，响应体绝不含 token；客户端永不持有凭据。
2. 跨源同名合并必须走既有防误匹配规范：查询侧与库侧都可能出现「A/B」拼接串，需双边切分；CJK 名称最小长度护栏不能一刀切用 >=3（会把「鸣潮」「剑星」这类 2 字名整类误杀）。
3. 保留 sourceLabel 与 platform，不做「独家/首发」这类无法验证的宣称。
产出：GET /api/cli/intel/mobile/new?status=all|预约|测试|上线&limit=100
验收：条数与飞书新游表实测一致；抽 5 条比对源平台页；构造「同名不同游戏」用例确认未误合并。
失败：飞书接口失败时返回最近成功快照 + stale=true + 原因，不静默返回空。
```

---

### M5 · 手游活动

- **目标**：各手游当前/即将开始的活动（时间窗 + 奖励摘要）
- **边界**：`startAt`/`endAt` 双字段 + 时区；不编造奖励
- **验收**：抽 5 条比对源页；过期活动沉底但不删除
- **Skill**：`firecrawl`、`multi-source-date-field`、`generated-artifact-iteration`

**Prompt**
```
目标：手游活动模块数据出口。
输入：GameNews 已抓活动内容 + 飞书「活动表」。
边界：
1. 时间字段必须 startAt/endAt 双字段 + timezone（固定 Asia/Shanghai），不给「X月X日」纯文本。
2. 过期活动不删除，标 expired=true 后沉底（保留历史可查）。
3. 奖励描述必须来自源文本，不做归纳改写导致失真；无法解析时留空并标 needsReview=true。
4. ★取数必须翻页拉全量：`/api/articles` 默认 limit=50（v3 实测 total=301），活动类只看第一页会得「2 条」的错误结论（实际 11 条）——出口内部要循环翻页后再分类，并在响应里带 `scannedTotal` 便于核对。
产出：GET /api/cli/intel/mobile/events?window=ongoing|upcoming|all
验收：抽 5 条比对源页文本一致；按 startAt 排序无跳序；过期判定与当前时间实测吻合。
失败：某平台抓取失败时逐源标注 stale，不影响其他平台展示。
```

---

### M6 · 端游可视报告（数据接口托管在 GitHub Pages）

- **目标**：客户端内按期浏览「PC 端游三源周报」看板（现有 5 期），并直达完整版
- **数据来源**：`E:\新建文件夹\WorkBuddy\_gh_publish\`（5 期归档 + `latest/` + `README.md` 索引）
- **✅ 接口方案（你提出的「上传 GitHub 再映射到该项目」，已实测采纳）**：把该模块的数据层**直接托管在既有 GitHub Pages 归档仓库**，客户端跨域直连，**不经过本地服务端**。
  - 接口形态：`https://a13612812330.github.io/endgame-weekly-report/latest/board-data.json`（永远最新一期）
  - 定基期号：`https://a13612812330.github.io/endgame-weekly-report/2026-09-28/board-data.json`
  - **实测依据（curl -I 实测，非记忆）**：GitHub Pages 对静态文件返回 `Access-Control-Allow-Origin: *`，跨域 GET 不受限 ⇒ **可直接当只读 HTTP 接口用**，不需要新域名、不需要 CORS 代理、不需要服务端进程
  - 为什么这个降级是划算的：周报是**批次产出**（每周一期），不是实时查询 ⇒ 静态托管与动态接口在用户体验上**无差别**，等于白拿一个免费 CDN
  - 映射到哪个仓库：**复用既有 `endgame-weekly-report`**（不新建仓库），JSON 与该期 `index.html` 同级存放
- **⚠️ 本模块独有的前置改造**：现在**只有 HTML 看板（639 KB），没有机器可读数据层**。客户端若解析 HTML 提取数据，等于第二实现，必然与看板漂移。⇒ **必须先补 `board-data.json`，由同一个 `05_gen_board.py` 一并产出（单源派生），并随 HTML 一起推到 GitHub**
- **边界**：
  1. **样式基线不许改**（浅色优雅风 `#f4f6fb` / `#1e4ed8`，深色霓虹风已归档勿用）
  2. **跨期口径**：本期两周合计 vs 上期两周合计
  3. 鲸云注册源禁用
  4. 客户端**只渲染**，不做任何指标计算
  5. **旧链接永不变**：`/<date>/`、`/latest/` 的既有目录式短链一个都不许改。新增 `board-data.json` 是**目录内同级新增文件**，不改动任何既有 URL 形态
- **产出**：
  - `05_gen_board.py` 同源多产 `board-data.json`（HTML 与 JSON 同一次生成，保证零漂移）
  - 发布脚本把 `board-data.json` 复制进各期目录与 `latest/`（沿用既有给各期目录复制 `index.html` 的同一条逻辑）
  - **客户端单一数据入口** = 上述 GitHub URL；**离线兜底** = exe 内置最近一期 `board-data.json` 快照（满足 M7「断网可用」验收）
  - 客户端「端游可视报告」页：期号切换器 + KPI 卡 + 榜单 + 重点表 + 「在浏览器打开完整看板」按钮
- **验收（逐条实测）**：
  - 5 期全部可切换，无空白期
  - **`board-data.json` 与同期 HTML 看板的关键数字逐项一致**（KPI 交叉校验，这是防漂移的核心断言，故意改一个数必须 FAIL）
  - 线上 `board-data.json` 的 md5 与本地一致（**只看 HTTP 200 不算通过**）
  - **跨域真跑通**：从一个非 GitHub 域名/`file://` 上下文 fetch 该 JSON 成功（不能只看响应头就宣布 CORS 可用）
  - 既有事实基线：2026-09-28 期四方 md5 全等 `598b244bc0704ec3dc8d7f3f08bb561e` / 639,165 B —— 改完后必须复核这条**没被破坏**
- **GitHub Pages 的硬限制（必须知道，不拦路但要写进 SOP）**：
  1. 缓存 `Cache-Control: max-age=600`（实测）⇒ 新一期发布后客户端**最多 10 分钟**才可见；客户端请求加 `?t=<buildAt>` 可立即破缓存
  2. 单文件 100 MB / 站点 1 GB 上限（看板 639 KB，安全；但**安装包不能放这里**，见 M9）
  3. 软限制：约 100 GB/月带宽、10 万次/小时请求（只这一个模块走 GH，量级无风险）
  4. **只服务静态文件，不能按 query 动态计算** ⇒ 只能查「已发布的期」，做不到「实时算任意自定义区间」（本来也不需要）
- **Skill**：`endgame-three-source-analysis`（含已固化的 00→07 脚本）、`generated-artifact-iteration`、`single-source-dual-page`、`ui-ab-visual-regression`、`win-github-upload`、**`derived-index-refresh-audit`**（证明 `board-data.json` 真落地、不是"跑了但没生效"）

**Prompt（可直接复制）**
```
目标：为客户端补「端游可视报告」模块的数据出口，并保证与既有 HTML 看板零漂移。

输入（实测路径）：
- 归档目录：E:\新建文件夹\WorkBuddy\_gh_publish\（2026-08-25 / 08-26 / 08-31 / 09-14 / 09-28 + latest/ + README.md + index.html）
- 最新看板：E:\新建文件夹\WorkBuddy\端游三源周报看板_9.14-9.27.html（639,165 B）
- 当期 Excel：E:\新建文件夹\WorkBuddy\端游三源周报_大报告_2026-09-28.xlsx（55,490 B）
- 出图脚本：endgame-three-source-analysis\scripts\05_gen_board.py（样式基线模板就在这里）
- 发布脚本：endgame-three-source-analysis\scripts\07_publish_github.py
- 上一轮已实测基线：2026-09-28 期在 GitHub Pages latest / .app.workbuddy.host / .app.workbuddy.link 与本地四方 md5 全等 598b244bc0704ec3dc8d7f3f08bb561e，均为 639,165 B

边界（逐条硬约束）：
1. 不许解析 HTML 来取数（那等于第二实现）。数据层必须由 05_gen_board.py 与 HTML 看板一并产出，做「单源派生」。
2. 不许改样式基线。浅色优雅风（#f4f6fb 底 / #1e4ed8 蓝，右上角可切深色）是用户已认可的基线；深色霓虹风在 scripts\_deprecated\05_gen_board_newstyle.py，标注勿用，不许捡回来。
3. 指标口径必须沿用「跨期对比」：本期两周合计 vs 上期两周合计，不是期内 W1 vs W2。
4. 鲸云注册数据源已停用，禁止以任何形式加回。
5. 客户端只渲染，不做计算。

产出：
1. 05_gen_board.py 增加同源产出 board-data.json（含 issue 日期、KPI、各榜单数组、重点表、总结文案），与 HTML 看板在同一次运行里生成
2. 发布脚本（07_publish_github.py）把 board-data.json 复制进各期目录与 latest/，与既有复制 index.html 的逻辑同一处，不许另写一套
3. 客户端唯一数据入口 = https://a13612812330.github.io/endgame-weekly-report/latest/board-data.json（期号版替换 latest 为 <YYYY-MM-DD>）
4. 客户端页面：期号切换器 + KPI 卡 + 榜单 + 重点表 + 「在浏览器打开完整看板」按钮
5. exe 内置最近一期 board-data.json 快照作为离线兜底

验收（必须实测并贴出证据）：
- 5 期全部可切换，无空白期
- board-data.json 与同期 HTML 看板的 KPI 逐项一致（写成交叉校验脚本，故意改一个数字必须 FAIL）
- 线上 board-data.json 的 md5 与本地一致（必须比 md5，不许只看 HTTP 200）
- 跨域真跑通：从非 GitHub 源 fetch 成功（只看到 Access-Control-Allow-Origin 头不算通过）
- 既有目录式短链 /<date>/ 与 /latest/ 的 HTML 仍然 200 且内容未变（新增 JSON 不得影响既有 URL）
- 改完后复核 598b244bc0704ec3dc8d7f3f08bb561e / 639,165 B 这条基线未被破坏

失败处理：某期 board-data.json 缺失时，该期标记 dataLayerMissing=true 并只提供「打开网页版」入口，不许用 HTML 反解兜底。
```

---

### M7 · exe 壳（Electron，路线 A）

- **目标**：双击即用的原生窗口客户端，左侧 6 模块导航，**断网可用**
- **边界**：`server.js` **零改动**；壳目录独立；关窗必须杀子进程
- **产出**：`electron/`（main.js ~150 行 + 导航）+ NSIS 安装包
- **验收**：① 启动 ≤ 5 s ② 8123 被占时不撞车 ③ 关窗无残留进程 ④ 拔网线功能仍可用
- **Skill**：`frontend-dev`、`css-modern-layouts`、`win-project-launcher`、`local-port-consolidation-audit`、**`subprocess-pipeline-contract-audit`**（父子进程契约审计，R14）、**`stale-lock-pid-reuse`**（单实例锁防 PID 复用误判）、**`security-best-practices`**（R13 窗口安全配置）、**`windows-cache-drive-audit`**（R15 缓存迁 E 盘）、**`vercel-react-best-practices`**（客户端前端）

**Prompt**
```
目标：为游戏情报客户端做 Windows Electron 壳（6 模块导航）。
输入：上一轮方案 E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\GameHub-打包方案-exe与APK.md 的 §二「路线 A」。已实测：Electron 缓存有（electron-v39.8.10 win32-x64 ×2）、electron-builder 缓存有、ELECTRON_RUN_AS_NODE 机制本机已在用。
边界：
1. 被包的服务端代码零改动，壳以子进程拉起（fork + env.ELECTRON_RUN_AS_NODE=1）。
2. 端口策略：先探 8123，被占则随机挑空闲端口并用 env PORT 传给子进程；不允许静默自增。
3. 已预判的唯一坑：server.js L463 有 child_process.spawn(process.execPath, [...])，Electron 下 process.execPath 指向 app exe 会失效 —— 改成 ELECTRON_RUN_AS_NODE 方式；仅这一条路由受影响，需登记。
4. 主窗口 closed 必须 child.kill()；不得留后台残留进程。
5. 首屏：轮询 /api/health 直到 200 再 loadURL，不能直接加载造成白屏。
6. 安全基线（R13，必须一次做对）：BrowserWindow 设 contextIsolation=true、nodeIntegration=false、sandbox=true，并显式声明 CSP；preload 只暴露白名单 IPC，绝不把 require / Node 能力透给页面。理由：这几项会渗透整个前端通信结构，后补等于重写。
产出：electron/（main.js、导航菜单、preload）+ electron-builder 配置（NSIS）+ 排除清单（.bak-*、_*-raw.json、.cache/、_archived/、tools/、docs/、devDependencies）。
验收（逐条实测贴输出）：
- 冷启动到首页可见 ≤ 5 秒
- 手动占用 8123 后启动，客户端仍能打开（走了备用端口）
- 关闭窗口后 tasklist 无残留进程
- 断网启动，6 个模块仍可读本地缓存
```

---

### M8 · APK 壳（Capacitor 薄壳）

- **目标**：Android 端查看同一套 6 模块，体积 ~6 MB
- **边界**：不含计算逻辑；直连线上 API（CORS 已全开）；无网给明确提示而非白屏
- **验收**：真机安装可打开、6 模块可切、飞行模式显示「当前网络不可用」
- **Skill**：`frontend-dev`、`agent-browser`、**`security-best-practices`**（禁明文流量：`usesCleartextTraffic=false`；WebView 关闭 file 访问）

**Prompt**
```
目标：把客户端前端打成 Android 薄壳 APK。
输入：已实测 Android SDK 在 C:/Users/komo/AppData/Local/Android/Sdk（platforms 35/36.1、build-tools 34/36.1/37、licenses 已接受）、JDK 17.0.19。
边界（硬约束）：
1. Android 无 Node 运行时 —— 不允许内嵌 Node（nodejs-mobile 明确不推荐），不允许把 data JSON 塞进 assets 让前端自己算（违反禁止第二实现铁律）。
2. 前端 API 引用统一改成 API_BASE 常量（Web 端空串，APK 端指向线上域名）；这是唯一允许的前端改动。
3. 打包前必须设置 ANDROID_HOME；Gradle 首次需联网拉 wrapper，需提前说明。
4. 无网/接口失败必须渲染「当前网络不可用」页面，不是白屏。
产出：capacitor 工程 + 签名 apk（debug 可自签，release 需用户提供 keystore）。
验收：真机安装 → 6 模块可切（含端游可视报告）→ 断网显示提示 → 冷启动 ≤ 3 秒。
失败：Gradle 首次拉取失败时不重试循环，直接输出缺失项清单交给用户。
```

---

### M9 · 同步与更新机制（**需求里「同步 apk 更新」的落点**）

- **目标**：exe 与 APK **同源同版本**，更新清单唯一，行为差异如实标注

| 环节 | exe | APK |
|---|---|---|
| 版本源 | 同一份 `manifest.json`（`version` / `buildAt` / `sha256` / `notes` / `channels`） | 同一份 |
| 检查更新 | 启动时 + 每 6 h | 启动时 + 每次回前台 |
| 下载 | 差量或整包 | 整包 apk |
| 安装 | ✅ 可自动（NSIS 静默升级） | ⚠️ **不能静默** —— 唤起系统安装器，用户点确认 |
| 回滚 | 保留上一版安装包 | 保留上一版 apk 供手动降级 |

- **边界**：不引入第二份版本号；`manifest.json` 托管在既有线上站点（可另备一份到 GitHub Pages），不新增域名；**安装包不放 GitHub**（超单文件上限）
- **验收**：版本号调高 → 两端都检出更新；清单 md5 与本地一致（只测 HTTP 200 不算通过）
- **Skill**：`desktop-installer-static-unpack`、`windows-resident-daemon-supervision`、`sites`、**`security-best-practices`**（R12 更新链路四件套）、**`multi-repo-sync-audit`**（判「到底推没推上去」，多仓库场景）

**Prompt**
```
目标：设计并实现 exe 与 APK 的统一更新与同步机制，单一版本源。
输入：既有线上发布通道；已装 electron-builder 缓存。
边界：
1. 版本源只有一份 manifest.json：{ version, buildAt, sha256, size, notes, minVersion, channels:{exe,apk} }；禁止第二份版本号。
2. APK 不允许承诺静默自动安装 —— Android 平台限制，只能「检查 → 下载 → 唤起系统安装器」。UI 与文档必须如实写明，不许含糊成「自动更新」。
3. exe 自动更新走 NSIS 静默升级；下载必须 HTTPS-only；安装前必须校验 sha256 **与包签名**，任一不符即中止并保留旧版；manifest 带 minVersion 防降级。
4. 数据同步：桌面端保留本地快照只拉差量；APK 只缓存展示数据不计算。
产出：tools/build-manifest.js；exe 侧 updater（检查/下载/校验/替换/回滚）；APK 侧更新页；docs/更新与同步机制.md（含两端行为差异对照表）。
验收（逐条实测）：
- 调高版本号后 exe 检出并完成升级，重启后版本为新值
- APK 检出更新 → 下载成功 → 唤起安装器
- 篡改 manifest 的 sha256 → exe 拒绝安装并保留旧版（反证）
- 线上 manifest.json 的 md5 与本地一致（不能只看 HTTP 200）
失败：任何一步失败都落日志并让用户可见，不静默吞错。
```

---

### M10 · 契约防线与留档

- **目标**：两个月后契约不漂移、结论可追溯
- **产出**：`tools/test-intel-contract.js` + `tools/counterproof-intel.js`（逐项打坏必须变红）+ `PROJECT.md` + 每日日志
- **Skill**：`counterproof-assertions`、`generated-artifact-iteration`、`library`、**`jsdom-ui-behavior-test`**（9 模块交互行为回归，补 `ui-ab-visual-regression` 只管视觉的缺口）、**`multi-repo-sync-audit`**（多仓库推送一致性核查）

**Prompt**
```
目标：为游戏情报客户端建立契约防线与留档规范。
边界：断言必须能被反证打红；不许写恒真断言；不许用 sed 打坏（模式未命中会静默成功并把好断言诬告成恒真 —— 沿用既有教训，改用必须命中的 break_src）。
产出：
1. tools/test-intel-contract.js —— 校验全部出口 schema 与关键字段
2. tools/counterproof-intel.js —— 逐项打坏实现，断言必须全部变红，还原后复绿
3. 项目档案卡 PROJECT.md（S0-S6 留档）+ 当日 YYYY-MM-DD.md 日志
验收：counterproof 全部变红、还原后全绿、逐文件 diff 无差异；留档三件套齐备。
```

---

### M11 · PC 修改器 ★新（数据源本机已有，已在 demo 落地）

- **目标**：客户端内按来源浏览 PC 游戏修改器（中文名 / 版本 / 来源 / Steam ID），直达库页
- **数据来源（实测）**：`game-aggregator/data/trainers.json` —— **3,660 条**（有封面 2,830），5 个来源：CE 修改表 1,851 / 风灵月影 1,157 / 社区贡献 753 / 小幸修改器 59 / GCM 精选 22；匹配率 80.9%
- **⚠️ 取样铁律**：**必须按来源轮询取样**，禁止全局按版本号或名称排序。理由（测试实测暴露）：全局按版本号倒序时前 60 条只剩「社区贡献 + GCM 精选」两个来源，把数量第二多、业界最常引用的**风灵月影**一条不剩地挤掉 —— 多源产品被单一来源淹没是缺陷，不是口味问题。
- **边界**：只展示与跳转，**不提供下载代理**；不展示破解/激活类内容
- **产出**：`GET /api/cli/intel/pc/trainers?src=<key>&limit=`（字段：title/zh/en/version/sourceKey/sourceLabel/steamId/libUrl/cover）
- **验收**：5 个来源在默认首页**均可见**（断言：默认列表来源去重数 == 5）；抽 10 条比对 `libUrl` 可达
- **Skill**：`firecrawl`（备用）、`cross-source-name-matching`（源与库的名称关联）

**Prompt**
```
目标：为统一客户端提供「PC 修改器」模块出口。
输入：E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator\data\trainers.json（3,660 条，5 个来源）。
边界：
1. 只加只读出口，不动既有 /api/trainers/* 路由。
2. ★必须按来源轮询取样（round-robin），组内再按版本号倒序；禁止全局排序 —— 否则风灵月影等来源会被挤光。
3. 只展示与跳转，不做下载代理；不输出破解/激活内容。
产出：GET /api/cli/intel/pc/trainers?src=&limit=，字段 title/en/version/sourceKey/sourceLabel/steamId/libUrl/cover/capturedAt。
验收：默认首页来源去重数 == 5；抽 10 条 libUrl 可达；同日重复调用结果稳定。
失败：源文件缺失时返回空 + reason，不许编造。
```

---

### M12 · PC MOD ★新（已在 demo 落地）

- **目标**：客户端内浏览 MOD / 修改器整合包（标题 / 所属游戏 / 作者 / 浏览量 / 链接数），直达帖子或库页
- **数据来源（实测）**：`game-aggregator/data/mods.json` —— **8,943 条**（`mod` 7,825 + `modifier` 1,118），有封面若干，**99.9% 带下载链接**（合计 13,390 条链接）；匹配率 79.1%
- **边界**：
  1. 只展示元信息与跳转，**不代理网盘下载、不解析网盘直链**
  2. `links` 仅暴露**条数**，不把网盘地址直接铺在客户端（合规与安全）
  3. 不展示成人向内容（源侧存在此类标题，需出口侧过滤）
- **产出**：`GET /api/cli/intel/pc/mods?sort=pv&limit=`（字段：title/game/author/pv/kind/nlink/cover/url）
- **验收**：按浏览量降序断言成立；抽 10 条 `url` 可达；`nlink` 与源 `links` 数组长度一致
- **Skill**：`firecrawl`、`multi-source-date-field`（`ct`/`ut` 时间戳口径）

**Prompt**
```
目标：为统一客户端提供「PC MOD」模块出口。
输入：game-aggregator\data\mods.json（8,943 条；mod 7,825 / modifier 1,118）。
边界：
1. 只加只读出口，不动既有 /api/mods/* 路由。
2. 只暴露 links 的条数，不把网盘地址铺到客户端；不做下载代理、不解析直链。
3. 出口侧过滤成人向内容。
产出：GET /api/cli/intel/pc/mods?sort=pv&limit=，字段 title/game/author/pv/kind/nlink/cover/url/capturedAt。
验收：浏览量降序成立；抽 10 条 url 可达；nlink == 源 links 长度。
失败：源缺失返回空 + reason。
```

---

### M13 · 手游可玩端游 ★新（已在 demo 落地）

- **目标**：展示「哪些端游能在手机上用模拟器玩」，带可玩档位、实测帧数、配置方案数、实测设备台数
- **数据来源（实测）**：`game-aggregator/data/mobilehub.json` —— **3,264 条**，累计 **16,148 套配置方案**、**1,037 条实机记录**；`stats` 含 `playable` / `pcGames` / `matchedRate` 等
- **语义提醒（重要，别再搞错）**：这里的「手游」**不是指手机原生游戏**，而是**「手机能玩的端游」**（模拟器可玩性库）。模块名必须写「可玩端游」，不许简写成「手游游戏」。
- **字段口径**：`tier` 可玩档位、`bestLabel` 实测帧数区间、`configs` 配置方案数、`devices` 实测设备列表、`chips` 芯片代号；部分字段是**字符串化的 list**（如 `"['Adreno 750', …]"`），出口侧必须解析成真数组再返回
- **边界**：只做可玩性展示与跳转；**不做模拟器下载分发、不给超频/破解指导**
- **产出**：`GET /api/cli/intel/mobile/playable?tier=&limit=` + 字段解析器（字符串 list → 数组）
- **验收**：抽 10 条的 `devices`/`chips` 为**真数组**（断言 `Array.isArray` 为真，防止把字符串直接透传）；有档位的条目排在无档位之前
- **Skill**：`device-model-to-chip-translation`（设备代号 → 机型/SoC）、`cross-source-name-matching`

**Prompt**
```
目标：为统一客户端提供「手游可玩端游」出口。
输入：game-aggregator\data\mobilehub.json（3,264 条，16,148 套配置，1,037 条实机记录）。
边界：
1. 只加只读出口，不动既有 /api/device/*、/api/pc/* 路由。
2. ★字段 devices/chips/tiers/alt/exes 在源里是「字符串化的 python list」，必须解析为真数组再返回，禁止原样透传字符串。
3. 只做可玩性展示与跳转，不做模拟器分发、不给超频/破解指导。
产出：GET /api/cli/intel/mobile/playable?tier=&limit=，字段 title/full/alias/tier/fps/configs/devices[](数组)/chips[](数组)/libUrl/cover。
验收：断言 Array.isArray(devices) 为真；有 tier 的排在无 tier 之前；抽 10 条 libUrl 可达。
失败：源缺失返回空 + reason。
```

---

## 五、阶段推进

| 阶段 | 做什么 | 产出 | 风险 |
|---|---|---|---|
| **P0** | M0 契约层（含**安全约定章节**，R12/R13）+ **用现有本机数据跑通 PC 全部 5 个模块**（新游/热游/排行/**修改器**/**MOD** —— 数据源实测均在本机） | 出口 + 契约文档 + 安全约定 + **demo 转正（快照换实时）** | **低**（不动打包；契约与安全约定一旦定错，后面全白做）。★Steam 真源不在 P0（R16） |
| **P1** | M4/M5/M13（手游侧：新游 + 活动 + **可玩端游**，接 GameNews + 飞书） | 3 个出口 | 中（飞书凭据/表结构是外部依赖；活动类目稀疏，见 R17） |
| **P2** | **M6 端游可视报告**（补 `board-data.json` → 推 GitHub Pages → 客户端直连，不经服务端） | 报告页 + GH 上的 JSON 接口 | 中（**前置改造：现在没有数据层**） |
| **P3** | M7 exe 壳（**9 模块**导航） | 可双击、可离线的 exe | 低 |
| **P4** | M9 更新机制（先 exe 侧） | manifest + exe 自动更新 | 中 |
| **P5** | M8 APK 薄壳 + APK 更新 | ~6 MB apk + 更新页 | 中 |
| **P6** | M2 热游合成 + M10 防线留档 | 热度公式 + 防线脚本 | 低 |

> **P0 范围已扩到「PC 五个模块」**（原 P0 只有三个）：因为 M11/M12 的数据源（`trainers.json` 3,660 条、`mods.json` 8,943 条）**同样已在本机、无需新建抓取链**，与 M1–M3 同级成本，一起做边际成本最低。**PC 侧全部 5 个模块 + 手游可玩端游（M13）都不需要新建抓取**，这是调整后 P0/P1 的真实起点。
>
> **M6 为什么排 P2**：它要**改动既有看板出图流水线**（不是纯新增出口），所以不排在最前面。
> **但它也是全项目唯一零依赖的模块** —— 不依赖契约层、不依赖本地服务、不依赖其余 8 个模块。所以如果你想先看到实物，**M6 可以单独提出来先做**（补 JSON → 推 GH → 用一个静态页验证），不影响 P0 的契约设计。

---

## 六、风险与硬约束

| # | 约束 | 后果 | 应对 |
|---|---|---|---|
| **R1** | **APK 不能静默自动更新** | 「同步 apk 更新」只能做到「同步检出 + 引导安装」 | UI 与文档如实标明；不许对外说「自动更新」 |
| **R2** | Android 无 Node 运行时 | APK 只能薄壳，**不能离线** | 走线上 API（CORS 已全开） |
| **R3** | 禁止第二实现（既有铁律） | 逻辑搬进前端必与 server.js 漂移 | 所有计算留服务端 |
| **R4** | `process.execPath` 在 Electron 下失效 | `POST /api/bh/refresh` 会失败（唯一已知坑） | 改成 ELECTRON_RUN_AS_NODE 方式 |
| **R5** | 飞书凭据来自 Windows 用户级环境变量 | 不可打包进客户端 | 凭据只在服务端 |
| **R6** | C: 盘仅剩 12 GB | 打包中途爆盘 | 产物与缓存放 E:（671 GB 可用） |
| **R7** | 8123 现在没在跑 | 客户端首次跑需自己拉起服务 | 壳内做健康检查，不依赖外部已启动 |
| **R8** | 契约漂移 | 两个月后各端字段不一致 | M10 反证防线 + 校验脚本进 CI |
| **R9** | **端游报告只有 HTML 看板，无数据层** | 若客户端解析 HTML 取数 ⇒ 变相第二实现，必与看板漂移；且看板 639 KB，解析成本高 | 强制新增 `board-data.json`，由 `05_gen_board.py` **同源产出**并随 HTML 一起推到 GitHub Pages；校验脚本断言「数据层数字 == 看板数字」 |
| **R10** | 看板样式基线已被否决过一次 | 再漂回深色霓虹风会被打回 | 样式基线写进 SOP §5.0（强制）；`_deprecated/` 标注勿用；改完跑 `ui-ab-visual-regression` |
| **R11** | **GitHub Pages 不是"真接口"** | 只服务静态文件、缓存 10 分钟、单文件 100 MB 上限；被误当成能动态计算的 API 会翻车 | M6 只做「查已发布的期」；客户端请求带 `?t=<buildAt>` 破缓存；安装包严禁放 GH（见 M9 决策点 6） |

### 6.1 安全基线（★本轮新增，此前方案零安全约束 —— 这是最大缺口）

以下 4 条由新增技能 `security-best-practices` 驱动。**理由**：本客户端要「下载远程包并执行安装」，这是一个**远程代码执行入口**，安全不是加分项而是及格线。

| # | 约束 | 后果（不做的代价） | 应对 |
|---|---|---|---|
| **R12** | **更新链路 = RCE 入口** | 更新包被篡改或中间人替换 ⇒ 直接在你机器上执行任意代码 | M9 强制四件套：**HTTPS-only** + `sha256` + **包签名校验** + `minVersion` 防降级（杜绝回滚到有漏洞的旧版） |
| **R13** | **Electron 默认配置不安全** | `nodeIntegration` 开 + 无 CSP ⇒ 被嵌页面里的任意脚本都能拿到 Node 能力 | `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`、显式 CSP；preload 只暴露**白名单 IPC**，不暴露 `require` |
| **R14** | **父子进程契约不止一个坑** | R4 只登记了 `process.execPath` 一处；端口继承 / 退出码 / 信号 / 僵尸进程都可能出问题 | 上 `subprocess-pipeline-contract-audit` 做**一次完整契约审计**，而不是见一个修一个 |
| **R15** | **打包缓存默认落 C 盘** | C 盘仅剩 12 GB（R6）：Electron + electron-builder + Gradle 缓存叠加必爆盘 | `windows-cache-drive-audit` 把三类缓存**迁移或软链到 E 盘**，打包前先跑一次体检 |
| **R16** ★demo 实测 | **「Steam 数据已在本机」这一前提不成立** | 原方案把 M1–M3 排为 P0，理由是"数据已在本机、当天可验"。实测 A 端无 Steam 商店源 ⇒ 若照旧排期，P0 第一步就会卡住 | 更正 M1 数据来源；**P0 改为「契约层（含安全约定）+ 用现有游戏库先跑通 3 个 PC 模块」**，Steam 真源另立阶段 |
| **R17** ★demo 实测（v3 已更正） | **手游活动类目稀疏**（原判断过重，已更正） | v2 只看了 `/api/articles` **第一页 50 条**，得「活动类合计 2 条」；v3 **翻页拉全量 301 条**后实测类目为「新游上线 166 / 测试公测 24 / 版本更新 100 / 联动活动 8 / 活动 3」⇒ 活动类**实际 11 条**（联动 8 + 活动 3），另有 100 条版本更新。**教训：对分页接口只看第一页会系统性低估，任何"源侧数据稀疏"的结论必须先翻页取全量再下** | 缺口仍然成立但性质不同：源码侧**没有独立活动出口**，只能靠类目 + 关键词组织 ⇒ M5 仍需新增 `/api/cli/intel/mobile/events`。客户端侧不得只取第一页 |
| **R18** ★v3 实测新增 | **图源防盗链会让图直接不显示**（这才是「图片没适配」的真因） | 模拟浏览器带 localhost 来源头加载 **603 张图 → 235 张挂**：`img-tc.tapimg.com` 167/167 → HTTP **567**；`imgs.gamersky.com` 65/65、`image.gcores.com` 3/3 → HTTP **403**。去掉来源头后 **603/603 全部 200** | 全站 `<meta name="referrer" content="no-referrer">` + 每张 `<img referrerpolicy="no-referrer">`；**新增任何图源前必须先跑"带/不带来源头"对比**，确认是否需 no-referrer |
| **R19** ★v3 实测新增 | **同一域名内图片比例不统一，禁止在后端猜比例** | `img-tc.tapimg.com` 同域并存 **270×270 方形 icon（103 张）** 与 **1080×608 横版截图（64 张）**，相差 10 倍；`www.xdgame.com` 同样混有 128×128 与 460×215。任何"按域名映射比例"的方案都会错，且方形 icon 用 cover 会被裁掉约 44% | **比例由前端读原图 `naturalWidth/Height` 自适应**（<1.45 → contain，≥1.45 → cover）；容器比例固定 `--th-ar` 故不抖动。实测分支：239 张 contain / 364 张 cover |

> **R12–R15 与 R1–R11 的区别**：R1–R11 是「功能边界」（能做成什么样），R12–R15 是「安全与工程底线」（做成了也不能出事）。前者影响交付范围，后者影响**能不能给别人用**。

---

## 七、待你拍板

> **★v9 的 4 项视觉决策不在本表** —— 它们记在 `SOP-游戏情报客户端.md` §6（#7–#10），
> 并已于 **2026-10-09 全部拍板，结论均为「保持现状」**（深色默认 / 中性灰底色 / 排行榜窄列去 pill / 首页小卡循环）。
> ⚠️ **其中「排行榜窄列去 pill」一项已被 v10 取代** —— v10 排行榜改**固定 2 列**（列宽 565px），
> `.rpill` 恢复并**改挂「热度口径标签」**（不再是来源 pill），见 SOP §1.3.5。
>
> **★v10 的 3 项（同日，用户当轮点名）已拍板并落地**：① 首页孤行 → **固定 5 列 × 每块 10 张**；
> ② 手机热游榜热度口径 → **按源归一化后混排**；③ MOD 三处问题 → **三个都修**。记录见 SOP §6 开头。
>
> 本表 #1–#9 是**工程与范围**类决策（契约出口、模块起点、安全基线…），仍待答复。

| # | 决策点 | 选项 | 我的建议 |
|---|---|---|---|
| 1 | 契约出口放哪 | ① 分别加在各既有项目 ② 新建独立 BFF 服务 | **①**（不新增运维面，三个项目本来就在跑） |
| 2 | 客户端是新项目还是并进 game-aggregator | ① 新建独立项目 `E:\新建文件夹\Codex-GPT\tools\game-intel-client` ② 塞进 game-aggregator | **①**（壳代码与被包服务端必须物理分离） |
| 3 | P0 先做哪几个模块 | ① **PC 五模块**（新游/热游/排行/修改器/MOD，**全部本机已有数据**）② 九个一起 ③ 先补 Steam 真源再开工 | **①**（手游活动源侧几乎为空 R17；端游报告需前置改造 R9；Steam 真源不存在 R16 —— 三者都不能当第一刀；而 PC 五模块 + 手游可玩端游都**不需要新建抓取**） |
| 4 | exe 数据带多少 | 全量离线 / 核心包 / 薄壳 | **核心包**（客户端只要「情报」列表，不需要 92 MB 游戏库） |
| 5 | APK 现在做还是等 exe | 等 exe 定稿 / 现在就做 | **等 exe 定稿**（经验直接复用） |
| 6 | 更新清单托管位置 | 既有线上域名 / GitHub Releases / GitHub Pages | **既有域名**（不新增域名，已有发布链路）。补充：`manifest.json` 是小文件（<1 KB），**也可以顺带放 GitHub Pages**（同 M6 那条通道）；但 **exe/apk 安装包严禁放 GH** —— 单文件 100 MB 上限，安装包基本会超 |
| 7 | 要不要跨两端统一搜索 | 要 / 不要 | **要**（复用已有搜索，成本低、体验收益大） |
| **8** | **端游可视报告在客户端怎么呈现** | ① 拉 `board-data.json` 客户端原生渲染，**数据托管在 GitHub Pages**（你的方案，已实测 `Access-Control-Allow-Origin: *`）② 客户端内嵌线上看板（iframe / WebView）③ 放到本地服务端出口再由客户端拉 ④ 只放跳转外链 | **①（采纳你的 GitHub 映射思路）**：不新增域名 / 不新增服务端 / 不加运维面，白拿免费 CDN；且该模块因此**不依赖本地服务**，是 6 个模块里唯一能**纯静态跑通**的一个，可当先行验证。②嵌第三方站慢、UX 差；③多一层本地服务依赖，8123 挂了报告也跟着挂；④太弱，等于没做模块。代价仍是要补数据层（R9） |
| **9** ★新 | **安全基线什么时候上** | ① 等做到 M7/M9 再补 ② **M0 阶段就把 R12/R13 写成契约文档里的「安全约定」章节**，M7/M9 直接照做 | **②**：安全配置是典型的「后期补必返工」项 —— Electron 的 `contextIsolation` / preload IPC 白名单会**渗透整个前端结构**，等 UI 写完再改等于重写通信层。建议与数据契约同级、同期定死 |

---

## 八、技能调用清单（komo-expert 1.2.0 · 全部已过存在性预检）

**预检口径**：`preflight_skills.py` 实测 **52 项 → OK 51 / INLINE 1 / UNKNOWN 0**（2026-10-08）。INLINE 项必须显式降级声明，禁止声称「已调用」。

### 8.1 流程层（专家 1.2.0 新增，此前方案没有这一层）

| 用途 | Skill | 预检 |
|---|---|---|
| 六阶段流程管控 + 门禁 + 留档 | `small-project-guide` | OK |
| 能力路由（唯一事实来源 `skill-alias.json`） | `komo-skill` | OK |
| 上下文压缩、长项目不失忆 | `context-engineering`、`headroom` | OK |
| 执行计划拆分（S3） | `create-plan` | OK |
| 模糊需求归一 | `zh-fuzzy-router` | OK |

### 8.2 数据侧（M0–M6）

| 模块 | Skill | 预检 | 用途 |
|---|---|---|---|
| M0 | `product-design` / `sqlite-mcp-server` / `project-analysis` | OK | 契约设计、本地缓存、**前置架构摸底** |
| M0 | `prod-db-copy-preview-verify` ★新 | OK | 读生产 SQLite 前**先拷副本**，不污染生产库 |
| M0・M10 | `counterproof-assertions` | OK | 反证防线 |
| M1・M3・M4・M5 | `firecrawl` | OK | 结构化抓取 |
| M1 | `web-internal-api-reverse` | OK | 还原 Steam 商店接口 |
| M3 | `katana-crawl` | OK | 榜单页结构探测 |
| M2・M6 | `endgame-three-source-analysis` | OK | 既有三源口径 + 00→07 脚本 |
| M2・M3 | `fetch-failure-cache-poisoning` | OK | 防「抓取失败被缓存成空」 |
| M4 | `cross-source-name-matching` | OK | 跨源同名防误匹配 |
| M1・M5 | `multi-source-date-field` | OK | 日期口径统一 |
| M6 | `generated-artifact-iteration` / `single-source-dual-page` | OK | 静态产物迭代 / HTML+JSON **单源派生** |
| M6 | `ui-ab-visual-regression` | OK | 样式基线改前改后量化对照 |
| M6 | `derived-index-refresh-audit` ★新 | OK | 证明 `board-data.json` **真落地**（而非"跑了没生效"） |
| M6・M9 | `win-github-upload` | OK | 归档推 GitHub |

### 8.3 客户端与工程侧（M7–M10）★本轮扩充

| 模块 | Skill | 预检 | 用途 |
|---|---|---|---|
| M7・M8 | `frontend-dev` / `vercel-react-best-practices` | OK | 客户端前端 |
| M7 | `css-modern-layouts` / `win-project-launcher` / `local-port-consolidation-audit` | OK | 响应式、启动器、端口治理 |
| M7 | `subprocess-pipeline-contract-audit` ★新 | OK | **父子进程契约审计（R14）** |
| M7 | `stale-lock-pid-reuse` ★新 | OK | 单实例锁防 PID 复用误判 |
| M7・M9 | `windows-cache-drive-audit` ★新 | OK | 打包缓存迁出 C 盘（R15） |
| M7・M9 | `security-best-practices` ★新 | OK | **R12 / R13 安全基线（本轮最大补充）** |
| M8 | `agent-browser` | OK | 移动端视图预验 |
| M9 | `desktop-installer-static-unpack` / `windows-resident-daemon-supervision` / `sites` | OK | 产物校验、守护、发布 |
| M10 | `jsdom-ui-behavior-test` ★新 / `frontend-polish-review` ★新 | OK | **交互行为回归** / 视觉打磨评审 |
| M10 | `library` | OK | 资料库留档 |
| M10 | `multi-repo-sync-audit` ★新 | OK | 多仓库推送一致性（本轮共 4 个仓库） |
| — | `react-best-practices` | ⚠️ **INLINE** | 映射表仍称「无独立技能」⇒ **降级改用 `vercel-react-best-practices`（OK）**，不声称「已调用」 |

---

## 九、流程对齐（komo-expert 1.2.0 六阶段 ↔ 本项目）

专家升级到 1.2.0 后新增了**流程层**，本项目需要按六阶段走。以下为**实测**对齐结果：

| 专家阶段 | 本项目当前状态 | 对应本方案章节 |
|---|---|---|
| **S0** 进场判断 | ✅ 已过（类型 = 新建 + 集成；分级 = 高；步数 > 3 ⇒ 必走 S3） | 一、需求规范化 |
| **S1** 需求补全 | ✅ 四要素已齐（产出确认单 + 六字段 Prompt） | 一、二 |
| **S2** 启动确认 | ⏸ **等你确认**（8 项清单已出；本阶段红线：禁止落盘） | 三、八 |
| **S3** 执行计划 | ⏸ 待 S2 过后出（≤5 大步 + 四属性） | 五、阶段推进 |
| **S4** 分步执行 | ⏸ — | 各 M 模块 Prompt |
| **S5** 验收交付 | ⏸ — | 各模块「验收」字段 |
| **S6** 归档收尾 | ⏸ — | 十、五项汇报 |

**门禁脚本**（升级后才有，此前项目未初始化）：

```bash
# 阶段状态机（记录进度、校验门禁）
python <komo-expert>/skills/small-project-guide/scripts/flow_state.py "E:\新建文件夹\WorkBuddy\2026-10-08-14-02-06"
# 交接简报（防失忆）
python <komo-expert>/skills/small-project-guide/scripts/project_brief.py "E:\新建文件夹\WorkBuddy\2026-10-08-14-02-06"
```

> **实测**：两者当前都报**未初始化**（`.workbuddy/flow.json`、`.workbuddy/memory/PROJECT.md` 不存在）—— 因为这两个文件是专家 1.2.0 才引入的流程产物。是否初始化，等你一句话。

> **P0–P6 与 S3 不冲突**：P0–P6 是**技术路线图**（做哪些模块、什么顺序），S3 要的是 **≤5 大步执行计划**。真动手时把 P0 那一段折成 S3 步数表即可，不必重写方案。

---

## 附：本方案引用的全部已核实源

| 项 | 值 |
|---|---|
| 上一轮打包方案 | `E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\GameHub-打包方案-exe与APK.md`（16,180 B） |
| 上一轮适配方案 | `E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\游戏资源服务工具-适配方案-v0.6.0.md`（15,942 B） |
| 参考客户端（静态解包） | `E:\新建文件夹\游戏资源服务工具演示 0.6.0.exe`（104,969,924 B，NSIS + Electron + Vue3） |
| A 端 | `E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator`（v10.42） |
| B 端 | `E:\新建文件夹\Codex-GPT\GameNews`（三端口在跑） |
| C 端归档 | `E:\新建文件夹\WorkBuddy\_gh_publish\`（5 期 + latest） |
| C 端最新看板 | `E:\新建文件夹\WorkBuddy\端游三源周报看板_9.14-9.27.html`（639,165 B，md5 `598b244b…`） |
| C 端线上短链 | `https://a13612812330.github.io/endgame-weekly-report/latest/` |

### 附.1 可运行 demo 前端（★v10 迭代后实物）

| 项 | 值 |
|---|---|
| 入口 | `E:\新建文件夹\WorkBuddy\2026-10-08-14-02-06\demo\index.html`（**116,009 B / 2031 行**，md5 `bbc55e75b85d139ca1af18ced463dbaa`；双击即开，file:// 可用） |
| 数据层 | `demo\data.js`（`window.__DEMO_DATA__`，**455,925 B**，md5 `ae6543265aeb8696872383e55dff0aac`，快照；手游侧直读 GameNews SQLite 只读）|
| 数据生成 | `demo\_build_data.py`（只读既有项目，可重复执行刷新快照）；**★v10 另加 `demo\_patch_mod.py`** —— 只补 `pcMod` 来源字段的定向补丁（前置自检 `json` 往返逐字节一致，不满足则拒绝写），用于「上游数据已更新、不宜整份重跑」的场合 |
| 回归测试 | `demo\_t_demo.js`（jsdom，**358 条断言：358/358 通过**；v8 298 → v9 330 → v10 **358**） |
| 反证脚本 | `demo\_counterproof.py`（逐条打坏 → 断言必须变红 → 自动还原复核；v10 跑 **25 处全部命中**） |
| **视觉验收（★v7 建能力 / ★v8 换引擎）** | `demo\_shot.py` + `demo\_shot.js` —— **必须走 CDP**：`chrome --screenshot` 拍出来是**未光栅化的空白图**，且空白位置每次随机（实测同一页两次：一次前 8 张空、一次后 5 张空）。`_shot.js` 在 `Page.captureScreenshot` 前**先 `await` 所有 `img.decode()`** + 两帧 rAF，图片本地缓存 557/557。**jsdom 不加载图片 ⇒ 断言覆盖不到图片与版式，必须靠它截图人眼验** |
| 图片本地缓存 | `demo\_imgcache\`（557 张，43 MB，**截图专用，不参与交付**）—— 截图不依赖网络，可复现 |
| 图片对照 | `demo\图片适配对照.html`（四档 A 模糊底 / B 浅灰衬底 / C 16:9 cover / D 3:2 cover，真实封面实物） |
| 视觉基线 | **★v9 起为双主题**：深色（**默认**）＋ 浅色。深色**取 TapTap 的「主色 + 版式」，底色刻意用中性灰**：主色青绿 `#00D9C5`〔DOM ×64〕、强调橙 `#FF6F38`〔DOM ×86〕**照抄**；底色采纳 `#161616`/`#1f1f1f`（**未采纳** TapTap 实测的偏蓝灰 `#1b1c21`〔TapTap 自声明 `--universal-tab-bar-bg: rgb(27,28,33)`，实拍采样 59.6%~93.8%〕/ `#26282f`〔采样 51.5%〕—— **2026-10-09 用户拍板「保持中性灰」**，实测值作为证据留档，见 SOP §1.2.4 / §6 #7）。浅色沿用端游看板「浅色优雅风」`#f4f6fb` / `#1e4ed8` / `#1e3a6e`，**像素级零退化**。两套**共用一份规则代码**，深色只覆盖 token |
| **双主题机制（★v9）** | `<head>` 同步脚本先定 `data-theme`（防闪，必须在 `<style>` 之前）+ 顶栏 `#themeBtn` 切换 + `localStorage['gi-theme']` 记忆。**切换只改 `<html>` 属性、不重建 DOM** ⇒ 不丢 Tab / 筛选 / 滚动。token 分两层：语义层（原 `--bg/--card/--accent…`）+ 主题层（v9 新增约 40 个：`--raise/--sunken/--soft/--on-accent/--title-strong/--ph/--sub2/…`）。三条硬约束见 SOP §1.2.4 |
| **浅色零退化的证据（★v9）** | `demo\_cmp.py` 逐像素比对同视口截图：与 v8 基线差异 **0.27%**，且差异区域 `y=11..40 / x=1066..1395` **恰好只有顶栏右侧新增的切换按钮**，主内容区完全一致 |
| 覆盖模块 | **10 个 Tab 全部可点、全部真实数据**：**首页**（大图轮播 + PC/手游三块精选）/ PC 新游 60 / 热游 60 / 排行 80 / 修改器 60 / MOD 60；手游新游 **153**（原始 160 条 → **同游戏合并**）/ 活动 **98** / 可玩端游 60；端游报告 5 期 |
| **首页 + 大图轮播（★v8 新增 / ★v9 改版式 / ★v10 去孤行）** | **★v10：精选块改「固定列数 + 数量配对」** —— `.hseclist.pc{repeat(5,minmax(0,1fr))}` + PC 两块各 **10 张**、`.hseclist.mb{repeat(3,…)}` + 手游块 **6 张**。根因（**像素实测**，不是推断）：`auto-fill + minmax(212px)` 在 1424 宽下**恰好 5 列**（列起点 224/459/698/938/1177），而每块写死 **6 张** ⇒ **5+1 孤行**、第二行右侧一整条空白。「列数由宽度定 + 卡片数写死」是**一类**缺陷，排行榜 `3+1` 同源。<br>★v9：**「1 大 + 2 小」** —— `.hero(flex) > .hmain(flex:1，内含 .hslide 大图+信息 + .hctrl + .hprog)` + `.hside(flex:0 0 272px，与 .hmain 同高)`；右侧每组两张预览小卡（取「下一张 / 下下张」循环 —— **2026-10-09 拍板：保持循环**），`.hside-set` 用**绝对定位 + opacity** 切换而**不是 `display:none`**（后者会让浏览器跳过图片加载 ⇒ 切换闪空白）。`.hpic` 主图占比 46% → **52%**。<br>v8 原有：`heroItems()` 取 `pcHot` 热度 Top3 + `pcNew` ts Top3 + `mNew` 热度 Top3；`HERO_MS=5000` 自动切换、`mouseenter` 暂停；**`render()` 开头先 `stopHero()`**（否则回首页叠 interval 变 N 倍速）。首页卡片**带自己所属 tab**（`data-d="pcHot"`），弹窗据此跨 Tab 取数 |
| **PC 排行榜（★v8 重做 / ★v9 改版式 / ★v10 收敛为 4 榜）** | **★v10（用户口径：`排行榜不需要搜索/品类筛选，只需要PC新游/PC热游/手机热游`）**：**4 个分榜 —— PC 新游榜 / PC 热游榜 / 手机新游榜 / 手机热游榜**，各 Top 12 = **48 行**；**每榜的数据池 = 对应 Tab 的池子**（行带 `data-d` 就是那个 Tab ⇒ `openDetail` 跨 Tab 取数天然对齐）；**整页绕过「搜索 + 筛选 + 排序栏」**（渲染分支早退）；`.rankboards{grid;repeat(2,minmax(0,1fr))}` **固定 2 列**（4 榜 = 2×2；沿用 `minmax(340px)` 会 3+1 孤行）。**手机热游榜按源归一化排序** —— 实测 `mNew.hot` 跨源差 **3 个数量级**（822 万 / 143 万 / 2.2 万），直接混排等于「按来源排序」；换算成**本源内百分位**再排，**原始数值照常展示、行内标口径**。`pcRank` 计数改为榜上实际行数（80 → **48**）。`.rbarwrap`（比例条）已彻底删除（断言锁 0）；`.rpill` **复用为「热度口径标签」**（v9 曾因窄列摘掉，v10 列宽 565px 够用）。<br>★v9：三榜并排（`auto-fit/minmax(340px)`）+ 窄列去元素。★v8：从网格卡片改为**列表 + 分榜**（`.rankboard > .rbhead + .rlist > .rrow`，名次金银铜 / 缩略图 / 指标值）。<br>⚠️ **初版做了「评分榜」，实测后废弃** —— `pcRank` 80 条 `scoreV` **全部 = 10.0**，评分榜就是 12 条并列第一、零信息量 ⇒ 不摆没区分度的榜，且在 notice 里**明写原因**（不静默省略） |
| **MOD 页（★v10）** | ① 卡片左上角挂**来源**（机地）而不是类型「MOD」（原来挂 `kind` ⇒ 60 张卡长得一样、看不出数据取自哪）；② 弹窗给**两个链接** —— `postUrl`（机地原帖 `jidiyouxi.com/post/detail/…`）/ `libUrl`（匹配到的库页面），原来 `url = libUrl or url` 会把原帖覆盖成 **XD 游戏页**（实测 Top60 中 51/60 中招）；③ 删掉「类型」筛选组 —— 全库修改器最高 pv 仅 3,409、进不了 Top60，点它必然空集，且「修改器」已有独立 Tab（`pcTrainer`）。**MOD = 机地单一源**，完整来源链见 SOP §1.3.8 |
| **卡片标题（★v8）** | `nameParts(t)` 把「中文名/英文名/别名」拆成 `主名（英文名）`，**只按段是否含 CJK 分类、不做词义猜测**；两条护栏：无纯英文段 ⇒ 不动、全是英文段 ⇒ 也不动。`.ctitle .en` 小半号降灰一档。**删除** v6 的 `splitName()` |
| **手游卡（★v8 三改）** | ① 时间**只出现一次**（标题后缀只留状态词，日期统一走绿色 `.msub.gn`）；② 平台标签移到**右上角** `.mtop`（绝对定位、脱离文档流 ⇒ 不影响卡高）；③ 标签超 2 个折叠为 `+N`。连带：卡高 `96 → 106px`、`padding-top:26px` |
| **活动卡（★v8）** | 新增 `.mtime`（绿色、`flex:none`）显示上线时间（`launchText \|\| dateText \|\| tlDate`）；类目 pill 移到右上角 `.mtop`，与新游卡位置对齐 |
| **图片可见性（★v8 重大修复）** | **改由 CSS 决定，不再依赖 `onload` 回调**：`img` 直接可见 + `z-index:1` 压住占位 `.ph`，`reveal()` 降级为纯优化动作。修的是「图加载完了却一直透明」（命中缓存时 `load` 早于节点入树 ⇒ `.ready` 永不加 ⇒ `opacity` 卡 0）。同时**移除 `loading="lazy"`**（无头下几乎不触发，会让视觉验收失真） |
| **卡片骨架（v4 定稿）** | **唯一骨架 `cardShell()`**：`缩略图 16:9 → 标题(预留两行 2.8em) → 元信息行(20px) → 底栏(贴底 20px)`；**PC 5 Tab + 手游可玩端游共用同一段代码**，段序被断言锁死 |
| **手游卡片（v5→v6）** | 新游按参考图版式：`icon(72×72) + 游戏名·状态🔥 + 标签行(多平台→多标签) + 绿色时效行 + 右侧大号数字`；**v6 补齐「逐行定高 + 整卡定高 + 右列定宽 76px 右对齐」**，位置不再受名称/标题/标签影响；活动保持 `banner + 游戏名 + 时间 + 类目 + 活动标题`（`subOf()` 剥掉重复《游戏名》） |
| **弹窗（v6 重做）** | 版式对齐 **PC 游戏工作台详情抽屉**：`.dtop`(模糊底+主图+渐变压字+来源角标+关闭) → `.dnotice` → `.sline`(27px 大号分) → `.dkv` 三列字段网格 → `.dblock` 分区块 → `.dlinks` 主次按钮 → `.dfoot`；遮罩/✕/ESC 三路关闭 |
| **图片适配（★v7 重做）** | **按场景分两套，都不做 JS 判断**：<br>· **卡片缩略图 `.cv`** → `aspect-ratio:16/9` + **`object-fit:cover`** 满幅（偏"统一"；方图接受纵向裁 43.7%）<br>· **弹窗 hero `.dfg`** → `width:100%;height:auto;max-height:min(50vh,420px);object-fit:contain`（偏"完整"，不裁不切）+ `.dbg` 同图模糊底填留白<br>**删除了** `fitImg()` / `.cv img.fit-c` / `.cv.blurbg::before` / `--bgi` 一整套按比例分叉机制 |
| **数据白名单（v5）** | 手游来源收窄为 **TapTap / 好游快爆 / 小七** 三源（**新游 + 活动**都收窄，v6 用户确认「不放入」资讯源）；按游戏名合并同游戏（160 → 153，其中 3 个跨源多平台） |
| **报告形态（v4 定稿）** | **可折叠列表**：标题行显示报告名称（取看板文件名）+ 日期 + 类型角标，**默认只展开最新一期**，点击切换（含最新一期可收起），只切 class 不重渲染 |
| **数据补字段（v6）** | 不改上游，只抽既有库字段补留白：PC 侧 `appid`(57/60) / `published`(34/60) / `updated`(60/60) / `jidiId`(34/60) / `recId`(60/60)；手游侧 `timelineDate`(31/153) / `publisher`(28/153) / `haoyouTimelineTab`。右侧数字列改**三档兜底**：评分(绿★) → 热度(橙🔥) → 灰 `—` |
| 图片可达性 | 557 张去重图 → **555 可达**；2 张 xdgame 2021 老路径已 404（`速度生活` / `古惑狼4:时机已到`），走 `onerror` 占位。**52jidi 封面 `/sz/src`→`/sz/420`**（140×140 → 215×215） |
| 已知缺口 | ① Steam 真源不存在（R16）② 源码无独立活动出口（R17）③ 端游报告无 `board-data.json`（R9）④ 报告 `2026-08-25` 期线上 404（该期仅 xlsx）⑤ 小七源在 GameNews 侧仍是 `monitorOnly`（靠已有 22 条入库记录进 demo，**未改 GameNews**）⑥ 卡片 `cover` 会纵向裁掉方图约 43.7%（已知取舍，见 §6 #10） |

> **v3 修掉的一个真实缺陷**：修改器模块最初按版本号全局倒序取样，测试断言「搜风灵月影应有命中」**变红（60 → 0）** —— 前 60 条被「社区贡献 + GCM 精选」两个来源占满，数量第二多的风灵月影一条不剩。改为**按来源轮询取样**后 5 个来源各 12 条。这条已写进 M11 的硬约束，别再退回去。
>
> **v4 修掉的一个真实缺陷**：报告页 `render()` 里 `if(cur==='report'){...return}` **提前 return**，跳过了页面底部的交互绑定 ⇒ 折叠列表点了没反应（断言 5 条变红）。修法是把绑定抽成 `bindMain()`，两条分支都调用。教训：**任何「提前 return 的渲染分支」都要单独确认交互绑定是否被跳过**。
>
> **v5 修掉的三个真实缺陷**（都是"界面上看不出异常"的类型）：
> 1. **手游小七整源静默丢失** —— `/api/articles` 返回 `total: 301`，而库内 `articles` 表实为 **423 条**，
>    差额里就有 **小七整源 22 条**。翻页拉"全量 301"看上去完全正常，界面无任何异常。
>    修法：**直读 SQLite（`mode=ro` 只读）**，并在 SOP 里定死「走分页 API 必须比对 `total`」。
> 2. **好游快爆脏标签** —— `haoyouTags` 偶发把页面「猜你喜欢/推荐位」整段文案抓进标签，
>    实测 3 条变成 `宝可梦：羁绊之旅-玩家自制 8.7分 25981热度` 这种。真标签都很短、无空格、无「N分/N万下载」。
>    修法：入库前过滤（长度 >14 / 含空格 / 含 `数字+分|万|热度|下载` 一律丢弃）。
> 3. **热游图片发虚** —— 52jidi 封面存的是 `/sz/src`，**实测只有 140×140、7 KB**（对照 Steam 头图 460×215、47 KB）。
>    站点详情页实际用 `/sz/420`（实测 215×215，部分 420×420；`/sz/640|800|1080|0` 均回落 140×140）。
>    修法：取数时统一换 `/sz/420`。
>
> **v6 修掉的三个真实缺陷**：
> 1. **弹窗 hero 图片被裁**（用户截图「图片被截了」）—— v5 用 `.dtop{height:196px}` + `onload="fitTop(this)"`
>    读 `naturalWidth` 判比例。**缓存命中时 `onload` 可能早于节点入树**，`img.parentElement === null`
>    → `box.style.setProperty` 抛错 → `fitTop` **静默中断** → 容器退回 `cover` → 方形图被裁成一条横带。
>    修法：**彻底不用 JS 判比例**，改 CSS `width:100%;height:auto;max-height:min(50vh,420px);object-fit:contain`。
> 2. **弹窗内容太少**（用户「这点我需要你学习工作台的点击弹出的样式」）—— 按 `game-aggregator` 详情抽屉版式重做。
> 3. **卡片位置会抖**（用户「位置需要固定」）—— 手游卡改「整卡 96px + 逐行定高 + 右列定宽 76px 右对齐」。
>
> **★v7 修掉的一个真实缺陷（这轮最值得记的一条）**：
> **端游卡片图片「未适配、很奇怪」**（用户原话）。注意**这不是 bug、是取舍错**：
> v5–v6 给卡片加了「近方形 → `contain` + 同图模糊铺底」。v7 用真实浏览器实测证明
> **机制完全正常**（`--bgi` 设上了、`::before` 确实加载了原图做了模糊），
> 但 **16:9 卡位里方图经 `contain` 只占 `184/327 = 56%` 宽**，两侧是一条"脏色"模糊带 ——
> 一屏里一半满幅一半脏条，观感就是"没铺满 + 很奇怪"。
> **修法**：卡片改 **`cover` 满幅**（与 PC 工作台主列表卡 `.row-card .th img` 口径一致），
> 删掉整套按比例分叉机制。代价是方图纵向裁 43.7%，**已知并明说**。
>
> **★v7 的方法论教训（比上面那条更重要）**：
> **jsdom 不加载图片** —— `naturalWidth` 恒为 0、`onload` 永不触发。
> 所以 `_t_demo.js` 那 190 条断言**根本覆盖不到图片适配**，前两轮"全绿"给了假安全感。
> 是本轮摸到「沙箱内 Edge 起不来、但本机 Chrome 134 可用（须 `--headless` old）」之后，
> 才第一次**看见**真实渲染 —— 一截图问题立刻现形。
> ⇒ 已写进 SOP 红线 23：**图片/版式改动必须过真实浏览器截图，否则不许说"已修复"**。
>
> **v7 反证记录**：`_counterproof.py` 逐条打坏 6 处（`cover`→`contain` / 加回 `.fit-c` /
> 加回 `.blurbg::before`+`--bgi` / `onload` 改回 `fitImg` / 塞回 `fitImg` 函数 /
> `syncImgs` 不再覆盖 `.cv img`），**6 处全部变红**，每处还原后 **195/195 复绿**。
>
> **★v8 修掉的两个真实缺陷**：
> 1. **「图加载完了却一直透明」**（本轮最大的一条，靠 `SHOT_DIAG` 量化定位）——
>    `mEvent` 98 张图 `complete=true / naturalWidth=1080×608`，`opacity` 却**全是 0** ⇒ 截图整片空白。
>    根因：`.cv img{opacity:0}` + `.cv img.ready{opacity:1}` 依赖 `onload="reveal(this)"`，
>    而**图片命中缓存时 `load` 可能早于节点入树** ⇒ `reveal` 不执行 ⇒ `.ready` 永不加。
>    —— 这是 v5「缓存时序坑」的**变体**：只要让"可见性"依赖回调，就一定会漏。
>    修法：**可见性交给 CSS**（`img` 直接可见 + `z-index:1` 压住占位），`reveal()` 降级为纯优化动作。
> 2. **截图工具本身拍不到图** —— `chrome --screenshot --virtual-time-budget` 下，
>    DOM 早就 `opacity=1`，截图却是成片空白，**且空白位置每次随机**（同一页两次：前 8 张空 / 后 5 张空）。
>    根因：**虚拟时间预算不等图片解码与光栅化**。`--run-all-compositor-stages-before-draw`、
>    `--headless=new` 都治不了（都试过）。修法：改走 **CDP**，截图前 `await img.decode()`。
>    ⇒ 这条的教训是：**验收工具本身也需要被验收** —— 拿一个会撒谎的截图工具做验收，
>    会把「图片没问题」错判成「图片有问题」，白排查半天。
>
> **★v8 的一个需求设计缺陷（不是 bug，是取舍错）**：
> 初版排行榜做了「**评分榜**」，实测 `pcRank` 80 条 `scoreV` **全部 = 10.0**
> （上游 `games.json` 这一档取的就是满分游戏）⇒ 评分榜 = 12 条并列第一、零信息量。
> 换成「最新上架榜 / 热度榜 / 容量榜」。这是「不造数」原则的延伸：
> **也不摆没有区分度的榜**，并且要在页面 notice 里**明写为什么没有评分榜**（不许静默省略）。
>
> **★v8 的三条测试方法论教训**（都很容易让测试自欺）：
> 1. **测试崩溃 ≠ 断言红**。把目标元素打坏后测试若在
>    `$$('.rlist')[0].querySelectorAll(...)` 上抛错，整脚本终止、跑出 `通过 None/None`，
>    此时**完全看不出哪条断言没守住**，反证也无法判定。⇒ 元素查询一律返回空数组/`null`，
>    让断言精确报红（本轮因此加固了 6c 段）。
> 2. **空数组 `every()` 恒为真**。`rows.every(...)` 在 `rows` 为空时返回 `true` ——
>    「榜没了」反而判绿。⇒ 校验序列的断言必须先加 `length > 0 &&`。
> 3. **注释会污染正则断言**。v8 新增的说明注释里写了 `.cv img{opacity:0}`（解释旧做法为何错），
>    直接把「不得再用 opacity:0」这条断言判红。⇒ 加 `const code = html.replace(/\/\*[\s\S]*?\*\//g,'')`
>    （**剥注释版源码**），凡样式类正则断言都用 `code`。
>
> **v8 反证记录**：`_counterproof.py` 逐条打坏 **10 处**（`nameParts` 不拆英文 / 分榜只剩一个 /
> 状态后缀改回带日期 / `.mtop` 改 static / 去掉 `.mtime` / render 开头不停轮播 /
> 默认落地改回新游 / `.cv img` 改回 `opacity:0` / img 挂回 `loading="lazy"`），
> **10 处全部变红**，每处还原后 **298/298 复绿**。
> 其中 M4 换过两次打坏点才做到「变红而非崩溃」，过程已记在 `_counterproof.py` 注释里。
