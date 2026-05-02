import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { interpolateSpectral } from "d3-scale-chromatic";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const PROJECT_ROOT = resolve(WEB_ROOT, "..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const META_DIR = resolve(PROJECT_ROOT, "autoware-meta", "autoware");
const OUT_FILE = resolve(WEB_ROOT, "public", "data", "commits.json");

const UNIT = "\x1f"; // unit separator
const RECORD = "\x1e"; // record separator

const SEMVER_TAG = /^v?\d+\.\d+\.\d+$/;

interface ReposFile {
  repositories: Record<string, { type: string; url: string; version: string }>;
}

interface CommitRecord {
  sha: string;
  short: string;
  date: string;
  authorName: string;
  subject: string;
  url: string;
}

type PinnedRefKind = "tag" | "branch" | "sha";

interface RepoData {
  key: string;
  category: string;
  shortName: string;
  remoteUrl: string;
  pinnedVersion: string;
  pinnedSha: string;
  pinnedRefKind: PinnedRefKind;
  defaultBranch: string;
  commits: CommitRecord[];
}

interface VersionPin {
  repoKey: string; // current key (after rename matching)
  sha: string; // resolved commit
  pinnedVersion: string; // raw version string from historical autoware.repos
}

interface AutowareVersion {
  tag: string; // "1.7.1" or "main"
  isMain: boolean;
  releasedAt: string; // ISO
  color: string; // CSS color string
  metaSha: string; // commit on autoware-meta this tag points to
  pins: VersionPin[];
}

const META_KEY = "autoware/autoware";
const META_URL = "https://github.com/autowarefoundation/autoware";

interface Dataset {
  generatedAt: string;
  repos: RepoData[];
  versions: AutowareVersion[];
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(dir: string, args: string[]): string | null {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
}

function normalizeRemoteUrl(rawUrl: string): string {
  let u = rawUrl.trim();
  // git@github.com:owner/repo(.git) -> https://github.com/owner/repo
  const sshMatch = u.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (sshMatch) {
    u = `https://${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    u = u.replace(/\.git$/, "");
  }
  return u;
}

function detectDefaultBranch(dir: string): string {
  const head = tryGit(dir, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head) {
    // strips the "origin/" prefix
    return head.replace(/^origin\//, "");
  }
  for (const candidate of ["main", "master"]) {
    const exists = tryGit(dir, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${candidate}`,
    ]);
    if (exists !== null) return candidate;
  }
  // last resort: current HEAD branch name (may be detached)
  const cur = tryGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return cur && cur !== "HEAD" ? cur : "main";
}

function classifyRef(dir: string, version: string): PinnedRefKind {
  if (
    tryGit(dir, [
      "show-ref",
      "--tags",
      "--verify",
      "--quiet",
      `refs/tags/${version}`,
    ]) !== null
  ) {
    return "tag";
  }
  if (
    tryGit(dir, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${version}`,
    ]) !== null ||
    tryGit(dir, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${version}`,
    ]) !== null
  ) {
    return "branch";
  }
  return "sha";
}

function parseCommits(raw: string, remoteUrl: string): CommitRecord[] {
  const out: CommitRecord[] = [];
  for (const record of raw.split(RECORD)) {
    const trimmed = record.replace(/^\n+/, "");
    if (!trimmed) continue;
    const parts = trimmed.split(UNIT);
    if (parts.length < 5) continue;
    const [sha, short, date, authorName, subject] = parts;
    out.push({
      sha,
      short,
      date,
      authorName,
      subject,
      url: `${remoteUrl}/commit/${sha}`,
    });
  }
  return out;
}

function loadCommitByRef(
  dir: string,
  ref: string,
  remoteUrl: string,
): CommitRecord | null {
  const raw = tryGit(dir, [
    "log",
    "-1",
    `--format=%H${UNIT}%h${UNIT}%cI${UNIT}%an${UNIT}%s${RECORD}`,
    ref,
  ]);
  if (!raw) return null;
  const [c] = parseCommits(raw, remoteUrl);
  return c ?? null;
}

function processRepo(
  key: string,
  entry: { url: string; version: string },
): RepoData | null {
  const dir = resolve(SRC_ROOT, key);
  if (!existsSync(dir)) {
    console.warn(`  ! ${key}: clone not found at ${dir}, skipping`);
    return null;
  }
  const remoteUrl = normalizeRemoteUrl(entry.url);
  const defaultBranch = detectDefaultBranch(dir);
  const pinnedSha = tryGit(dir, ["rev-parse", `${entry.version}^{commit}`]);
  if (!pinnedSha) {
    console.warn(
      `  ! ${key}: cannot resolve pinned version "${entry.version}", skipping`,
    );
    return null;
  }
  const pinnedRefKind = classifyRef(dir, entry.version);

  // try origin/<branch> first, fall back to local <branch>
  const branchRef =
    tryGit(dir, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${defaultBranch}`,
    ]) !== null
      ? `origin/${defaultBranch}`
      : defaultBranch;

  const raw = tryGit(dir, [
    "log",
    branchRef,
    `--format=%H${UNIT}%h${UNIT}%cI${UNIT}%an${UNIT}%s${RECORD}`,
  ]);
  const commits = raw ? parseCommits(raw, remoteUrl) : [];

  // safety belt: ensure the pinned commit is included even if it isn't reachable
  // from the default branch (e.g. shallow clones, detached tags).
  if (!commits.some((c) => c.sha === pinnedSha)) {
    const pinned = loadCommitByRef(dir, pinnedSha, remoteUrl);
    if (pinned) commits.push(pinned);
  }

  // sort newest first
  commits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const segments = key.split("/");
  return {
    key,
    category: segments[0] ?? "",
    shortName: segments[segments.length - 1] ?? key,
    remoteUrl,
    pinnedVersion: entry.version,
    pinnedSha,
    pinnedRefKind,
    defaultBranch,
    commits,
  };
}

interface RepoIndex {
  byUrl: Map<string, string>; // canonical url -> current key
  byLastSegment: Map<string, string>; // last url path segment -> current key
}

function buildRepoIndex(repos: RepoData[]): RepoIndex {
  const byUrl = new Map<string, string>();
  const byLastSegment = new Map<string, string>();
  for (const r of repos) {
    byUrl.set(r.remoteUrl, r.key);
    const seg = r.remoteUrl.split("/").pop();
    if (seg && !byLastSegment.has(seg)) byLastSegment.set(seg, r.key);
  }
  return { byUrl, byLastSegment };
}

function matchToCurrentRepo(
  historicalUrl: string,
  idx: RepoIndex,
): string | null {
  const url = normalizeRemoteUrl(historicalUrl);
  const direct = idx.byUrl.get(url);
  if (direct) return direct;
  const seg = url.split("/").pop();
  if (seg) return idx.byLastSegment.get(seg) ?? null;
  return null;
}

function loadAutowareReposAtRef(ref: string): ReposFile | null {
  const candidates = ["autoware.repos", "repositories/autoware.repos"];
  for (const path of candidates) {
    const raw = tryGit(META_DIR, ["show", `${ref}:${path}`]);
    if (raw) {
      try {
        return yaml.load(raw) as ReposFile;
      } catch (e) {
        console.warn(
          `  ! ${ref}: failed to parse ${path}: ${(e as Error).message}`,
        );
        return null;
      }
    }
  }
  return null;
}

function processVersion(
  ref: string,
  isMain: boolean,
  color: string,
  idx: RepoIndex,
): AutowareVersion | null {
  const releasedAt = tryGit(META_DIR, ["log", "-1", "--format=%cI", ref]);
  if (!releasedAt) {
    console.warn(`  ! ${ref}: cannot resolve commit date`);
    return null;
  }
  const metaSha = tryGit(META_DIR, ["rev-parse", `${ref}^{commit}`]);
  if (!metaSha) {
    console.warn(`  ! ${ref}: cannot resolve meta commit sha`);
    return null;
  }
  const reposFile = loadAutowareReposAtRef(ref);
  if (!reposFile?.repositories) {
    console.warn(`  ! ${ref}: no autoware.repos found`);
    return null;
  }

  const pins: VersionPin[] = [];
  let dropRemoved = 0;
  let dropUnresolved = 0;
  for (const [, entry] of Object.entries(reposFile.repositories)) {
    if (!entry?.url || !entry?.version) continue;
    const currentKey = matchToCurrentRepo(entry.url, idx);
    if (!currentKey) {
      dropRemoved++;
      continue;
    }
    const dir = resolve(SRC_ROOT, currentKey);
    if (!existsSync(dir)) {
      dropUnresolved++;
      continue;
    }
    const sha = tryGit(dir, ["rev-parse", `${entry.version}^{commit}`]);
    if (!sha) {
      dropUnresolved++;
      continue;
    }
    pins.push({ repoKey: currentKey, sha, pinnedVersion: entry.version });
  }

  console.log(
    `  ${ref.padEnd(8)} ${releasedAt.slice(0, 10)}  pins=${String(pins.length).padStart(2)}  removed=${dropRemoved}  unresolved=${dropUnresolved}`,
  );

  return { tag: ref, isMain, releasedAt, color, metaSha, pins };
}

function processMetaRepo(): RepoData | null {
  if (!existsSync(META_DIR)) return null;
  const raw = tryGit(META_DIR, [
    "log",
    "main",
    `--format=%H${UNIT}%h${UNIT}%cI${UNIT}%an${UNIT}%s${RECORD}`,
  ]);
  const commits = raw ? parseCommits(raw, META_URL) : [];
  const headSha = tryGit(META_DIR, ["rev-parse", "main"]);
  if (!headSha) return null;
  return {
    key: META_KEY,
    category: "autoware",
    shortName: "autoware",
    remoteUrl: META_URL,
    pinnedVersion: "main",
    pinnedSha: headSha,
    pinnedRefKind: "branch",
    defaultBranch: "main",
    commits,
  };
}

function processVersions(idx: RepoIndex): AutowareVersion[] {
  if (!existsSync(META_DIR)) {
    console.warn(`Skipping versions: meta repo not found at ${META_DIR}`);
    return [];
  }

  // strict MAJOR.MINOR.PATCH (with optional leading "v")
  const tagsRaw = tryGit(META_DIR, ["tag"]) ?? "";
  const tags = tagsRaw
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => SEMVER_TAG.test(t));

  // resolve each tag's commit date so we can sort chronologically
  const dated: { ref: string; date: string; isMain: boolean }[] = [];
  for (const tag of tags) {
    const date = tryGit(META_DIR, ["log", "-1", "--format=%cI", tag]);
    if (date) dated.push({ ref: tag, date, isMain: false });
  }

  // include main HEAD as a synthetic "main" entry, dated to its commit
  const mainDate = tryGit(META_DIR, ["log", "-1", "--format=%cI", "main"]);
  if (mainDate) dated.push({ ref: "main", date: mainDate, isMain: true });

  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  console.log(`\nProcessing ${dated.length} autoware versions...`);
  const versions: AutowareVersion[] = [];
  for (let i = 0; i < dated.length; i++) {
    const t = dated[i];
    const fraction = dated.length === 1 ? 0.5 : i / (dated.length - 1);
    // shift inward to skip the muddy ends of the spectral palette
    const color = interpolateSpectral(0.05 + 0.9 * fraction);
    const v = processVersion(t.ref, t.isMain, color, idx);
    if (v) versions.push(v);
  }
  return versions;
}

function main(): void {
  if (!existsSync(META_DIR)) {
    throw new Error(
      `autoware-meta clone not found at ${META_DIR}. ` +
        `Run: git clone https://github.com/autowarefoundation/autoware.git ${META_DIR}`,
    );
  }

  // Source of truth for the "current" pin set is the meta repo's main branch.
  const parsed = loadAutowareReposAtRef("main");
  if (!parsed?.repositories) {
    throw new Error(`Cannot read autoware.repos from autoware-meta:main`);
  }

  const repos: RepoData[] = [];
  console.log(`Processing ${Object.keys(parsed.repositories).length} repos...`);
  for (const [key, entry] of Object.entries(parsed.repositories)) {
    const data = processRepo(key, entry);
    if (data) repos.push(data);
  }

  const idx = buildRepoIndex(repos);
  const versions = processVersions(idx);

  // Add the meta repo as the top-row lane and prepend a meta pin to every
  // version so rings/polylines pass through it. The "pin" on the meta lane
  // is just the version's tag commit on autoware-meta itself.
  const metaRepo = processMetaRepo();
  if (metaRepo) {
    repos.unshift(metaRepo);
    for (const v of versions) {
      v.pins.unshift({
        repoKey: META_KEY,
        sha: v.metaSha,
        pinnedVersion: v.tag,
      });
    }
  }

  // Some historical pins point at commits that aren't reachable from the
  // default branch (e.g. release tags on maintenance branches). Inject those
  // commits into the relevant repo's commit list so the timeline can render
  // a ring/polyline at the right (date, lane) coordinate.
  const repoByKey = new Map(repos.map((r) => [r.key, r]));
  let injected = 0;
  for (const v of versions) {
    for (const pin of v.pins) {
      const repo = repoByKey.get(pin.repoKey);
      if (!repo) continue;
      if (repo.commits.some((c) => c.sha === pin.sha)) continue;
      const dir =
        repo.key === META_KEY ? META_DIR : resolve(SRC_ROOT, repo.key);
      const c = loadCommitByRef(dir, pin.sha, repo.remoteUrl);
      if (c) {
        repo.commits.push(c);
        injected++;
      }
    }
  }
  if (injected > 0) {
    for (const r of repos) {
      r.commits.sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      );
    }
    console.log(
      `\nInjected ${injected} off-branch pinned commit(s) into repo lists.`,
    );
  }

  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    repos,
    versions,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(dataset));

  console.log("\nRepo summary:");
  console.log("  repo".padEnd(60) + "commits".padStart(8) + "  pinned");
  for (const r of repos) {
    const pinnedShort = r.pinnedSha.slice(0, 7);
    console.log(
      `  ${r.key}`.padEnd(60) +
        String(r.commits.length).padStart(8) +
        `  ${pinnedShort} (${r.pinnedRefKind}: ${r.pinnedVersion})`,
    );
  }
  console.log(`\nWrote ${OUT_FILE}`);
}

main();
