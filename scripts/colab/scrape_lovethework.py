"""lovethework.com の Cannes Lions 受賞一覧を決定的に取得する（Colab CPU ランタイム用）。

使い方（colab run 経由）:  scrape_lovethework.py <year> [entry_type_id ...]
  id 省略時は 1 から順に走査し、「最大の発見id より後に確定404/空が STOP_GAP 件連続」で止める（上限 MAX_SCAN_ID）。`n  存在しない=404か明示の空ページのみ。403/429/5xx/例外/見出し不明は fetchError として記録し、不在とは扱わない。

方式（ブラウザ不要・標準ライブラリのみ）:
  1. 結果表ページ  /en/awards/results/cannes-lions?year=<y>&entry_type_id=<id>
     サーバー描画済みの静的HTMLに、その部門の受賞作（GP/Gold/Silver/Bronze/特別賞）が
     サブカテゴリ見出しごとの表で全件入っている（Shortlist は別タブで HTML に含まれない）。
  2. 部門ページ  /en/awards/winners-shortlists/cannes-lions/<slug>?tag=publication+dates@@year@@<y>
     の見出し「Grand Prix (n) / Gold (n) / ...」の件数（静的HTMLに入っている）と、
     表の件数をレベルごとに照合する。
  部門ページはカードが24件で打ち止め（スクロール/Load more/XHR なし）のため件数照合専用。
結果は標準出力の JSON_BEGIN / JSON_END で囲んだブロックに出す（ローカル側ラッパーが抽出）。ログは標準エラー。
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

BASE = "https://www.lovethework.com"
JSON_BEGIN = "===JSON_BEGIN==="
JSON_END = "===JSON_END==="
WAIT_BETWEEN_REQUESTS = 2.5  # 秒（礼儀上 2 秒以上）
STOP_GAP = 40  # 最大の発見idの後、確定404/空が連続この数続くまで走査する
MAX_SCAN_ID = 400  # 暴走防止の絶対上限（到達したら capped として不完全扱い）
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


# ---------------------------------------------------------------- 純粋ロジック
def slugify(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    return re.sub(r"-+", "-", s)


def category_url(slug, year):
    return f"{BASE}/en/awards/winners-shortlists/cannes-lions/{slug}?tag=publication+dates@@year@@{year}"


def results_url(entry_type_id, year):
    return f"{BASE}/en/awards/results/cannes-lions?year={year}&entry_type_id={entry_type_id}"


def slug_candidates(h1_name):
    """結果表の見出し名（"Film Lions" など）から部門ページ slug の候補を作る。"""
    out = [slugify(h1_name)]
    stripped = re.sub(r"\s+Lions$", "", h1_name).strip()
    if stripped != h1_name:
        out.append(slugify(stripped))
    return out


def level_from_prize(prize):
    prize = (prize or "").strip()
    if not prize or prize.lower().startswith("shortlist"):
        return None
    level = re.sub(r"\s+Lions?$", "", re.sub(r"\s+Campaign$", "", prize)).strip()
    if level.startswith("Titanium"):
        return level
    # "Grand Prix for Good" / "Creative Effectiveness Grand Prix" など部門名つきの GP は見出し上 Grand Prix
    if level.startswith("Grand Prix") or level.endswith("Grand Prix"):
        return "Grand Prix"
    return level or None


_HEAD_RE = re.compile(r"^(.+?)\s*\((\d[\d,]*)\)$")


def parse_headings(texts):
    out = {}
    for t in texts:
        m = _HEAD_RE.match(t.strip())
        if not m:
            continue
        name = m.group(1).strip()
        if name.lower() in ("shortlists", "shortlist"):
            name = "Shortlist"
        out[name] = int(m.group(2).replace(",", ""))
    return out


_RSC_HEAD_RE = re.compile(r'\\"([^"\\]+)\\",\\" \(\\",(\d[\d,]*),\\"\)\\"')


def parse_headings_from_html(html):
    """部門ページの静的HTML（RSCペイロード）から見出し件数を取り出す。"""
    return parse_headings([f"{m.group(1)} ({m.group(2)})" for m in _RSC_HEAD_RE.finditer(html)])


class _ResultsParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.h1 = None
        self.h3 = None
        self.sec = ""
        self.tr = None
        self.td = None
        self.label = None
        self.in_label = False
        self.rows = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "h1":
            self.h1 = ""
        elif tag == "h3":
            self.h3 = ""
        elif tag == "tr":
            self.tr = {"sec": self.sec, "cells": [], "href": None}
        elif tag == "td" and self.tr is not None:
            self.td = ""
            self.label = ""
        elif tag == "a" and self.tr is not None and a.get("href") and not self.tr["href"]:
            self.tr["href"] = a["href"]
        elif tag == "span" and self.td is not None and a.get("data-testid") == "button-label":
            self.in_label = True

    def handle_endtag(self, tag):
        if tag == "h1" and self.h1 is not None:
            self.h1 = self.h1.strip() if self.h1 else self.h1
            if not hasattr(self, "h1_final"):
                self.h1_final = self.h1
            self.h1 = None
        elif tag == "h3" and self.h3 is not None:
            self.sec = re.sub(r"\s+", " ", self.h3).strip()
            self.h3 = None
        elif tag == "span" and self.in_label:
            self.in_label = False
        elif tag == "td" and self.td is not None:
            text = self.label.strip() or self.td
            self.tr["cells"].append(re.sub(r"\s+", " ", text).strip())
            self.td = None
            self.label = None
        elif tag == "tr" and self.tr is not None:
            if self.tr["cells"]:
                self.rows.append(self.tr)
            self.tr = None

    def handle_data(self, data):
        if self.h1 is not None:
            self.h1 += data
        if self.h3 is not None:
            self.h3 += data
        if self.td is not None:
            self.td += data
            if self.in_label:
                self.label += data


_YEAR_MARKER_RE = re.compile(r"CANNES LIONS\s+(\d{4})\s+RESULTS?\s+TABLE", re.I)
_NO_RESULTS_RE = re.compile(r"\bno\s+results?(\s+found)?\b", re.I)


def classify_results_response(status, body):
    """結果表ページの応答を found / absent / error に分類する。
    不在と確定できるのは 404 か、200 で明示の「No results」ページのみ。それ以外の失敗は error。"""
    if status == 404:
        return {"kind": "absent", "httpStatus": 404}
    if status is None:
        return {"kind": "error", "httpStatus": None, "error": (body or "unknown error")[:300]}
    if status != 200:
        return {"kind": "error", "httpStatus": status, "error": f"HTTP {status}"}
    parsed = parse_results_html(body)
    if parsed["category"] and not parsed["cards"] and parsed["noResults"]:
        return {"kind": "absent", "httpStatus": 200}
    if parsed["category"]:
        return {"kind": "found", "httpStatus": 200, "parsed": parsed}
    if parsed["noResults"] and not parsed["cards"]:
        return {"kind": "absent", "httpStatus": 200}
    return {"kind": "error", "httpStatus": 200, "error": "unrecognized page structure (no results-table h1)"}


def parse_results_html(html):
    """結果表ページ → {category, cards(受賞のみ), shortlistRows}。見出し行・Shortlist 行は除外。"""
    p = _ResultsParser()
    p.feed(html)
    h1 = getattr(p, "h1_final", None)
    category = None
    if h1:
        m = re.match(r"^(.*?)\s+Lions results table$", h1, flags=re.I)
        if m:
            category = m.group(1).strip()
    ym = _YEAR_MARKER_RE.search(re.sub(r"<[^>]+>", " ", html))
    year = int(ym.group(1)) if ym else None
    cards, shortlist_rows = [], 0
    for r in p.rows:
        cells = r["cells"]
        if len(cells) < 7 or cells[0] == "Title" or not r["href"]:
            continue
        level = level_from_prize(cells[5])
        if level is None:
            shortlist_rows += 1
            continue
        href = r["href"]
        cards.append({
            "level": level,
            "subcategory": r["sec"],
            "title": cells[0],
            "brand": cells[1],
            "product": cells[2],
            "agency": cells[3],
            "location": cells[4],
            "prize": cells[5],
            "award": cells[6],
            "entryUrl": href if href.startswith("http") else BASE + href,
        })
    return {"category": category, "cards": cards, "shortlistRows": shortlist_rows,
            "year": year, "noResults": bool(_NO_RESULTS_RE.search(html))}


def dedupe_cards(cards):
    seen, out = set(), []
    for c in cards:
        key = (c.get("entryUrl"), c.get("subcategory"), c.get("level"))
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def verify_counts(headings, cards):
    """受賞レベルごとに「見出し件数 == 取得件数」を照合する。Shortlist は参考値のみ。"""
    scraped = {}
    for c in cards:
        scraped[c["level"]] = scraped.get(c["level"], 0) + 1
    counts, mismatches = {}, []
    for level, n in headings.items():
        if level == "Shortlist":
            counts[level] = {"heading": n, "scraped": None}
            continue
        got = scraped.get(level, 0)
        counts[level] = {"heading": n, "scraped": got}
        if got != n:
            mismatches.append({"level": level, "heading": n, "scraped": got})
    if headings:
        for level, got in scraped.items():
            if level not in headings:
                counts[level] = {"heading": 0, "scraped": got}
                mismatches.append({"level": level, "heading": 0, "scraped": got})
    has_winner_heading = any(k != "Shortlist" for k in headings)
    return {
        "counts": counts,
        "mismatches": mismatches,
        "headingsMissing": not has_winner_heading,
        "complete": has_winner_heading and not mismatches,
    }


# ---------------------------------------------------------------- 取得
def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url):
    """(status, body)。HTTP エラーは (status, "")。500 は1回だけ再試行。"""
    for attempt in range(2):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt == 0:
                time.sleep(WAIT_BETWEEN_REQUESTS)
                continue
            return e.code, ""
        except Exception as e:  # noqa: BLE001
            if attempt == 0:
                time.sleep(WAIT_BETWEEN_REQUESTS)
                continue
            return None, f"{type(e).__name__}: {e}"
    return None, ""


def scrape_entry_type(entry_type_id, year):
    url = results_url(entry_type_id, year)
    status, body = fetch(url)
    res = {"entryTypeId": entry_type_id, "tableUrl": url, "httpStatus": status}
    cls = classify_results_response(status, body)
    if cls["kind"] == "absent":
        res["exists"] = False
        return res
    if cls["kind"] == "error":
        res["exists"] = None
        res["fetchError"] = {"httpStatus": cls["httpStatus"], "error": cls["error"]}
        return res
    parsed = cls["parsed"]
    if parsed["year"] is not None and parsed["year"] != int(year):
        res["exists"] = None
        res["fetchError"] = {"httpStatus": 200, "error": f"year mismatch: requested {year}, page says {parsed['year']}"}
        return res
    res["yearVerified"] = parsed["year"] is not None
    res["exists"] = True
    res["category"] = parsed["category"]
    res["cards"] = dedupe_cards(parsed["cards"])
    res["shortlistRows"] = parsed["shortlistRows"]
    # 見出し件数（部門ページ）。slug は結果表の見出し名から導く。
    headings, used_url = {}, None
    for slug in slug_candidates(parsed["category"]):
        time.sleep(WAIT_BETWEEN_REQUESTS)
        u = category_url(slug, year)
        st, html = fetch(u)
        if st == 200:
            h = parse_headings_from_html(html)
            if h:
                headings, used_url, res["slug"] = h, u, slug
                break
    res["sourceUrl"] = used_url or category_url(slug_candidates(parsed["category"])[0], year)
    res["headings"] = headings
    res.update(verify_counts(headings, res["cards"]))
    return res


def scan_one(eid, year):
    t0 = time.time()
    try:
        r = scrape_entry_type(eid, year)
    except Exception as e:  # noqa: BLE001 - 1件の失敗で全体を止めず記録して続行
        r = {"entryTypeId": eid, "tableUrl": results_url(eid, year), "exists": None,
             "fetchError": {"httpStatus": None, "error": f"{type(e).__name__}: {e}"[:300]}}
    r["elapsedSec"] = round(time.time() - t0, 1)
    log(f"[{eid}] {r.get('category')} exists={r.get('exists')} complete={r.get('complete')} "
        f"headings={r.get('headings')} cards={len(r.get('cards', []))} {r['elapsedSec']}s")
    return r


def scan_year(year, ids=None, stop_gap=STOP_GAP, max_id=MAX_SCAN_ID):
    """(results, scan)。ids 指定時はそのidだけ。省略時は 最大発見id + stop_gap 件連続の確定不在まで。"""
    results = []
    if ids:
        for i, eid in enumerate(ids):
            if i:
                time.sleep(WAIT_BETWEEN_REQUESTS)
            results.append(scan_one(eid, year))
        return results, {"explicit": True, "ids": list(ids), "scannedFrom": min(ids), "scannedTo": max(ids),
                         "stopGap": None, "maxFoundId": max([r["entryTypeId"] for r in results if r.get("exists")], default=None),
                         "capped": False}
    streak, max_found, eid, capped = 0, None, 0, False
    while True:
        eid += 1
        if eid > max_id:
            capped, eid = True, max_id
            break
        if eid > 1:
            time.sleep(WAIT_BETWEEN_REQUESTS)
        r = scan_one(eid, year)
        results.append(r)
        if r.get("exists"):
            max_found, streak = eid, 0
        elif r.get("exists") is False:
            streak += 1
        else:  # fetchError は不在の証拠にならない
            streak = 0
        if streak >= stop_gap:
            break
    return results, {"explicit": False, "scannedFrom": 1, "scannedTo": eid, "stopGap": stop_gap,
                     "maxFoundId": max_found, "capped": capped}


def main(argv):
    if not argv:
        print("usage: scrape_lovethework.py <year> [entry_type_id ...]", file=sys.stderr)
        return 2
    year = int(argv[0])
    ids = [int(x) for x in argv[1:]]
    results, scan = scan_year(year, ids or None)
    print(JSON_BEGIN)
    print(json.dumps({"year": year, "results": results, "scan": scan}, ensure_ascii=False))
    print(JSON_END)
    return 0

if __name__ == "__main__":
    rc = main(sys.argv[1:])
    if rc:  # 成功時に sys.exit(0) するとカーネル実行がエラー扱いになり得るため呼ばない
        sys.exit(rc)
