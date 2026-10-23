# -*- coding: utf-8 -*-
"""
游戏情报客户端 · demo 数据生成脚本  (v5)
把本机真实数据抽成 demo/data.js（window.__DEMO_DATA__），供 index.html 离线读取。

v5 变更（对应用户第 10 轮反馈）：
  1. 【手游新游来源白名单】只保留 TapTap + 好游快爆 + 小七（x7sy）三源。
     ★ 小七此前不在 demo 里：GameNews 侧它标了 monitorOnly，且 /api/articles 只回 301 条
       （库里实为 423 条），小七的 22 条根本没进快照。本版改为**直读 SQLite（只读）**，
       不再依赖 API 分页，从根上避免"分页只看第一页 ⇒ 系统性漏源"。
  2. 【同游戏合并】按归一化游戏名把同游戏的跨源记录聚成一条：多平台 → sources[] 多标签。
  3. 【补上线时间】抽 launchTs / launchText / status（已上线·定档·测试招募）+ 绿色时效副标题。
  4. 【补标签与热度】taptapTags / haoyouTags / x7Tags 合并去重；关注数 / 预约数取最大并标注口径。
  5. 【PC 封面修复】52jidi 的封面存的是 /sz/src（实测仅 140×140、7KB），
     详情页用的是 /sz/420（实测 215~256px）⇒ 统一换 /sz/420；并滤掉 Steam 默认分享图。

数据来源（全部为本机实盘，非编造）：
  - 手游三源 -> GameNews SQLite articles 表（只读，mode=ro）
  - PC 新游 / 热游 / 排行 -> game-aggregator data/games.json（xdgamer + jidi 游戏库）
  - PC 修改器 -> game-aggregator data/trainers.json
  - PC MOD  -> game-aggregator data/mods.json
  - 手游可玩端游 -> game-aggregator data/mobilehub.json
  - 端游可视报告 -> _gh_publish 归档目录（5 期）

注意：本脚本只读既有项目，不写任何既有项目。
"""
import json, os, re, ast, glob, datetime, sqlite3

BASE = r"E:\新建文件夹\WorkBuddy\2026-10-08-14-02-06"
DEMO = os.path.join(BASE, "demo")
TMP = os.path.join(BASE, "_demo_tmp")
AGG = r"E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator\data"
PAGES = r"E:\新建文件夹\WorkBuddy\_gh_publish"
GN_DATA = r"E:\新建文件夹\Codex-GPT\GameNews\data"
GN_DB = os.path.join(GN_DATA, "game-news-hub.sqlite")

# 来源键 -> 展示名（PC 侧）
SRC_TAG = {"xdgamer": "XD", "jidi": "机地", "steam": "STEAM"}
SRC_KEY = {"xdgamer": "xd", "jidi": "jidi", "steam": "steam"}

# ★ 手游新游来源白名单（用户指定：TapTap + 好游快爆 + 小七）
MOB_SRC = {
    "ref-taptap": ("TapTap", "taptap"),
    "ref-haoyou": ("好游快爆", "haoyou"),
    "ref-x7":     ("小七", "x7"),
}
# 类目优先级（合并同游戏时取最高优先级的类目）
CAT_RANK = {"新游上线": 0, "测试公测": 1, "联动活动": 2, "活动": 3, "版本更新": 4}
NEW_CATS = {"新游上线", "测试公测"}
EVENT_CATS = {"版本更新", "联动活动", "活动"}

# Steam 默认分享图（不是游戏封面，拿到会显示成一张通用图）
BAD_IMG = re.compile(r"steam_share_image|/public/shared/images/", re.I)


# ------------------------------------------------------------------ 小工具
def plist(s):
    """mobilehub.json / facts 里部分是「字符串化的 python list」"""
    if not s or s in ("[]", ""):
        return []
    if isinstance(s, (list, tuple)):
        return list(s)
    try:
        v = ast.literal_eval(s)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def iint(v, d=0):
    try:
        return int(float(v))
    except Exception:
        return d


def fnum(v, d=0.0):
    try:
        return float(v)
    except Exception:
        return d


def jload(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fix_cover(u):
    """52jidi 封面：/sz/src 实测只有 140×140 ⇒ 换成详情页在用的 /sz/420（215~256px）"""
    if not u:
        return ""
    if BAD_IMG.search(u):
        return ""                     # Steam 默认分享图 → 视为无封面，走占位
    # ★v13 修：原正则写的是 \d{4,}（只认 4 位以上），**漏了 3 位尺寸** ——
    #   2026-10-15 重跑数据时出现 /sz/360（红色警戒2），断言因此变红。
    #   ⇒ 改为 \d+，把所有数字尺寸统一归一到 /sz/420。/sz/420 自身幂等，重复替换无副作用。
    return re.sub(r"/sz/(?:src|0|\d+)$", "/sz/420", u)


def ts_date(v):
    """毫秒时间戳 -> 'YYYY-MM-DD'；0/异常返回 ''"""
    n = iint(v)
    if not n:
        return ""
    try:
        return datetime.datetime.fromtimestamp(n / 1000).strftime("%Y-%m-%d")
    except Exception:
        return ""


def appid_of(a):
    """Steam appid：优先记录字段，其次从封面 URL 的 /steam/apps/<id>/ 里抠"""
    v = iint(a.get("appid"))
    if v:
        return v
    m = re.search(r"/steam/apps/(\d+)", a.get("cover") or "")
    return iint(m.group(1)) if m else 0


def size_gb(s):
    """'1GB' / '0.5GB' / '30 GB' -> 数值 GB；解析不到返回 -1"""
    if not s:
        return -1.0
    m = re.search(r"([\d.]+)\s*GB", str(s), re.I)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            return -1.0
    m = re.search(r"([\d.]+)\s*MB", str(s), re.I)
    if m:
        try:
            return round(float(m.group(1)) / 1024, 2)
        except Exception:
            return -1.0
    return -1.0


def _facts(x):
    f = x.get("facts")
    if isinstance(f, dict):
        return f
    if isinstance(f, str) and f.strip():
        try:
            v = json.loads(f)
            return v if isinstance(v, dict) else {}
        except Exception:
            return {}
    return {}


# ---------------------------------------------------------------- PC 侧
def build_pc():
    raw = jload(os.path.join(AGG, "games.json"))
    # ★ 封面用 fix_cover 清洗（52jidi 小图升级 + 过滤 Steam 默认分享图）
    pool = [a for a in raw if a.get("title") and fix_cover(a.get("cover"))]

    def card(a):
        g = a.get("genres") or []
        if isinstance(g, str):
            try:
                g = json.loads(g.replace("'", '"'))
            except Exception:
                g = [g]
        src = a.get("source") or "?"
        dt = a.get("dateLabel") or ""
        return {
            "title": (a.get("title") or "").strip(),
            "cover": fix_cover(a.get("cover")),
            "genre": (g[0] if g else "未分类"),
            "genres": [str(x) for x in (g or [])][:6],
            "score": a.get("score") or "",
            "scoreV": fnum(a.get("score")),
            "size": a.get("size") or "",
            "sizeGB": size_gb(a.get("size")),
            "date": dt,
            "ts": dt,
            "src": SRC_TAG.get(src, src),
            "srcKey": SRC_KEY.get(src, "other"),
            "hot": iint(a.get("hot")),
            "url": a.get("url") or "",
            "alt": a.get("jidiUrl") or "",
            "kindTxt": "PC 端游",
            "intro": "",
            # ★ v6：弹窗字段补全（全部来自原项目 games.json 的既有字段，非新增抓取）
            "recId": a.get("id") or "",                       # 库内记录 ID，如 xd-13594
            "appid": appid_of(a),                             # Steam appid（可拼商店直链）
            "jidiId": a.get("jidiId") or "",                  # 跨源机地 ID
            "jidiUrl": a.get("jidiUrl") or "",                # 跨源机地详情页
            "srcRaw": src,                                    # 原始来源键 xdgamer / jidi
            "published": ts_date(a.get("publishTs")),         # 源发布时间
            "updated": ts_date(a.get("updatedTs")),           # 源更新时间
            "hasHot": 1 if iint(a.get("hot")) else 0,
        }

    hot = [card(a) for a in sorted([x for x in pool if iint(x.get("hot")) > 0],
                                   key=lambda x: -iint(x.get("hot")))[:60]]

    today = datetime.date(2026, 10, 8)
    lim = (today - datetime.timedelta(days=180)).isoformat()
    recent = [card(a) for a in sorted(
        [x for x in pool if x.get("dateLabel") and lim <= x["dateLabel"] <= today.isoformat()],
        key=lambda x: x["dateLabel"], reverse=True)[:60]]

    top = [card(a) for a in sorted([x for x in pool if fnum(x.get("score")) > 0],
                                   key=lambda x: -fnum(x.get("score")))[:80]]
    return recent, hot, top


# ---------------------------------------------------------------- 手游侧
def _gn_rows():
    """只读打开 GameNews SQLite（不写、不加锁）"""
    if not os.path.exists(GN_DB):
        return []
    con = sqlite3.connect("file:%s?mode=ro" % GN_DB.replace("\\", "/"), uri=True)
    try:
        cols = ("source_id,source_name,title,game_name,category,detail_url,image_url,"
                "date_text,score,facts,quality,discovered_at")
        return list(con.execute(
            "select %s from articles where source_id in ('ref-taptap','ref-haoyou','ref-x7')" % cols))
    finally:
        con.close()


def _launch_ts(facts, src_key):
    """上线时间（统一成毫秒）"""
    if src_key == "x7":
        return iint(facts.get("x7LaunchTime"))
    if src_key == "taptap":
        t = iint(facts.get("taptapUpcomingStartTime"))
        if t:
            return t * 1000 if t < 1e11 else t      # 秒 -> 毫秒
        t = iint(facts.get("releaseTime"))
        return t * 1000 if t and t < 1e11 else t
    return 0


def _launch_text(ts_ms):
    if not ts_ms:
        return ""
    try:
        d = datetime.datetime.fromtimestamp(ts_ms / 1000)
        return "%d月%d日 %02d:%02d" % (d.month, d.day, d.hour, d.minute)
    except Exception:
        return ""


def _timeline_date(facts):
    """★v6 新增：好游快爆时间轴日期（'10月08日' / '10月1日' -> '10月8日'）。

    为什么补这条：好游快爆的「即将上线 / 已上线」日期只存在 facts.timelineDate 里，
    此前只抽 x7LaunchTime / taptapUpcomingStartTime / releaseTime ⇒ 好游独家的记录
    （如「多可比世界」「心动陷阱」）launchTs=0、绿色时效行只能靠兜底文案。
    这里**只输出文本、不推算年份**——'10月08日'没有年份，硬编年份会造出假时间戳。
    """
    t = (facts.get("timelineDate") or "").strip()
    if not t:
        return ""
    m = re.match(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日", t)
    if m:
        return "%d月%d日" % (int(m.group(1)), int(m.group(2)))
    return t[:12]


def _status_of(cat, ts_ms, facts, now):
    """状态短词：已上线 / 定档 / 测试招募 / 预约中

    ★v6：优先采信好游快爆时间轴的「即将上线 / 已上线」标签 —— 它是源站自己给的结论，
    比按时间戳猜更准；且能覆盖 launchTs=0 的好游独家记录。
    """
    tab = str(facts.get("haoyouTimelineTab") or "")
    if tab:
        if "已上线" in tab or "已开服" in tab:
            return "已上线"
        if "即将" in tab or "定档" in tab:
            return "定档"
    if cat == "测试公测":
        return "测试招募"
    if ts_ms:
        return "已上线" if ts_ms / 1000 <= now else "定档"
    return "预约中"


def _note_of(facts, src_key):
    """绿色时效副标题：优先 TapTap 候选摘要，其次好游快爆简介标题，再小七上线状态"""
    for k in ("taptapCandidateSummary", "haoyouIntroTitle"):
        v = (facts.get(k) or "").strip()
        if v:
            return v[:60]
    v = (facts.get(k) for k in ("x7LaunchStatus",))
    for x in v:
        if x:
            return str(x)[:60]
    return ""


def _hot_of(facts, src_key):
    """热度 = 关注 / 预约数 / 评论数；返回 (数值, 口径文案)"""
    cands = []
    if facts.get("taptapFollowerCount"):
        cands.append((iint(facts["taptapFollowerCount"]), "TapTap 关注"))
    if facts.get("taptapReserveCount"):
        cands.append((iint(facts["taptapReserveCount"]), "TapTap 预约"))
    if facts.get("haoyouReserveCount"):
        cands.append((iint(facts["haoyouReserveCount"]), "好游快爆预约"))
    if facts.get("x7ReserveCount"):
        cands.append((iint(facts["x7ReserveCount"]), "小七预约"))
    if facts.get("taptapReviewCount"):
        cands.append((iint(facts["taptapReviewCount"]), "TapTap 评论"))
    if not cands:
        return 0, ""
    v, lb = max(cands, key=lambda x: x[0])
    return v, lb


# ★ 上游脏标签过滤：好游快爆的 haoyouTags 偶发把「猜你喜欢/推荐位」文案整段抓进来，
#   形如 '宝可梦：羁绊之旅-玩家自制 8.7分 25981热度'（实测 3 条）。真标签都很短且无空格。
_TAG_BAD = re.compile(r"\s|[\d.]+\s*(?:分|万|热度|下载|预约|人)|\d{3,}")


def _tag_clean(t):
    t = str(t or "").strip()
    if not t or len(t) > 14:
        return ""
    if _TAG_BAD.search(t):
        return ""
    return t


def _tags_of(facts, extra=None):
    out, seen = [], set()
    for k in ("taptapTags", "haoyouTags", "x7Tags"):
        for t in plist(facts.get(k)):
            t = _tag_clean(t)
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    for t in (extra or []):
        t = _tag_clean(t)
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def _gkey(name):
    """合并键：去掉书名号 / 空格 / 全角空格，统一小写"""
    return re.sub(r"[《》〈〉\s\u3000·]+", "", str(name or "")).lower()


def build_mobile():
    """★ 手游新游：三源白名单 + 同游戏合并（用户第 10 轮需求）"""
    rows = _gn_rows()
    now = datetime.datetime.now().timestamp()

    recs, events = [], []
    for (sid, sname, title, game, cat, url, img, date_text, score, facts, quality, disc) in rows:
        if sid not in MOB_SRC:
            continue
        disp, key = MOB_SRC[sid]
        f = _facts(facts) if not isinstance(facts, str) else (json.loads(facts) if facts.strip().startswith("{") else {})
        ts_ms = _launch_ts(f, key)
        hot, hotlb = _hot_of(f, key)
        item = {
            "game": (game or "").strip(),
            "title": (title or "").strip(),
            "cat": cat or "未分类",
            "src": disp, "srcKey": key,
            "url": url or "",
            "img": fix_cover(img or ""),
            "dateText": (date_text or "")[:34],
            "ts": disc or "",
            "score": fnum(f.get("score")) or 0,
            "launchTs": ts_ms,
            "launchText": _launch_text(ts_ms),
            "status": _status_of(cat, ts_ms, f, now),
            "note": _note_of(f, key),
            "tags": _tags_of(f),
            "hot": hot, "hotLabel": hotlb,
            "intro": (f.get("haoyouIntro") or f.get("taptapCandidateSummary") or "")[:220],
            "quality": quality or "",
            # ★v6：好游快爆独家字段（此前漏抽 ⇒ 好游独家记录的时效行/状态只能吃兜底文案）
            "tlDate": _timeline_date(f),
            "tlTab": str(f.get("haoyouTimelineTab") or ""),
            "publisher": str(f.get("haoyouPublisher") or "").strip(),
            "kindRaw": str(f.get("haoyouKind") or ""),
        }
        if cat in NEW_CATS:
            recs.append(item)
        if cat in EVENT_CATS or re.search(r"活动|联动|版本|更新|限时|开启|公测|预约|首曝|庆典|节日|赛季", title or ""):
            it2 = dict(item)
            it2["inCat"] = cat in EVENT_CATS
            events.append(it2)

    # ---------- 同游戏合并 ----------
    groups = {}
    for r in recs:
        k = _gkey(r["game"]) or _gkey(r["title"])
        groups.setdefault(k, []).append(r)

    merged = []
    for k, arr in groups.items():
        arr.sort(key=lambda x: (CAT_RANK.get(x["cat"], 9), x["srcKey"]))
        head = arr[0]
        # 来源去重（多平台 -> 多个标签）
        srcs, seen_s = [], set()
        for x in arr:
            if x["srcKey"] not in seen_s:
                seen_s.add(x["srcKey"])
                srcs.append({"src": x["src"], "key": x["srcKey"], "url": x["url"]})
        # 取最"新"的上线时间（未来最近的那个）与最大热度
        tss = [x["launchTs"] for x in arr if x["launchTs"]]
        launch_ts = min(tss) if tss else 0
        if not launch_ts:
            launch_ts = max(tss) if tss else 0
        tags, seen_t = [], set()
        for x in arr:
            for t in x["tags"]:
                if t.lower() not in seen_t:
                    seen_t.add(t.lower())
                    tags.append(t)
        hot_i = max(arr, key=lambda x: x["hot"])
        note = next((x["note"] for x in arr if x["note"]), "")
        score = max((x["score"] for x in arr), default=0)
        img = next((x["img"] for x in arr if x["img"]), "")
        intro = next((x["intro"] for x in arr if x["intro"]), "")
        st = head["status"]
        if any(x["status"] == "已上线" for x in arr):
            st = "已上线"
        # ★v6：好游时间轴日期 —— 只在 launchTs 缺位时充当「上线时间」文本（不伪造时间戳）
        tl = next((x["tlDate"] for x in arr if x["tlDate"]), "")
        pub = next((x["publisher"] for x in arr if x["publisher"]), "")
        lt_txt = _launch_text(launch_ts) or tl
        # ★v13 修：links 原为「每条原始记录一个」，但同游戏**同源可能有多条资讯**
        #   ⇒ 会出现「弹窗按钮数 3 ≠ 来源数 2」（断言 682 行因此变红）。
        #   这里按 srcKey 去重（保留首次出现），与 sources 的口径对齐；
        #   原始条数信息仍由 `n = len(arr)` 保留，不丢。
        _lk_seen, lks = set(), []
        for _x in arr:
            if _x["srcKey"] in _lk_seen:
                continue
            _lk_seen.add(_x["srcKey"])
            lks.append({"src": _x["src"], "key": _x["srcKey"], "url": _x["url"], "title": _x["title"]})
        # ★ 绿色时效副标题兜底：原文没给描述时，用上线时间拼，保证每张卡都有这一行
        if not note:
            if lt_txt:
                note = ("%s 上线" % lt_txt) if st != "已上线" else ("%s 已开服" % lt_txt)
            else:
                note = {"测试招募": "测试资格招募中", "预约中": "开放预约中"}.get(st, "")
        # ★ 第一行后缀：状态 + 上线日期（如「定档 10/11」）
        suffix = st
        if launch_ts:
            d0 = datetime.datetime.fromtimestamp(launch_ts / 1000)
            suffix = ("%s %d/%d" % (st, d0.month, d0.day)) if st != "已上线" else st
        merged.append({
            "game": head["game"] or head["title"],
            "key": k,
            "cat": head["cat"],
            "catKey": "new" if head["cat"] == "新游上线" else "beta",
            "img": img,
            "sources": srcs,
            "srcKeys": [s["key"] for s in srcs],      # 多平台筛选用
            "src": srcs[0]["src"], "srcKey": srcs[0]["key"],     # 兼容旧字段
            "tags": tags[:6],
            "launchTs": launch_ts,
            "launchText": _launch_text(launch_ts),
            "tlDate": tl,
            "publisher": pub,
            "status": st,
            "suffix": suffix,
            "note": note,
            "score": score,
            "hot": hot_i["hot"], "hotLabel": hot_i["hotLabel"],
            "intro": intro,
            "url": head["url"],
            "ts": max((x["ts"] for x in arr), default=""),
            "n": len(arr),
            "links": lks,
        })
        merged[-1]["scoreV"] = score
        merged[-1]["hotV"] = hot_i["hot"]

    # 默认排序：资讯最新优先（前端会按所选的排序键重排）
    merged.sort(key=lambda x: x["ts"], reverse=True)

    # 活动：不合并（每个活动是独立事件）
    ev = []
    seen_ev = set()
    for e in events:
        kk = (e["srcKey"], e["url"] or e["title"])
        if kk in seen_ev:
            continue
        seen_ev.add(kk)
        ev.append(e)
    ev.sort(key=lambda x: (not x.get("inCat"), x["ts"]), reverse=False)
    ev.sort(key=lambda x: x["ts"], reverse=True)
    ev.sort(key=lambda x: not x.get("inCat"))

    return {
        "news": merged,
        "events": ev,
        "stats": {
            "total": len(rows),
            "merged": len(merged),
            "rawNew": len(recs),
            "srcs": {disp: sum(1 for r in rows if MOB_SRC.get(r[0], ("?",))[0] == disp) for disp, _ in MOB_SRC.values()},
            "srcIds": {sid: sum(1 for r in rows if r[0] == sid) for sid in MOB_SRC},
            "multi": sum(1 for x in merged if len(x["sources"]) > 1),
            "whitelist": [MOB_SRC[s][0] for s in ("ref-taptap", "ref-haoyou", "ref-x7")],
        },
    }


def _lib_short(t):
    if not t:
        return ""
    return re.split(r"[/、]", str(t))[0].strip()


def build_trainer():
    """PC 修改器 —— 来源 trainers.json（3,660 条，5 个来源）

    ★取样策略：按来源轮询（round-robin），而不是全局按版本号排序。
    原因（测试实测暴露）：全局 version 倒序时，前 60 条只出现「社区贡献 + GCM 精选」两个来源，
    数量第二多、业界最常被引用的「风灵月影」一条都进不来 —— 多源产品不该被单一来源淹没。
    """
    d = jload(os.path.join(AGG, "trainers.json"))
    label = {x["key"]: x.get("label") or x["key"] for x in (d["stats"].get("sources") or [])}
    pool = [x for x in d["items"] if x.get("libCover")]

    groups = {}
    for x in pool:
        groups.setdefault(x.get("source") or "other", []).append(x)
    for g in groups.values():
        g.sort(key=lambda x: (x.get("version") or ""), reverse=True)

    order = sorted(groups.keys(), key=lambda k: -len(groups[k]))
    out, idx = [], 0
    while len(out) < 60:
        added = False
        for k in order:
            if idx < len(groups[k]):
                out.append(groups[k][idx]); added = True
                if len(out) >= 60:
                    break
        if not added:
            break
        idx += 1

    items = []
    for x in out:
        items.append({
            "title": (x.get("zh") or x.get("name") or "").strip(),
            "en": (x.get("name") or "").strip(),
            "cover": fix_cover(x.get("libCover") or ""),
            "version": x.get("version") or "",
            "src": label.get(x.get("source"), x.get("source") or ""),
            "srcKey": x.get("source") or "other",
            "url": x.get("libUrl") or "",
            "steamId": x.get("steamId") or "",
            "ts": x.get("version") or "",
            "kindTxt": "PC 修改器",
            "intro": "",
        })
    return items, len(d["items"]), len(pool)


def _lib_src_of(u):
    """libUrl 的归属源：xdgame → XD，jidiyouxi → 机地。空串表示未匹配到库条目。"""
    if not u:
        return ""
    if "xdgame.com" in u:
        return "xd"
    if "jidiyouxi.com" in u:
        return "jidi"
    return ""


def build_mod():
    """PC MOD —— 来源 mods.json（8,943 条，**机地单一源**）

    ★v10 三点修正（都是实测出来的，别再退回去）：
      ① **本 Tab 只取 kind='mod'**。mods.json 是「MOD(7,825) + 修改器(1,118)」的合集，
         原先不过滤就按 pv 取 Top60 —— 结果 60 条恰好全是 MOD（修改器最高 pv 仅 3,409），
         于是筛选器里那个「修改器」选项**点一下必然为空**。Tab 名就叫 MOD，池子就该是 MOD，
         修改器另有独立 Tab（pcTrainer，来源 trainers.json）。
      ② **补 src/srcKey**。原实现没写来源，卡片左上角只能拿 kind 顶上 ⇒ 60 张卡全是「MOD」
         （MOD 是**类型**不是**来源**），页面上根本看不出数据来自哪。真实来源 = 机地。
      ③ **`url` 拆成 postUrl / libUrl**。原实现写 `url = libUrl or url`，把「机地原帖」
         覆盖成了「匹配到的端游库页面」⇒ 弹窗上「打开原帖」实际打开的是 XD 的游戏页。
         现在两个都留，弹窗分别给出。
    """
    d = jload(os.path.join(AGG, "mods.json"))
    all_items = d["items"]

    # ① 只取 MOD
    pool = [x for x in all_items if x.get("cover") and (x.get("kind") or "mod") == "mod"]
    pool.sort(key=lambda x: iint(x.get("pv")), reverse=True)
    out = []
    for x in pool[:60]:
        lib = (x.get("libUrl") or "").strip()
        out.append({
            "title": (x.get("title") or "").strip(),
            "game": _lib_short(x.get("game") or x.get("libTitle") or ""),
            "cover": fix_cover(x.get("cover") or ""),
            "author": (x.get("author") or "").strip(),
            "pv": iint(x.get("pv")),
            "kind": "MOD",
            "kindKey": "mod",
            # ③ 原帖（机地）与匹配到的库页面分开存
            "postUrl": (x.get("url") or "").strip(),
            "libUrl": lib,
            "libSrc": _lib_src_of(lib),
            # ② 来源
            "src": "机地",
            "srcKey": "jidi",
            "url": lib or (x.get("url") or ""),      # 兼容旧字段，勿删
            "nlink": len(plist(x.get("links"))),
            "kindTxt": "PC MOD",
            "intro": "",
        })

    by_kind = {"mod": 0, "modifier": 0}
    for x in all_items:
        k = x.get("kind") or "mod"
        by_kind[k] = by_kind.get(k, 0) + 1
    matched = [x for x in all_items if x.get("libUrl")]
    matched_info = {
        "matched": len(matched),
        "rate": round(len(matched) * 100.0 / max(1, len(all_items)), 1),
        "xd": sum(1 for x in matched if "xdgame.com" in x.get("libUrl", "")),
        "jidi": sum(1 for x in matched if "jidiyouxi.com" in x.get("libUrl", "")),
    }
    return out, len(all_items), by_kind, matched_info


def build_playable():
    """手游可玩端游 —— 来源 mobilehub.json（3,264 条，模拟器可玩性数据）"""
    d = jload(os.path.join(AGG, "mobilehub.json"))
    pool = [x for x in d["items"] if x.get("libCover")]
    pool.sort(key=lambda x: (0 if x.get("tier") else 1, -iint(x.get("configs"))))
    out = []
    for x in pool[:60]:
        alt = plist(x.get("alt"))
        out.append({
            "title": (x.get("name") or "").strip(),
            "full": _lib_short(x.get("libTitle") or ""),
            "alias": alt[0] if alt else "",
            "cover": fix_cover(x.get("libCover") or ""),
            "tier": x.get("tier") or "",
            "tierKey": "ok" if x.get("tier") else "pending",
            "fps": x.get("bestLabel") or "",
            "configs": iint(x.get("configs")),
            "devices": len(plist(x.get("devices"))),
            "chip": (plist(x.get("chips")) or [""])[0],
            "url": x.get("libUrl") or "",
            "kindTxt": "手游可玩端游",
            "intro": "",
        })
    st = d.get("stats") or {}
    return out, len(d["items"]), st


# (日期, 类型, 说明, 线上是否可打开)
# ★ online 实测：2026-08-25 期线上返回 404（该期只有 xlsx，历代无看板 HTML）
ISSUES = [
    ("2026-09-28", "周报 · 大报告", "跨期对比本期 vs 上期 8.31-9.13；热点固定 12 条（末两条为版号重点、端游转手游独立游戏候选）、Steam 真实主视觉、品类环形图、三源重点表", True),
    ("2026-09-14", "周报 · 大报告", "133 款端游 / 162.5 万次搜索、409 款鲸云下载、58 款 Steam，联网采集热点与总结", True),
    ("2026-08-31", "周报", "搜索源 + 鲸云下载源 + Steam 源 + 三源关联重点表，附可视化看板", True),
    ("2026-08-26", "可视化", "首次产出可视化看板，并导出 4 张源表 CSV + 全量 JSON", True),
    ("2026-08-25", "数据基础", "端游关键词三级匹配清洗、鲸云平台表现、Steam 近一年 60 款、三源关联重点表 v4（该期交付为 xlsx 数据表，无看板 HTML）", False),
]


def build_report():
    out = []
    for date, kind, note, online in ISSUES:
        d = os.path.join(PAGES, date)
        board = None
        xlsx = []
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith(".html") and "看板" in f:
                    board = f
                elif f.lower().endswith((".xlsx", ".xls", ".csv")):
                    xlsx.append(f)
        out.append({
            "date": date, "kind": kind, "note": note,
            "board": board,
            "xlsx": len(xlsx),
            "online": online,
            "short": "https://a13612812330.github.io/endgame-weekly-report/%s/" % date,
        })
    return {
        "issues": out,
        "latest": "https://a13612812330.github.io/endgame-weekly-report/latest/",
        "repo": "https://github.com/A13612812330/endgame-weekly-report",
        "onlineCount": sum(1 for x in out if x["online"]),
    }


def main():
    pc_new, pc_hot, pc_rank = build_pc()
    mob = build_mobile()
    rep = build_report()
    trainer, trainer_total, trainer_withcover = build_trainer()
    mods, mod_total, mod_by_kind, mod_matched = build_mod()
    play, play_total, play_stats = build_playable()

    data = {
        "meta": {
            "builtAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "note": "demo 数据快照：来自本机真实数据源，非编造",
            "imgNote": "图片比例不在后端猜测，由前端读原图 naturalWidth/Height 自适应",
            "mobWhitelist": ["TapTap", "好游快爆", "小七"],
        },
        "pcNew": pc_new,
        "pcHot": pc_hot,
        "pcRank": pc_rank,
        "pcTrainer": trainer,
        "pcMod": mods,
        "mNew": mob["news"],
        "mEvent": mob["events"],
        "mPlay": play,
        "mStats": mob["stats"],
        "totals": {
            "pcLib": 19239, "trainer": trainer_total, "trainerCover": trainer_withcover,
            "mod": mod_total, "play": play_total,
            "modByKind": mod_by_kind, "modMatched": mod_matched,
            "playStats": {k: play_stats.get(k) for k in ("configs", "records", "playable", "pcGames", "matchedRate")},
        },
        "report": rep,
    }

    os.makedirs(DEMO, exist_ok=True)
    p = os.path.join(DEMO, "data.js")
    with open(p, "w", encoding="utf-8") as f:
        f.write("window.__DEMO_DATA__ = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")

    print("== 生成完成 ==")
    print("  pcNew=%d  pcHot=%d  pcRank=%d" % (len(pc_new), len(pc_hot), len(pc_rank)))
    print("  pcTrainer=%d (总 %d，有封面 %d)" % (len(trainer), trainer_total, trainer_withcover))
    print("  pcMod=%d (总 %d，MOD %d / 修改器 %d；匹配库 %d 条 %.1f%%)"
          % (len(mods), mod_total, mod_by_kind.get("mod", 0), mod_by_kind.get("modifier", 0),
             mod_matched["matched"], mod_matched["rate"]))
    print("  mNew=%d（原始 %d 条 -> 合并 %d 个游戏，其中多平台 %d 个）"
          % (len(mob["news"]), mob["stats"]["rawNew"], mob["stats"]["merged"], mob["stats"]["multi"]))
    print("  mEvent=%d  mPlay=%d (总 %d)" % (len(mob["events"]), len(play), play_total))
    print("  三源条数: %s" % mob["stats"]["srcIds"])
    print("  report issues=%d 线上可开=%d" % (len(rep["issues"]), rep["onlineCount"]))
    print("  -> %s  (%s B)" % (p, format(os.path.getsize(p), ",")))


if __name__ == "__main__":
    main()
