import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cases.json"), "utf8"));

const targets = cases
  .filter((c) => (c.award || "").includes("Cannes Lions 2026"))
  .map((c) => ({ id: c.id, title: c.title, client: c.client, agency: c.agency, award: c.award }));

fs.writeFileSync("/tmp/verify-targets.json", JSON.stringify(targets));
console.log(`書き込み完了: ${targets.length}件`);
