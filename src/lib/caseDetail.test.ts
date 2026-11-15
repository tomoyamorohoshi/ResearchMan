import { test } from "node:test";
import assert from "node:assert/strict";
import { caseDetailUrl, fetchCaseDetail } from "./caseDetail";

function res(ok: boolean, body: unknown): Response {
  return { ok, status: ok ? 200 : 404, json: async () => body } as unknown as Response;
}

test("caseDetailUrl: /data/cases/<エンコード済みid>.json", () => {
  assert.equal(caseDetailUrl("a-1"), "/data/cases/a-1.json");
  assert.equal(caseDetailUrl("a b/c"), "/data/cases/a%20b%2Fc.json");
});

test("fetchCaseDetail: 成功時は本文を返す", async () => {
  const urls: string[] = [];
  const d = await fetchCaseDetail("a-1", async (u) => {
    urls.push(u);
    return res(true, { id: "a-1", overview: "O" });
  });
  assert.deepEqual(urls, ["/data/cases/a-1.json"]);
  assert.equal(d.overview, "O");
});

test("fetchCaseDetail: HTTPエラー・例外はthrow（呼び出し側が失敗表示にする）", async () => {
  await assert.rejects(fetchCaseDetail("x", async () => res(false, null)), /HTTP 404/);
  await assert.rejects(
    fetchCaseDetail("x", async () => {
      throw new Error("net");
    }),
    /net/,
  );
});
