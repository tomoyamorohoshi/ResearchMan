/**
 * .claude/agents/<name>.md のfrontmatter+本文を読み、Agent SDKの AgentDefinition
 * 相当のプレーンオブジェクトへ変換する。既存サブエージェント定義（case-collector等）を
 * 唯一の情報源(single source of truth)としてStudioパイプラインからも使い回すための
 * ローダーで、.md の内容自体は一切変更しない（読み取り専用）。
 *
 * frontmatterは本リポジトリの5ファイル（case-collector/link-checker/award-verifier/
 * case-writer/schema-checker）で共通の単純な `key: value` 形式のみ対応する簡易パーサ
 * （汎用YAMLパーサは導入しない）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface LoadedAgentDefinition {
  description: string;
  tools: string[];
  model: string;
  prompt: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function loadAgentDefinitionFromFile(filePath: string): LoadedAgentDefinition {
  const raw = readFileSync(filePath, "utf-8");
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`エージェント定義のfrontmatterが見つかりません: ${filePath}`);
  }
  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  const tools = (fields.tools ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    description: fields.description ?? "",
    tools,
    model: fields.model ?? "sonnet",
    prompt: body.trim(),
  };
}

export function loadAgentDefinition(agentsDir: string, name: string): LoadedAgentDefinition {
  return loadAgentDefinitionFromFile(path.join(agentsDir, `${name}.md`));
}
