"""scrape_lovethework.py の純粋ロジック（結果表HTMLの解釈・見出し件数の解釈・件数照合）のテスト。
実行: python -I -m unittest discover -s scripts/colab -p "test_*.py"
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_lovethework as s  # noqa: E402


def row(title_href, title, brand, product, agency, loc, prize):
    href, = (title_href,)
    return (
        '<tr><td variant="link"><div><a data-testid="button" href="%s"><div><div>'
        '<div data-testid="icon-ChevronRight"><p>ChevronRight</p></div>'
        '<span data-testid="button-label">%s</span></div></div></a></div></td>'
        '<td variant="label"><div><p>%s</p></div></td>'
        '<td variant="label"><div><p>%s</p></div></td>'
        '<td variant="label"><div><p>%s</p></div></td>'
        '<td variant="label"><div><p>%s</p></div></td>'
        '<td variant="label"><div><p>%s</p></div></td>'
        '<td variant="label"><div><p>%s</p></div></td></tr>'
        % (href, title, brand, product, agency, loc, prize, prize)
    )


THEAD = (
    "<table><thead><tr>"
    + "".join("<td><div><p>%s</p></div></td>" % h for h in
              ["Title", "Brand", "Product/Service", "Entrant/ Idea Creation", "Location", "Prize", "Award"])
    + "</tr></thead><tbody>"
)

RESULTS_HTML = (
    "<html><body><p>CANNES LIONS 2025 RESULT TABLE</p>"
    "<h1>Brand Experience &amp; Activation Lions results table</h1>"
    '<div role="tablist"><div role="tab"><p>Winners</p></div><div role="tab"><p>Shortlists</p></div></div>'
    "<h3>A01 - CONSUMER GOODS</h3>" + THEAD
    + row("/work/entries/other-hand-746730", "OTHER HAND", "CHEETOS | PEPSICO", "CHEETOS",
          "GOODBY SILVERSTEIN &amp; PARTNERS, San Francisco", "United States", "Bronze Lion")
    + row("/work/entries/drops-of-hope-746643", "DROPS OF HOPE", "KIMBERLY-CLARK", "POISE",
          "FCB NEW YORK, New York", "United States", "Gold Lion")
    + "</tbody></table>"
    "<h3>A02 - HEALTHCARE</h3>" + THEAD
    + row("/work/entries/x-1", "GP ENTRY", "BRAND", "PROD", "AGENCY, Paris", "France", "Grand Prix")
    + row("/work/entries/x-2", "SHORT ENTRY", "BRAND", "PROD", "AGENCY, Paris", "France", "Shortlist")
    + "</tbody></table></body></html>"
)

CATEGORY_PAGE_SNIPPET = (
    r'..."children":[["$","div","grand prix",{"children":[["$","p",null,{"children":[\"Grand Prix\",\" (\",1,\")\"]}]]}],'
    r'["$","div","gold",{"children":[["$","p",null,{"children":[\"Gold\",\" (\",3,\")\"]}]]}],'
    r'["$","p",null,{"children":[\"Shortlists\",\" (\",1043,\")\"]}]...'
)


class SlugTest(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(s.slugify("Audio & Radio"), "audio-radio")
        self.assertEqual(s.slugify("Glass: The Lion for Change"), "glass-the-lion-for-change")

    def test_urls(self):
        self.assertEqual(
            s.category_url("digital-craft", 2025),
            "https://www.lovethework.com/en/awards/winners-shortlists/cannes-lions/digital-craft?tag=publication+dates@@year@@2025",
        )
        self.assertEqual(
            s.results_url(8, 2025),
            "https://www.lovethework.com/en/awards/results/cannes-lions?year=2025&entry_type_id=8",
        )

    def test_slug_candidates_try_name_with_and_without_lions(self):
        self.assertEqual(s.slug_candidates("Film Lions"), ["film-lions", "film"])
        self.assertEqual(s.slug_candidates("Film"), ["film"])


class ResultsParseTest(unittest.TestCase):
    def test_parse_category_name(self):
        r = s.parse_results_html(RESULTS_HTML)
        self.assertEqual(r["category"], "Brand Experience & Activation")

    def test_parse_rows_winners_only(self):
        r = s.parse_results_html(RESULTS_HTML)
        cards = r["cards"]
        self.assertEqual([c["title"] for c in cards], ["OTHER HAND", "DROPS OF HOPE", "GP ENTRY"])
        self.assertEqual([c["level"] for c in cards], ["Bronze", "Gold", "Grand Prix"])
        self.assertEqual(r["shortlistRows"], 1)

    def test_row_fields(self):
        c = s.parse_results_html(RESULTS_HTML)["cards"][0]
        self.assertEqual(c["subcategory"], "A01 - CONSUMER GOODS")
        self.assertEqual(c["brand"], "CHEETOS | PEPSICO")
        self.assertEqual(c["product"], "CHEETOS")
        self.assertEqual(c["agency"], "GOODBY SILVERSTEIN & PARTNERS, San Francisco")
        self.assertEqual(c["location"], "United States")
        self.assertEqual(c["entryUrl"], "https://www.lovethework.com/work/entries/other-hand-746730")
        self.assertEqual(c["prize"], "Bronze Lion")

    def test_header_rows_are_skipped(self):
        r = s.parse_results_html(RESULTS_HTML)
        self.assertNotIn("Title", [c["title"] for c in r["cards"]])

    def test_empty_page_gives_no_category(self):
        r = s.parse_results_html("<html><body><h1>Oops</h1></body></html>")
        self.assertIsNone(r["category"])
        self.assertEqual(r["cards"], [])

    def test_level_from_prize(self):
        self.assertEqual(s.level_from_prize("Gold Lion"), "Gold")
        self.assertEqual(s.level_from_prize("Grand Prix"), "Grand Prix")
        self.assertEqual(s.level_from_prize("Titanium Lion"), "Titanium")
        self.assertEqual(s.level_from_prize("Titanium Grand Prix"), "Titanium Grand Prix")
        # 部門によっては単体/キャンペーンや部門名つきの表記になる（見出しは Gold / Grand Prix に集約）
        self.assertEqual(s.level_from_prize("Gold Lion Campaign"), "Gold")
        self.assertEqual(s.level_from_prize("Silver Lion Campaign"), "Silver")
        self.assertEqual(s.level_from_prize("Bronze Lion Campaign"), "Bronze")
        self.assertEqual(s.level_from_prize("Grand Prix Campaign"), "Grand Prix")
        self.assertEqual(s.level_from_prize("Grand Prix for Good"), "Grand Prix")
        self.assertEqual(s.level_from_prize("Creative Effectiveness Grand Prix"), "Grand Prix")
        self.assertIsNone(s.level_from_prize("Shortlist"))
        self.assertIsNone(s.level_from_prize(""))


class HeadingTest(unittest.TestCase):
    def test_parse_headings(self):
        texts = ["Grand Prix (1)", "Gold (3)", "Silver (5)", "Bronze (8)", "Shortlists (43)"]
        self.assertEqual(
            s.parse_headings(texts),
            {"Grand Prix": 1, "Gold": 3, "Silver": 5, "Bronze": 8, "Shortlist": 43},
        )

    def test_parse_headings_ignores_noise(self):
        self.assertEqual(s.parse_headings(["Grand Prix (2)", "Filter", "Gold (0)"]), {"Grand Prix": 2, "Gold": 0})

    def test_parse_headings_from_page_html(self):
        self.assertEqual(
            s.parse_headings_from_html(CATEGORY_PAGE_SNIPPET),
            {"Grand Prix": 1, "Gold": 3, "Shortlist": 1043},
        )

    def test_parse_headings_from_page_html_none(self):
        self.assertEqual(s.parse_headings_from_html("<html></html>"), {})


def card(level, n):
    return {"level": level, "title": f"T{n}", "entryUrl": f"https://x/{level}-{n}"}


class VerifyTest(unittest.TestCase):
    HEAD = {"Grand Prix": 1, "Gold": 2, "Silver": 0, "Bronze": 1, "Shortlist": 40}

    def test_complete(self):
        cards = [card("Grand Prix", 1), card("Gold", 1), card("Gold", 2), card("Bronze", 1)]
        r = s.verify_counts(self.HEAD, cards)
        self.assertTrue(r["complete"])
        self.assertEqual(r["mismatches"], [])
        self.assertEqual(r["counts"]["Gold"], {"heading": 2, "scraped": 2})
        self.assertEqual(r["counts"]["Shortlist"], {"heading": 40, "scraped": None})

    def test_missing_cards_is_incomplete_with_both_counts(self):
        cards = [card("Grand Prix", 1), card("Gold", 1), card("Bronze", 1)]
        r = s.verify_counts(self.HEAD, cards)
        self.assertFalse(r["complete"])
        self.assertEqual(r["mismatches"], [{"level": "Gold", "heading": 2, "scraped": 1}])

    def test_card_level_absent_from_headings_is_mismatch(self):
        cards = [card("Grand Prix", 1), card("Gold", 1), card("Gold", 2), card("Bronze", 1), card("Titanium", 1)]
        r = s.verify_counts(self.HEAD, cards)
        self.assertFalse(r["complete"])
        self.assertEqual(r["mismatches"], [{"level": "Titanium", "heading": 0, "scraped": 1}])

    def test_no_headings_is_incomplete(self):
        r = s.verify_counts({}, [card("Gold", 1)])
        self.assertFalse(r["complete"])
        self.assertEqual(r["mismatches"], [])
        self.assertTrue(r["headingsMissing"])

    def test_dedupe_by_entry_url_and_subcategory(self):
        a = {**card("Gold", 1), "subcategory": "A"}
        b = {**card("Gold", 1), "subcategory": "B"}  # 同一作品でも部門内の別サブカテゴリは別エントリー
        self.assertEqual(len(s.dedupe_cards([a, a, b])), 2)



class ClassifyTest(unittest.TestCase):
    def test_404_is_absent(self):
        self.assertEqual(s.classify_results_response(404, "")["kind"], "absent")

    def test_200_with_table_is_found(self):
        r = s.classify_results_response(200, RESULTS_HTML)
        self.assertEqual(r["kind"], "found")
        self.assertEqual(r["parsed"]["category"], "Brand Experience & Activation")

    def test_200_explicit_no_results_is_absent(self):
        r = s.classify_results_response(200, "<html><body><h1>Foo Lions results table</h1><p>No results found</p></body></html>")
        self.assertEqual(r["kind"], "absent")

    def test_200_unrecognized_is_error(self):
        r = s.classify_results_response(200, "<html><body><h1>Oops</h1></body></html>")
        self.assertEqual(r["kind"], "error")

    def test_other_statuses_are_errors_not_absence(self):
        for st in (403, 429, 500, 503):
            r = s.classify_results_response(st, "")
            self.assertEqual(r["kind"], "error", st)
            self.assertEqual(r["httpStatus"], st)

    def test_exception_is_error_with_message(self):
        r = s.classify_results_response(None, "URLError: timed out")
        self.assertEqual(r["kind"], "error")
        self.assertIn("timed out", r["error"])


class YearMarkerTest(unittest.TestCase):
    def test_marker_parsed(self):
        self.assertEqual(s.parse_results_html(RESULTS_HTML)["year"], 2025)

    def test_no_marker(self):
        html = RESULTS_HTML.replace("CANNES LIONS 2025 RESULT TABLE", "x")
        self.assertIsNone(s.parse_results_html(html)["year"])

    def test_scrape_marks_verified_unverified_and_mismatch(self):
        orig_fetch, orig_sleep = s.fetch, s.time.sleep
        s.time.sleep = lambda *_: None
        try:
            s.fetch = lambda url: (200, RESULTS_HTML) if "results" in url else (404, "")
            self.assertTrue(s.scrape_entry_type(8, 2025)["yearVerified"])
            r = s.scrape_entry_type(8, 2024)
            self.assertIsNone(r["exists"])
            self.assertIn("year", r["fetchError"]["error"])
            nomark = RESULTS_HTML.replace("CANNES LIONS 2025 RESULT TABLE", "x")
            s.fetch = lambda url: (200, nomark) if "results" in url else (404, "")
            r = s.scrape_entry_type(8, 2025)
            self.assertTrue(r["exists"])
            self.assertFalse(r["yearVerified"])
        finally:
            s.fetch, s.time.sleep = orig_fetch, orig_sleep

    def test_500_is_fetch_error_not_absent(self):
        orig_fetch = s.fetch
        s.fetch = lambda url: (500, "")
        try:
            r = s.scrape_entry_type(9, 2025)
        finally:
            s.fetch = orig_fetch
        self.assertIsNone(r["exists"])
        self.assertEqual(r["fetchError"]["httpStatus"], 500)


class ScanRangeTest(unittest.TestCase):
    def run_scan(self, found_ids, stop_gap=5, error_ids=(), max_id=200):
        calls = []

        def fake(eid, year):
            calls.append(eid)
            if eid in error_ids:
                return {"entryTypeId": eid, "exists": None, "fetchError": {"httpStatus": 503}}
            return {"entryTypeId": eid, "exists": eid in found_ids, "httpStatus": 200 if eid in found_ids else 404}

        orig_s, orig_sleep = s.scrape_entry_type, s.time.sleep
        s.scrape_entry_type, s.time.sleep = fake, lambda *_: None
        try:
            return s.scan_year(2025, stop_gap=stop_gap, max_id=max_id), calls
        finally:
            s.scrape_entry_type, s.time.sleep = orig_s, orig_sleep

    def test_scans_past_70(self):
        (results, scan), calls = self.run_scan(set(range(1, 73)) - {20, 21}, stop_gap=5)
        self.assertEqual(max(calls), 77)
        self.assertEqual(scan["maxFoundId"], 72)
        self.assertEqual(scan["scannedTo"], 77)
        self.assertFalse(scan["capped"])

    def test_errors_do_not_count_toward_gap(self):
        (results, scan), calls = self.run_scan({3}, stop_gap=3, error_ids={5})
        self.assertEqual(calls, [1, 2, 3, 4, 5, 6, 7, 8])  # 5 は error で連続カウントをリセット、6-8 で3連続 absent

    def test_cap_is_flagged(self):
        (results, scan), calls = self.run_scan({1, 2, 3}, stop_gap=5, error_ids=set(range(4, 100)), max_id=10)
        self.assertTrue(scan["capped"])
        self.assertEqual(max(calls), 10)


class ExplicitIdsTest(unittest.TestCase):
    def test_explicit_ids_recorded(self):
        orig_s, orig_sleep = s.scrape_entry_type, s.time.sleep
        s.scrape_entry_type = lambda eid, y: {"entryTypeId": eid, "exists": False, "httpStatus": 404}
        s.time.sleep = lambda *_: None
        try:
            results, scan = s.scan_year(2025, ids=[44, 45])
        finally:
            s.scrape_entry_type, s.time.sleep = orig_s, orig_sleep
        self.assertEqual(scan["explicit"], True)
        self.assertEqual([r["entryTypeId"] for r in results], [44, 45])


if __name__ == "__main__":
    unittest.main()
