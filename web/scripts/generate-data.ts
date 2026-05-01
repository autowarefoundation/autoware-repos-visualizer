import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const PROJECT_ROOT = resolve(WEB_ROOT, "..");
const REPOS_FILE = resolve(PROJECT_ROOT, "repositories", "autoware.repos");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const OUT_FILE = resolve(WEB_ROOT, "public", "data", "commits.json");

const UNIT = "\x1f"; // unit separator
const RECORD = "\x1e"; // record separator

interface ReposFile {
  repositories: Record<
    string,
    { type: string; url: string; version: string }
  >;
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

interface Dataset {
  generatedAt: string;
  repos: RepoData[];
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
  if (tryGit(dir, ["show-ref", "--tags", "--verify", "--quiet", `refs/tags/${version}`]) !== null) {
    return "tag";
  }
  if (
    tryGit(dir, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${version}`,
    ]) !== null ||
    tryGit(dir, ["show-ref", "--verify", "--quiet", `refs/heads/${version}`]) !==
      null
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

function main(): void {
  const yamlText = readFileSync(REPOS_FILE, "utf8");
  const parsed = yaml.load(yamlText) as ReposFile | null;
  if (!parsed?.repositories) {
    throw new Error(`No "repositories" key in ${REPOS_FILE}`);
  }

  const repos: RepoData[] = [];
  console.log(`Processing ${Object.keys(parsed.repositories).length} repos...`);
  for (const [key, entry] of Object.entries(parsed.repositories)) {
    const data = processRepo(key, entry);
    if (data) repos.push(data);
  }

  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    repos,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(dataset));

  console.log("\nSummary:");
  console.log(
    "  repo".padEnd(60) +
      "commits".padStart(8) +
      "  pinned",
  );
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
