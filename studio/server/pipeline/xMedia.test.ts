import assert from "node:assert/strict";
import test from "node:test";
import {
  buildXMediaTempDir,
  computeSyndicationToken,
  extractTweetId,
  parseFxTwitterTweet,
  parseSyndicationTweet,
} from "./xMedia.js";

// ── extractTweetId ──────────────────────────────────────────────

test("extractTweetId: x.com/status/<id> からidを抽出する", () => {
  assert.equal(extractTweetId("https://x.com/jamesoniam/status/2077432470375731467"), "2077432470375731467");
});

test("extractTweetId: twitter.com/status/<id> からidを抽出する", () => {
  assert.equal(extractTweetId("https://twitter.com/minicoolkohe/status/2077028203567484930"), "2077028203567484930");
});

test("extractTweetId: クエリ文字列付きURLでもidを抽出する", () => {
  assert.equal(extractTweetId("https://x.com/user/status/123456789?s=20&t=abc"), "123456789");
});

test("extractTweetId: statusパスが無いURLはnull", () => {
  assert.equal(extractTweetId("https://x.com/jamesoniam"), null);
});

test("extractTweetId: 不正なURLはnull", () => {
  assert.equal(extractTweetId("not a url"), null);
});

// ── computeSyndicationToken ──────────────────────────────────────

test("computeSyndicationToken: 既知のidに対して既知のtokenを返す（react-tweetの公開アルゴリズム）", () => {
  assert.equal(computeSyndicationToken("2077432470375731467"), "51ag2rz3xv7");
  assert.equal(computeSyndicationToken("123"), "138spvehogpo");
});

// ── parseSyndicationTweet ─────────────────────────────────────────

test("parseSyndicationTweet: 本文・作者・日時・写真/動画サムネを抽出する", () => {
  const raw = {
    text: "テスト投稿本文",
    user: { name: "James Oniam", screen_name: "jamesoniam" },
    created_at: "2026-07-01T00:00:00.000Z",
    mediaDetails: [
      { type: "photo", media_url_https: "https://pbs.twimg.com/media/photo1.jpg" },
      { type: "video", media_url_https: "https://pbs.twimg.com/media/video1-thumb.jpg" },
      { type: "animated_gif", media_url_https: "https://pbs.twimg.com/media/gif1-thumb.jpg" },
    ],
  };
  const parsed = parseSyndicationTweet(raw);
  assert.ok(parsed);
  assert.equal(parsed?.source, "syndication");
  assert.equal(parsed?.text, "テスト投稿本文");
  assert.match(parsed?.author ?? "", /James Oniam/);
  assert.match(parsed?.author ?? "", /jamesoniam/);
  assert.equal(parsed?.createdAt, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(parsed?.photoUrls, ["https://pbs.twimg.com/media/photo1.jpg"]);
  assert.deepEqual(parsed?.videoThumbnailUrls, [
    "https://pbs.twimg.com/media/video1-thumb.jpg",
    "https://pbs.twimg.com/media/gif1-thumb.jpg",
  ]);
});

test("parseSyndicationTweet: 写真は最大4枚にcapする", () => {
  const raw = {
    text: "5枚投稿",
    user: { name: "A", screen_name: "a" },
    created_at: "2026-07-01T00:00:00.000Z",
    mediaDetails: Array.from({ length: 5 }, (_, i) => ({
      type: "photo",
      media_url_https: `https://pbs.twimg.com/media/p${i}.jpg`,
    })),
  };
  const parsed = parseSyndicationTweet(raw);
  assert.equal(parsed?.photoUrls.length, 4);
});

test("parseSyndicationTweet: 空オブジェクト（{}）はnull（fail-closed）", () => {
  assert.equal(parseSyndicationTweet({}), null);
});

test("parseSyndicationTweet: textが無い応答はnull", () => {
  assert.equal(parseSyndicationTweet({ user: { name: "A" } }), null);
});

test("parseSyndicationTweet: mediaDetails無し（テキストのみ投稿）でも本文は取得できる", () => {
  const raw = { text: "テキストのみ", user: { name: "A", screen_name: "a" }, created_at: "2026-07-01T00:00:00.000Z" };
  const parsed = parseSyndicationTweet(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed?.photoUrls, []);
  assert.deepEqual(parsed?.videoThumbnailUrls, []);
});

test("parseSyndicationTweet: 不正な形状（配列・null等）はnull", () => {
  assert.equal(parseSyndicationTweet(null), null);
  assert.equal(parseSyndicationTweet([]), null);
  assert.equal(parseSyndicationTweet("string"), null);
});

// ── parseFxTwitterTweet ───────────────────────────────────────────

test("parseFxTwitterTweet: tweet.media.all から写真/動画サムネを振り分ける", () => {
  const raw = {
    tweet: {
      text: "日比谷TOHOのトイストーリー演出",
      author: { name: "みにくーるこけ", screen_name: "minicoolkohe" },
      created_at: "2026-07-02T00:00:00.000Z",
      media: {
        all: [
          { type: "photo", url: "https://pbs.twimg.com/media/photoA.jpg" },
          { type: "video", url: "https://video.twimg.com/video1.mp4", thumbnail_url: "https://pbs.twimg.com/media/videoA-thumb.jpg" },
          { type: "gif", url: "https://video.twimg.com/gif1.mp4", thumbnail_url: "https://pbs.twimg.com/media/gifA-thumb.jpg" },
        ],
      },
    },
  };
  const parsed = parseFxTwitterTweet(raw);
  assert.ok(parsed);
  assert.equal(parsed?.source, "fxtwitter");
  assert.equal(parsed?.text, "日比谷TOHOのトイストーリー演出");
  assert.match(parsed?.author ?? "", /minicoolkohe/);
  assert.deepEqual(parsed?.photoUrls, ["https://pbs.twimg.com/media/photoA.jpg"]);
  assert.deepEqual(parsed?.videoThumbnailUrls, [
    "https://pbs.twimg.com/media/videoA-thumb.jpg",
    "https://pbs.twimg.com/media/gifA-thumb.jpg",
  ]);
});

test("parseFxTwitterTweet: media.photos/media.videos があればそちらを優先する", () => {
  const raw = {
    tweet: {
      text: "本文",
      author: { name: "A", screen_name: "a" },
      created_at: "2026-07-02T00:00:00.000Z",
      media: {
        photos: [{ url: "https://pbs.twimg.com/media/preferred-photo.jpg" }],
        videos: [{ thumbnail_url: "https://pbs.twimg.com/media/preferred-video-thumb.jpg" }],
        all: [{ type: "photo", url: "https://pbs.twimg.com/media/fallback-photo.jpg" }],
      },
    },
  };
  const parsed = parseFxTwitterTweet(raw);
  assert.deepEqual(parsed?.photoUrls, ["https://pbs.twimg.com/media/preferred-photo.jpg"]);
  assert.deepEqual(parsed?.videoThumbnailUrls, ["https://pbs.twimg.com/media/preferred-video-thumb.jpg"]);
});

test("parseFxTwitterTweet: 写真は最大4枚にcapする", () => {
  const raw = {
    tweet: {
      text: "本文",
      author: { name: "A", screen_name: "a" },
      created_at: "2026-07-02T00:00:00.000Z",
      media: {
        all: Array.from({ length: 5 }, (_, i) => ({ type: "photo", url: `https://pbs.twimg.com/media/p${i}.jpg` })),
      },
    },
  };
  const parsed = parseFxTwitterTweet(raw);
  assert.equal(parsed?.photoUrls.length, 4);
});

test("parseFxTwitterTweet: tweetが無い応答はnull", () => {
  assert.equal(parseFxTwitterTweet({}), null);
});

test("parseFxTwitterTweet: tweet.textが無い応答はnull", () => {
  assert.equal(parseFxTwitterTweet({ tweet: { author: { name: "A" } } }), null);
});

test("parseFxTwitterTweet: 不正な形状（配列・null等）はnull", () => {
  assert.equal(parseFxTwitterTweet(null), null);
  assert.equal(parseFxTwitterTweet([]), null);
});

test("parseFxTwitterTweet: media無しでも本文は取得できる", () => {
  const raw = { tweet: { text: "本文のみ", author: { name: "A", screen_name: "a" }, created_at: "2026-07-02T00:00:00.000Z" } };
  const parsed = parseFxTwitterTweet(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed?.photoUrls, []);
  assert.deepEqual(parsed?.videoThumbnailUrls, []);
});

// ── buildXMediaTempDir ────────────────────────────────────────────

test("buildXMediaTempDir: os.tmpdir()配下にjobId付きの専用ディレクトリパスを組み立てる", () => {
  const dir = buildXMediaTempDir("job-abc123");
  assert.match(dir, /researchman-xmedia-job-abc123$/);
});

test("buildXMediaTempDir: jobIdが異なれば別ディレクトリになる", () => {
  assert.notEqual(buildXMediaTempDir("job-a"), buildXMediaTempDir("job-b"));
});
