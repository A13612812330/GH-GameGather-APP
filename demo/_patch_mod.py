# -*- coding: utf-8 -*-
"""
_patch_mod.py — ★v10 定向补丁：给 data.js 的 pcMod 补上「来源 / 原帖 / 游戏页」字段

为什么用补丁而不是重跑 _build_data.py：
  实测 `game-aggregator/data/` 下的 games.json / trainers.json / mobilehub.json
  **mtime = 2026-10-09 09:37**，晚于 data.js 快照（builtAt 2026-10-08 16:48）。
  重跑会连带刷新 pcNew/pcHot/mNew/mEvent/mPlay，**条数会漂**（现有 330 条断言全按
  当前条数写的），代价远大于收益。所以只补 pcMod 这一个数组。

补丁内容（逐条来自 mods.json，可验证）：
  postUrl  —— 机地原帖（mods.json 的 `url`，100% 是 jidiyouxi.com）
  libUrl   —— 匹配到的端游库页面（mods.json 的 `libUrl`，可能为空）
  libSrc   —— 'xd' | 'jidi' | ''（从 libUrl 域名推）
  src      —— '机地'（本 Tab 的真实来源，单一源）
  srcKey   —— 'jidi'（供卡片配色 SRC_CLS 使用）
外加 totals.modByKind / totals.modMatched（供页面「来源说明」引用，避免硬编码漂移）。

对齐方式：**按下标 zip**，不是按 title / url 匹配 ——
  因为多条 MOD 会指向同一游戏页（实测 4 条剑星 MOD 的 libUrl 完全相同），
  按 url 匹配会串号。这里用与 build_mod() **逐字一致**的筛选 + 稳定排序复现顺序，
  再逐下标断言 title 相同；只要 60 条 title 全对，映射就是被证明的。

用法：python _patch_mod.py            # 只做校验与预览（dry-run，不写文件）
      python _patch_mod.py --write    # 校验通过后写回 data.js
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODS = r"E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator\data\mods.json"
DATA_JS = os.path.join(HERE, "data.js")

PREFIX = "window.__DEMO_DATA__ = "
SUFFIX = ";\n"


def iint(v, d=0):
    """与 _build_data.py 的 iint 保持逐字一致（排序键必须同源）"""
    try:
        return int(float(v))
    except Exception:
        return d


def load_data_js():
    raw = io.open(DATA_JS, encoding="utf-8").read()
    assert raw.startswith(PREFIX), "data.js 前缀不是预期的 %r" % PREFIX
    assert raw.endswith(SUFFIX), "data.js 后缀不是预期的 %r" % SUFFIX
    return raw, json.loads(raw[len(PREFIX):-len(SUFFIX)])


def lib_src_of(u):
    if not u:
        return ""
    if "xdgame.com" in u:
        return "xd"
    if "jidiyouxi.com" in u:
        return "jidi"
    return ""


def main():
    write = "--write" in sys.argv
    raw, data = load_data_js()

    # --- 前置：证明 json 往返是「逐字节稳定」的 ---
    # 只有这样，写回后 data.js 与原文件的差异才**只可能**来自我们改的 pcMod / totals，
    # 不会因为序列化风格不同而整文件漂移。
    rt = PREFIX + json.dumps(data, ensure_ascii=False) + SUFFIX
    if rt != raw:
        print("!! json 往返后与原文件不一致（差 %d 字符）—— 序列化风格不同，不写文件"
              % abs(len(rt) - len(raw)))
        for i in range(min(len(rt), len(raw))):
            if rt[i] != raw[i]:
                print("   首个差异 @%d：原=%r 新=%r" % (i, raw[i:i + 60], rt[i:i + 60]))
                break
        sys.exit(3)
    print("前置校验：json 往返逐字节一致 ✓ （写回后差异只可能来自本次改动）")

    mods = json.load(io.open(MODS, encoding="utf-8"))
    items = mods["items"]

    # --- 复现 build_mod() 的池与排序（逐字一致）---
    pool = [x for x in items if x.get("cover")]
    pool.sort(key=lambda x: iint(x.get("pv")), reverse=True)
    top = pool[:60]

    cur = data["pcMod"]
    print("data.js pcMod 条数 = %d ；mods.json 复现 Top = %d" % (len(cur), len(top)))
    assert len(cur) == len(top), "条数不一致，中止"

    # --- 逐下标断言 title 相同（证明映射正确）---
    bad = []
    for i, (a, x) in enumerate(zip(cur, top)):
        t_snap = (a.get("title") or "").strip()
        t_src = (x.get("title") or "").strip()
        if t_snap != t_src:
            bad.append((i, t_snap, t_src))
    if bad:
        print("!! 有 %d 条 title 对不上，映射不可信 —— 不写文件" % len(bad))
        for i, a, b in bad[:8]:
            print("   #%d 快照=%r  源=%r" % (i, a, b))
        sys.exit(2)
    print("逐下标 title 校验：60/60 全部一致 ✓ （映射已证明）")

    # --- 补字段 ---
    changed = 0
    for a, x in zip(cur, top):
        post = (x.get("url") or "").strip()
        lib = (x.get("libUrl") or "").strip()
        ls = lib_src_of(lib)
        if a.get("postUrl") != post:
            a["postUrl"] = post
            changed += 1
        a["libUrl"] = lib
        a["libSrc"] = ls
        a["src"] = "机地"
        a["srcKey"] = "jidi"

    # --- totals 补来源构成 ---
    by_kind = {}
    for x in items:
        k = x.get("kind") or "mod"
        by_kind[k] = by_kind.get(k, 0) + 1
    matched = [x for x in items if x.get("libUrl")]
    matched_xd = sum(1 for x in matched if "xdgame.com" in x.get("libUrl", ""))
    matched_jd = sum(1 for x in matched if "jidiyouxi.com" in x.get("libUrl", ""))
    data["totals"]["modByKind"] = {"mod": by_kind.get("mod", 0), "modifier": by_kind.get("modifier", 0)}
    data["totals"]["modMatched"] = {
        "matched": len(matched),
        "rate": round(len(matched) * 100.0 / max(1, len(items)), 1),
        "xd": matched_xd,
        "jidi": matched_jd,
    }

    print("补齐字段 %d 条；totals.modByKind=%s totals.modMatched=%s"
          % (changed, data["totals"]["modByKind"], data["totals"]["modMatched"]))

    # --- 预览 ---
    print("\n--- 补丁后的前 4 条 ---")
    for a in cur[:4]:
        print("  src=%-4s postUrl=%s" % (a["src"], a["postUrl"]))
        print("        libSrc=%-5s libUrl=%s" % (a["libSrc"] or "(空)", a["libUrl"] or "(无)"))

    if not write:
        print("\n（dry-run，未写文件；确认无误后加 --write）")
        return

    out = PREFIX + json.dumps(data, ensure_ascii=False) + SUFFIX
    io.open(DATA_JS, "w", encoding="utf-8").write(out)
    print("\n已写回 data.js（%s B）" % format(len(out.encode("utf-8")), ","))

    # --- 写回后自检：除 pcMod/totals 外必须逐字节不变 ---
    _, chk = load_data_js()
    same_keys = [k for k in data if k not in ("pcMod", "totals")]
    diff = [k for k in same_keys if json.dumps(chk[k], ensure_ascii=False, sort_keys=True)
            != json.dumps(data[k], ensure_ascii=False, sort_keys=True)]
    print("写回后自检：非 pcMod/totals 的键发生变化的 = %s" % (diff or "无 ✓"))


if __name__ == "__main__":
    main()
