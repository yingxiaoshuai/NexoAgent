import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SkillDefinition,
  SkillInstallRequest,
  SkillMarketplace,
  SkillSearchResponse,
} from "../../src/shared/types";
import { readBundledJson, resolveBundledFile } from "./bundled-config";
import {
  DATA_DIR,
  MANAGED_CUSTOM_SKILLS_DIR,
  MANAGED_MARKETPLACE_SKILLS_DIR,
  MANAGED_SKILLS_DIR,
  SKILLS_FILE,
  SKILL_STATE_FILE,
} from "./config";
import {
  getMarketplaceById,
  listSkillMarketplaces,
  searchMarketplaceSkills,
  stageMarketplaceSkillInstall,
} from "./skill-marketplaces";
import { buildRuntimeSettings } from "./settings";
import { resolveDataPath } from "./utils";
import { getWorkspaceRoot } from "./workspace";

interface StoredSkill extends SkillDefinition {
  instruction: string;
}

interface BundledSkillsFile {
  version: number;
  skills: StoredSkill[];
}

interface SkillStateEntry {
  key: string;
  enabled: boolean;
}

interface SkillStateFile {
  version: number;
  states: SkillStateEntry[];
}

interface ManagedSkillSidecar {
  key?: string;
  name?: string;
  category?: string;
  description?: string;
  source?: SkillDefinition["source"];
  marketplaceId?: string;
  marketplaceName?: string;
  homepage?: string;
  author?: string;
  version?: string;
  managed?: boolean;
  createdAt?: string;
  installSpec?: string;
}

interface DirectoryScanOptions {
  source: SkillDefinition["source"];
  managed: boolean;
  category: string;
  marketplaceId?: string;
  marketplaceName?: string;
  maxDepth?: number;
}

const MANAGED_SIDEcar_FILE = ".nexo-skill.json";
const MAX_SKILL_CHARS = 8_000;
const MAX_TOTAL_SKILL_CHARS = 24_000;

let bundledSkillsCache: StoredSkill[] | null = null;

async function loadBundledSkills(): Promise<StoredSkill[]> {
  if (bundledSkillsCache) return bundledSkillsCache;
  const existingRoot = await resolveBundledSkillRoot();

  if (existingRoot) {
    const scanned = await scanSkillRoot(existingRoot, {
      source: "built-in",
      managed: false,
      category: "built-in",
      maxDepth: 2,
    });

    if (scanned.length > 0) {
      bundledSkillsCache = scanned;
      return bundledSkillsCache.map((skill) => ({ ...skill, source: "built-in" as const }));
    }
  }

  const bundled = await readBundledJson<BundledSkillsFile>("skills.json");
  bundledSkillsCache = bundled.skills.map((skill) => ({
    ...skill,
    source: "built-in" as const,
  }));
  return bundledSkillsCache;
}

async function readLegacyStoredSkills(): Promise<StoredSkill[]> {
  try {
    const raw = await fs.readFile(SKILLS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredSkill =>
        Boolean(
          item
          && typeof item === "object"
          && typeof (item as StoredSkill).key === "string"
          && (item as StoredSkill).source !== "built-in",
        ),
      )
      .map((skill) => ({
        ...skill,
        source: skill.source || "workspace",
        instruction: typeof skill.instruction === "string" ? skill.instruction : "",
      }));
  } catch {
    return [];
  }
}

async function writeLegacyStoredSkills(skills: StoredSkill[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SKILLS_FILE, JSON.stringify(skills, null, 2), "utf8");
}

async function readSkillState(): Promise<SkillStateFile> {
  try {
    const raw = await fs.readFile(SKILL_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillStateFile>;
    if (!Array.isArray(parsed.states)) {
      return { version: 1, states: [] };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      states: parsed.states
        .filter((entry): entry is SkillStateEntry => Boolean(entry?.key))
        .map((entry) => ({ key: entry.key.trim(), enabled: entry.enabled === true })),
    };
  } catch {
    return { version: 1, states: [] };
  }
}

async function writeSkillState(state: SkillStateFile) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SKILL_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function setSkillState(key: string, enabled: boolean) {
  const state = await readSkillState();
  const existing = state.states.find((entry) => entry.key === key);
  if (existing) {
    existing.enabled = enabled;
  } else {
    state.states.push({ key, enabled });
  }
  await writeSkillState(state);
}

async function removeSkillState(key: string) {
  const state = await readSkillState();
  const next = state.states.filter((entry) => entry.key !== key);
  if (next.length === state.states.length) return;
  await writeSkillState({ ...state, states: next });
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function splitFrontmatter(raw: string) {
  if (!raw.startsWith("---")) {
    return { header: "", body: raw.trim() };
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) {
    return { header: "", body: raw.trim() };
  }
  return {
    header: raw.slice(3, end).trim(),
    body: raw.slice(end + 4).trim(),
  };
}

function normalizeSkillInstruction(raw: string, fallbackName: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const { header, body } = splitFrontmatter(trimmed);
  if (!header) return trimmed;

  const frontmatter = parseFrontmatter(header);
  const displayName =
    (typeof frontmatter.displayName === "string" ? frontmatter.displayName : "")
    || (typeof frontmatter.name === "string" ? frontmatter.name : "")
    || fallbackName;
  const titlePattern = new RegExp(`^#\\s+${displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const normalizedBody = body
    .replace(titlePattern, "")
    .trim();
  return normalizedBody || trimmed;
}

function parseFrontmatter(header: string) {
  const meta: Record<string, string | Record<string, string>> = {};
  let currentParent: string | null = null;

  for (const rawLine of header.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ").replace(/\r/g, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.match(/^ */)?.[0].length ?? 0;
    const match = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = stripQuotes(rawValue);

    if (indent === 0) {
      currentParent = rawValue.trim() === "" ? key : null;
      if (currentParent) {
        meta[key] = {};
      } else {
        meta[key] = value;
      }
      continue;
    }

    if (currentParent && typeof meta[currentParent] === "object") {
      (meta[currentParent] as Record<string, string>)[key] = value;
    }
  }

  return meta;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeSlug(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function tokenizeSearch(value: string) {
  return value
    .toLowerCase()
    .split(/[\s\-_/|,.;:()[\]{}]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function pickFirstParagraph(value: string) {
  const paragraph = value
    .split(/\n\s*\n/)
    .map((chunk) => chunk.replace(/^#+\s*/gm, "").trim())
    .find(Boolean);
  return paragraph ?? "";
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBundledSkillRoot() {
  try {
    const bundledToolsFile = await resolveBundledFile("tools.json");
    return path.join(path.dirname(bundledToolsFile), "skills");
  } catch {
    const rootCandidates = [
      path.join(process.cwd(), "nexo", "skills"),
      path.join(__dirname, "..", "..", "..", "nexo", "skills"),
    ];

    for (const candidate of rootCandidates) {
      const discovered = await findSkillDirectories(candidate, 2);
      if (discovered.length > 0) {
        return candidate;
      }
    }

    return "";
  }
}

async function findSkillDirectories(root: string, maxDepth = 2) {
  const found = new Set<string>();

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    const skillFile = path.join(current, "SKILL.md");
    if (await fileExists(skillFile)) {
      found.add(current);
      return;
    }

    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => walk(path.join(current, entry.name), depth + 1)),
    );
  }

  await walk(root, 0);
  return [...found];
}

async function loadSkillFromDirectory(
  skillDir: string,
  options: DirectoryScanOptions,
): Promise<StoredSkill> {
  const skillFile = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const sidecar = await readJsonIfExists<ManagedSkillSidecar>(path.join(skillDir, MANAGED_SIDEcar_FILE));
  const metadataJson = await readJsonIfExists<{ version?: string; organization?: string; abstract?: string }>(
    path.join(skillDir, "metadata.json"),
  );
  const metaJson = await readJsonIfExists<{ version?: string; title?: string }>(path.join(skillDir, "_meta.json"));
  const { header, body } = splitFrontmatter(skillFile);
  const frontmatter = parseFrontmatter(header);
  const metadata = typeof frontmatter.metadata === "object"
    ? frontmatter.metadata as Record<string, string>
    : {};

  const rawKey =
    sidecar?.key
    || (typeof frontmatter.slug === "string" ? frontmatter.slug : "")
    || (typeof frontmatter.name === "string" ? frontmatter.name : "")
    || path.basename(skillDir);
  const key = slugify(rawKey) || path.basename(skillDir);
  const name =
    sidecar?.name
    || (typeof frontmatter.displayName === "string" ? frontmatter.displayName : "")
    || (typeof frontmatter.name === "string" ? frontmatter.name : "")
    || metaJson?.title
    || humanizeSlug(key);
  const descriptionSource =
    sidecar?.description
    || (typeof frontmatter.summary === "string" ? frontmatter.summary : "")
    || (typeof frontmatter.description === "string" ? frontmatter.description : "")
    || metadataJson?.abstract
    || pickFirstParagraph(body);

  return {
    key,
    name,
    category: sidecar?.category || options.category,
    enabled: false,
    source: sidecar?.source || options.source,
    description: summarizeText(descriptionSource || `${name} skill`),
    instruction: skillFile.trim(),
    path: skillDir,
    managed: sidecar?.managed ?? options.managed,
    marketplaceId: sidecar?.marketplaceId || options.marketplaceId,
    marketplaceName: sidecar?.marketplaceName || options.marketplaceName,
    homepage: sidecar?.homepage,
    author: sidecar?.author || metadata.author || metadataJson?.organization,
    version: sidecar?.version || metadata.version || metadataJson?.version || metaJson?.version,
    contentSize: skillFile.length,
  };
}

async function scanSkillRoot(root: string, options: DirectoryScanOptions) {
  const directories = await findSkillDirectories(root, options.maxDepth ?? 2);
  const loaded = await Promise.all(
    directories.map(async (skillDir) => {
      try {
        return await loadSkillFromDirectory(skillDir, options);
      } catch {
        return null;
      }
    }),
  );

  return loaded.filter((skill): skill is StoredSkill => Boolean(skill));
}

function getDiscoveryRoots() {
  const settings = buildRuntimeSettings();
  const workspaceRoot = getWorkspaceRoot(settings);
  const home = os.homedir();
  const roots: Array<{ root: string; options: DirectoryScanOptions }> = [
    {
      root: MANAGED_CUSTOM_SKILLS_DIR,
      options: { source: "workspace", managed: true, category: "custom", maxDepth: 2 },
    },
    {
      root: MANAGED_MARKETPLACE_SKILLS_DIR,
      options: { source: "marketplace", managed: true, category: "marketplace", maxDepth: 3 },
    },
    {
      root: path.join(workspaceRoot, ".claude", "skills"),
      options: { source: "workspace", managed: false, category: "workspace", maxDepth: 2 },
    },
    {
      root: path.join(workspaceRoot, ".codex", "skills"),
      options: { source: "workspace", managed: false, category: "workspace", maxDepth: 2 },
    },
    {
      root: path.join(workspaceRoot, ".agents", "skills"),
      options: { source: "workspace", managed: false, category: "workspace", maxDepth: 2 },
    },
    {
      root: path.join(workspaceRoot, "skills"),
      options: { source: "workspace", managed: false, category: "workspace", maxDepth: 2 },
    },
    {
      root: path.join(home, ".claude", "skills"),
      options: { source: "workspace", managed: false, category: "global", maxDepth: 2 },
    },
    {
      root: path.join(home, ".codex", "skills"),
      options: { source: "workspace", managed: false, category: "global", maxDepth: 2 },
    },
    {
      root: path.join(home, ".agents", "skills"),
      options: { source: "workspace", managed: false, category: "global", maxDepth: 2 },
    },
  ];

  const unique = new Map<string, DirectoryScanOptions>();
  for (const { root, options } of roots) {
    unique.set(path.resolve(root), options);
  }

  return [...unique.entries()].map(([root, options]) => ({ root, options }));
}

async function discoverFilesystemSkills() {
  const roots = getDiscoveryRoots();
  const discovered = await Promise.all(
    roots.map(async ({ root, options }) => scanSkillRoot(root, options)),
  );
  return discovered.flat();
}

function skillPriority(skill: StoredSkill) {
  if (skill.source === "built-in") return 0;
  if (skill.managed && skill.source === "marketplace") return 1;
  if (skill.managed) return 2;
  return 3;
}

function scoreSkillMatch(skill: StoredSkill, query: string, tokens: string[]) {
  const name = skill.name.toLowerCase();
  const key = skill.key.toLowerCase();
  const category = skill.category.toLowerCase();
  const description = skill.description.toLowerCase();
  const author = skill.author?.toLowerCase() ?? "";
  const marketplace = skill.marketplaceName?.toLowerCase() ?? "";

  let score = 0;
  if (name.includes(query)) score += 16;
  if (key.includes(query)) score += 18;
  if (category.includes(query)) score += 10;
  if (description.includes(query)) score += 8;
  if (author.includes(query)) score += 6;
  if (marketplace.includes(query)) score += 6;

  for (const token of tokens) {
    if (name === token || key === token) {
      score += 20;
      continue;
    }
    if (key.includes(token)) score += 12;
    if (name.includes(token)) score += 10;
    if (category.includes(token)) score += 5;
    if (description.includes(token)) score += 4;
    if (author.includes(token) || marketplace.includes(token)) score += 3;
  }

  if (skill.enabled) score += 1;
  if (skill.managed) score += 1;
  return score;
}

async function loadAllSkills() {
  const [builtins, legacy, discovered, state] = await Promise.all([
    loadBundledSkills(),
    readLegacyStoredSkills(),
    discoverFilesystemSkills(),
    readSkillState(),
  ]);

  const stateMap = new Map(state.states.map((entry) => [entry.key, entry.enabled]));
  const merged = new Map<string, StoredSkill>();

  for (const skill of builtins) {
    merged.set(skill.key, skill);
  }
  for (const skill of legacy) {
    merged.set(skill.key, skill);
  }
  for (const skill of discovered) {
    const current = merged.get(skill.key);
    if (!current || skillPriority(skill) <= skillPriority(current)) {
      merged.set(skill.key, skill);
    }
  }

  return [...merged.values()]
    .map((skill) => ({
      ...skill,
      enabled: stateMap.has(skill.key)
        ? stateMap.get(skill.key) === true
        : skill.source === "built-in"
          ? true
          : skill.enabled === true,
    }))
    .sort((left, right) => {
      const sourceDelta = skillPriority(left) - skillPriority(right);
      if (sourceDelta !== 0) return sourceDelta;
      return left.name.localeCompare(right.name);
    });
}

function buildManagedSkillMarkdown(skill: {
  key: string;
  name: string;
  description: string;
  instruction: string;
}) {
  const body = normalizeSkillInstruction(skill.instruction, skill.name);
  return [
    "---",
    `name: ${skill.key}`,
    `description: ${JSON.stringify(skill.description)}`,
    "metadata:",
    "  author: Nexo Agent",
    "---",
    "",
    `# ${skill.name}`,
    "",
    body,
    "",
  ].join("\n");
}

async function writeManagedSkillFiles(
  targetDir: string,
  skill: {
    key: string;
    name: string;
    category: string;
    description: string;
    instruction: string;
    source: SkillDefinition["source"];
    marketplaceId?: string;
    marketplaceName?: string;
    homepage?: string;
    author?: string;
    version?: string;
    installSpec?: string;
  },
) {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "SKILL.md"), buildManagedSkillMarkdown(skill), "utf8");
  await fs.writeFile(
    path.join(targetDir, MANAGED_SIDEcar_FILE),
    JSON.stringify({
      key: skill.key,
      name: skill.name,
      category: skill.category,
      description: skill.description,
      source: skill.source,
      marketplaceId: skill.marketplaceId,
      marketplaceName: skill.marketplaceName,
      homepage: skill.homepage,
      author: skill.author,
      version: skill.version,
      managed: true,
      createdAt: new Date().toISOString(),
      installSpec: skill.installSpec,
    } satisfies ManagedSkillSidecar, null, 2),
    "utf8",
  );
}

async function clearLegacySkill(key: string) {
  const legacy = await readLegacyStoredSkills();
  const next = legacy.filter((skill) => skill.key !== key);
  if (next.length !== legacy.length) {
    await writeLegacyStoredSkills(next);
  }
}

export async function listSkills(): Promise<SkillDefinition[]> {
  return loadAllSkills();
}

export async function searchLocalSkills(query: string, limit = 8): Promise<SkillDefinition[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const tokens = tokenizeSearch(trimmed);
  const skills = await loadAllSkills();
  return skills
    .map((skill) => ({ skill, score: scoreSkillMatch(skill, trimmed, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || skillPriority(left.skill) - skillPriority(right.skill)
      || left.skill.name.localeCompare(right.skill.name),
    )
    .slice(0, limit)
    .map((entry) => entry.skill);
}

export async function saveSkill(skill: SkillDefinition & { instruction: string }) {
  const key = slugify(skill.key || skill.name) || slugify(skill.name);
  const name = skill.name.trim() || humanizeSlug(key);
  const targetDir = path.join(MANAGED_CUSTOM_SKILLS_DIR, key);
  const normalized: StoredSkill = {
    ...skill,
    key,
    name,
    category: skill.category.trim() || "custom",
    description: skill.description.trim(),
    instruction: normalizeSkillInstruction(skill.instruction, name),
    source: "workspace",
    enabled: skill.enabled ?? true,
    managed: true,
    path: targetDir,
  };

  if (!normalized.description) {
    normalized.description = summarizeText(pickFirstParagraph(normalized.instruction) || `${name} custom skill`);
  }

  await writeManagedSkillFiles(targetDir, normalized);
  await clearLegacySkill(key);
  await setSkillState(key, normalized.enabled);

  return normalized;
}

export async function setSkillEnabled(key: string, enabled: boolean) {
  const skills = await loadAllSkills();
  const skill = skills.find((item) => item.key === key);
  if (!skill) throw new Error(`Unknown skill: ${key}`);
  await setSkillState(key, enabled);
}

export async function deleteSkill(key: string) {
  const skills = await loadAllSkills();
  const skill = skills.find((item) => item.key === key);
  if (!skill) return;

  if (skill.source === "built-in") {
    throw new Error("Built-in skills cannot be deleted.");
  }

  if (skill.managed && skill.path) {
    const target = resolveDataPath(MANAGED_SKILLS_DIR, path.relative(MANAGED_SKILLS_DIR, skill.path));
    await fs.rm(target, { recursive: true, force: true });
    await removeSkillState(key);
  } else {
    await setSkillState(key, false);
  }

  await clearLegacySkill(key);
}

function trimSkillInstruction(content: string, remaining: number) {
  const trimmed = content.trim();
  if (trimmed.length <= remaining) return { output: trimmed, consumed: trimmed.length };
  const slice = `${trimmed.slice(0, Math.max(0, remaining - 18)).trim()}\n\n[trimmed by Nexo]`;
  return { output: slice, consumed: remaining };
}

export async function getEnabledSkillInstructions() {
  const skills = await loadAllSkills();
  let remaining = MAX_TOTAL_SKILL_CHARS;
  const sections: string[] = [];

  for (const skill of skills.filter((item) => item.enabled && item.instruction.trim())) {
    if (remaining <= 0) break;
    const limit = Math.min(MAX_SKILL_CHARS, remaining);
    const { output, consumed } = trimSkillInstruction(skill.instruction, limit);
    remaining -= consumed;
    sections.push(`### ${skill.name}\n${output}`);
  }

  return sections.join("\n\n");
}

export async function listMarketplaces(): Promise<SkillMarketplace[]> {
  return listSkillMarketplaces();
}

export async function searchSkillsInMarketplaces(
  query: string,
  marketplaceIds?: string[],
): Promise<SkillSearchResponse> {
  return searchMarketplaceSkills(query, marketplaceIds);
}

async function findInstalledSkillDirectory(tempDir: string, request: SkillInstallRequest) {
  const candidates = await findSkillDirectories(tempDir, 4);
  if (candidates.length === 0) {
    throw new Error("Installer completed, but no SKILL.md file was found.");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const specTail = request.installSpec.split("@").pop() ?? request.installSpec;
  const wanted = new Set([
    slugify(request.key || ""),
    slugify(request.name || ""),
    slugify(specTail),
    slugify(path.basename(specTail)),
  ].filter(Boolean));

  const matched = candidates.find((candidate) => wanted.has(slugify(path.basename(candidate))));
  return matched ?? candidates[0];
}

export async function installMarketplaceSkill(request: SkillInstallRequest) {
  const marketplace = getMarketplaceById(request.marketplaceId);
  if (!marketplace) {
    throw new Error(`Unknown marketplace: ${request.marketplaceId}`);
  }

  const staged = await stageMarketplaceSkillInstall(request);
  try {
    const skillDir = await findInstalledSkillDirectory(staged.tempDir, request);
    const loaded = await loadSkillFromDirectory(skillDir, {
      source: "marketplace",
      managed: true,
      category: "marketplace",
      marketplaceId: marketplace.id,
      marketplaceName: marketplace.name,
    });

    const specKey = request.installSpec.split("@").pop() ?? request.installSpec;
    const key = slugify(request.key || specKey || loaded.key || loaded.name) || slugify(path.basename(skillDir));
    const targetDir = path.join(MANAGED_MARKETPLACE_SKILLS_DIR, marketplace.id, key);
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(skillDir, targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, MANAGED_SIDEcar_FILE),
      JSON.stringify({
        key,
        name: request.name || loaded.name,
        category: loaded.category || "marketplace",
        description: loaded.description,
        source: "marketplace",
        marketplaceId: marketplace.id,
        marketplaceName: marketplace.name,
        homepage: request.homepage || loaded.homepage || marketplace.homepage,
        author: loaded.author,
        version: loaded.version,
        managed: true,
        createdAt: new Date().toISOString(),
        installSpec: request.installSpec,
      } satisfies ManagedSkillSidecar, null, 2),
      "utf8",
    );

    await clearLegacySkill(key);
    await setSkillState(key, true);

    const installed = await loadSkillFromDirectory(targetDir, {
      source: "marketplace",
      managed: true,
      category: loaded.category || "marketplace",
      marketplaceId: marketplace.id,
      marketplaceName: marketplace.name,
    });
    return { ...installed, enabled: true };
  } finally {
    await staged.cleanup().catch(() => undefined);
  }
}
