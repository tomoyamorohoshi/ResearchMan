/**
 * LINE公式アカウントのリッチメニュー作成・画像アップロード・デフォルト設定を行う
 * 一回きりのセットアップスクリプト（対話ウィザード拡張に伴うリッチメニュー導線用）。
 *
 * ボタン4つ（横4等分）はいずれも message アクションで固定文言を送信する。その文言は
 * studio/server/line/classify.ts::matchMenuSelection（idle/menu状態のメニュー選択判定）が
 * 受理する語と一致させてある（「事例調査」「技術調査」「事例+技術」「アイデア出し」）。
 * これにより、ボタンをタップするだけで対話ウィザードのメニュー提示を飛ばして
 * await_theme（テーマ質問）から始まる。
 *
 * 使い方:
 *   node scripts/setup-line-richmenu.mjs --image path/to/menu.png            # 実行
 *   node scripts/setup-line-richmenu.mjs --image path/to/menu.png --dry-run  # 送信内容の表示のみ（何も送信しない）
 *
 * 画像生成はこのスクリプトの責務外。2500x843px（4等分前提）のPNG/JPEGを別途用意すること。
 *
 * 認証情報はリポジトリに置かない。notify-line.mjs / studio/server/line/push.ts と同じ
 * ~/.researchman-line.json の channelAccessToken を使う（https直叩き・依存追加なし、同じ流儀）。
 *
 * 冪等性について: 「既存のdefaultリッチメニューがあれば削除してから設定」という運用要求を、
 * 「新規作成→画像アップロード→新規を新デフォルトに設定→（成功したら）旧デフォルトを削除」の
 * 順で実現する。これは要求どおりの「削除してから設定」を字面どおり先に行うと、新規作成や
 * 画像アップロードが失敗した場合に一時的にデフォルトリッチメニュー無し（ユーザー体験の欠落）
 * の状態が生じてしまうため、それを避ける意図的な順序変更。最終状態（=リッチメニューは1つだけ
 * 残り、それがデフォルト）は要求どおり。
 */
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIG_PATH = path.join(os.homedir(), ".researchman-line.json");

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const IMAGE_PATH = argOf("--image", null);

const API_BASE = "https://api.line.me";
const API_DATA_BASE = "https://api-data.line.me";

function log(msg) {
  console.log(`[setup-line-richmenu] ${msg}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log(`設定ファイルなし（${CONFIG_PATH}）`);
    return null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!cfg.channelAccessToken) {
      log("設定に channelAccessToken が不足");
      return null;
    }
    return cfg;
  } catch (e) {
    log(`設定読込失敗（${e.message}）`);
    return null;
  }
}

// 横4等分。文言は studio/server/line/classify.ts::matchMenuSelection の受理語と一致させること。
const RICHMENU_SIZE = { width: 2500, height: 843 };
const AREA_WIDTH = RICHMENU_SIZE.width / 4;
// 2026-07-15: メニュー3番を「事例+技術」からAWARDSへ変更（wizard側のメニュー置換に追随。
// "AWARDS" は classify.ts::MENU_SELECTION_RULES の受理語）
const BUTTON_LABELS = ["事例調査", "技術調査", "AWARDS", "アイデア出し"];

function buildRichMenuPayload() {
  return {
    size: RICHMENU_SIZE,
    selected: true,
    name: "ResearchMan メニュー",
    chatBarText: "メニュー",
    areas: BUTTON_LABELS.map((label, i) => ({
      bounds: { x: i * AREA_WIDTH, y: 0, width: AREA_WIDTH, height: RICHMENU_SIZE.height },
      action: { type: "message", label, text: label },
    })),
  };
}

function requestJson(method, url, token, body) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const headers = { Authorization: `Bearer ${token}` };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      const finish = () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        settle({ status: res.statusCode, body: text, json });
      };
      res.on("data", (d) => chunks.push(d));
      res.on("end", finish);
      res.on("close", finish);
      res.on("error", finish);
    });
    req.on("error", (e) => settle({ status: 0, body: e.message, json: null }));
    req.setTimeout(15000, () => {
      settle({ status: 0, body: "timeout", json: null });
      req.destroy();
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function requestUploadImage(url, token, imageBuffer, contentType) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          "Content-Length": imageBuffer.length,
        },
      },
      (res) => {
        const chunks = [];
        const finish = () => settle({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    req.on("error", (e) => settle({ status: 0, body: e.message }));
    req.setTimeout(30000, () => {
      settle({ status: 0, body: "timeout" });
      req.destroy();
    });
    req.write(imageBuffer);
    req.end();
  });
}

function contentTypeFor(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "image/png";
}

async function main() {
  if (!IMAGE_PATH) {
    log("--image <png/jpegファイルパス> は必須です（画像生成はこのスクリプトの責務外）");
    process.exitCode = 1;
    return;
  }

  const payload = buildRichMenuPayload();

  if (DRY_RUN) {
    log("--dry-run（送信しません）作成予定のリッチメニュー定義:");
    console.log(JSON.stringify(payload, null, 2));
    log(`画像: ${IMAGE_PATH}（${contentTypeFor(IMAGE_PATH)}）`);
    log("手順: 1) richmenu作成 → 2) 画像アップロード → 3) 新規をデフォルト設定 → 4) 旧デフォルトがあれば削除");
    return;
  }

  if (!fs.existsSync(IMAGE_PATH)) {
    log(`画像ファイルが見つかりません: ${IMAGE_PATH}`);
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();
  if (!cfg) {
    process.exitCode = 1;
    return;
  }
  const token = cfg.channelAccessToken;

  // 0) 既存デフォルトリッチメニューを確認（あれば新規設定の成功後に削除。冪等運用のため）
  const existing = await requestJson("GET", `${API_BASE}/v2/bot/user/all/richmenu`, token);
  const existingId = existing.status === 200 ? existing.json?.richMenuId : null;
  if (existingId) log(`既存のデフォルトリッチメニューを検出: ${existingId}（新規設定の成功後に削除します）`);

  // 1) 作成
  const created = await requestJson("POST", `${API_BASE}/v2/bot/richmenu`, token, payload);
  if (created.status !== 200 || !created.json?.richMenuId) {
    log(`リッチメニュー作成に失敗しました（status=${created.status} ${created.body}）`);
    process.exitCode = 1;
    return;
  }
  const richMenuId = created.json.richMenuId;
  log(`作成OK → richMenuId=${richMenuId}`);

  // 2) 画像アップロード
  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const uploaded = await requestUploadImage(
    `${API_DATA_BASE}/v2/bot/richmenu/${richMenuId}/content`,
    token,
    imageBuffer,
    contentTypeFor(IMAGE_PATH),
  );
  if (uploaded.status !== 200) {
    log(
      `画像アップロードに失敗しました（status=${uploaded.status} ${uploaded.body}）。` +
        `richMenuId=${richMenuId} は作成済みのまま残ります（LINE Developers Consoleから手動確認・削除してください）`,
    );
    process.exitCode = 1;
    return;
  }
  log("画像アップロードOK");

  // 3) デフォルト設定
  const setDefault = await requestJson("POST", `${API_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, token);
  if (setDefault.status !== 200) {
    log(`デフォルト設定に失敗しました（status=${setDefault.status} ${setDefault.body}）`);
    process.exitCode = 1;
    return;
  }
  log(`デフォルト設定OK → richMenuId=${richMenuId}`);

  // 4) 旧デフォルトの削除（冪等運用。新規設定の成功を確認した後に行う）
  if (existingId && existingId !== richMenuId) {
    const deleted = await requestJson("DELETE", `${API_BASE}/v2/bot/richmenu/${existingId}`, token);
    if (deleted.status === 200) {
      log(`旧リッチメニューを削除しました → ${existingId}`);
    } else {
      log(`旧リッチメニューの削除に失敗しました（status=${deleted.status} ${deleted.body}）。手動削除してください: ${existingId}`);
    }
  }

  log("完了。LINEアプリでトーク画面下部にメニューが表示されるはずです。");
}

main();
