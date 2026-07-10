import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadAgentDefinition, loadAgentDefinitionFromFile } from "./agentLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(__dirname, "../../../.claude/agents");

test("loadAgentDefinition: case-collector.mdのfrontmatter/本文を解釈できる", () => {
  const def = loadAgentDefinition(AGENTS_DIR, "case-collector");
  assert.match(def.description, /収集/);
  assert.deepEqual(def.tools, ["Bash", "Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
  assert.equal(def.model, "sonnet");
  assert.match(def.prompt, /クリエイティブ事例の収集専門エージェント/);
});

test("loadAgentDefinition: link-checker.mdはhaikuモデル・少ないtools", () => {
  const def = loadAgentDefinition(AGENTS_DIR, "link-checker");
  assert.equal(def.model, "haiku");
  assert.deepEqual(def.tools, ["WebFetch", "Bash", "Read"]);
});

test("loadAgentDefinition: award-verifier.mdを解釈できる", () => {
  const def = loadAgentDefinition(AGENTS_DIR, "award-verifier");
  assert.deepEqual(def.tools, ["WebSearch", "WebFetch", "Read"]);
  assert.match(def.prompt, /受賞事実の検証専門エージェント/);
});

test("loadAgentDefinition: case-writer.mdはBash無し", () => {
  const def = loadAgentDefinition(AGENTS_DIR, "case-writer");
  assert.deepEqual(def.tools, ["Read", "Grep", "Glob"]);
  assert.ok(!def.tools.includes("Bash"));
});

test("loadAgentDefinitionFromFile: frontmatterが無いファイルは例外", () => {
  assert.throws(() => loadAgentDefinitionFromFile(path.join(__dirname, "pure.ts")));
});

test("loadAgentDefinition: 存在しないエージェント名は例外（fs側のENOENT）", () => {
  assert.throws(() => loadAgentDefinition(AGENTS_DIR, "does-not-exist"));
});
