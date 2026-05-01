export interface CommitRecord {
  sha: string;
  short: string;
  date: string;
  authorName: string;
  subject: string;
  url: string;
}

export type PinnedRefKind = "tag" | "branch" | "sha";

export interface RepoData {
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

export interface VersionPin {
  repoKey: string;
  sha: string;
  pinnedVersion: string;
}

export interface AutowareVersion {
  tag: string;
  isMain: boolean;
  releasedAt: string;
  color: string;
  metaSha: string; // commit on the autoware-meta repo this tag points at
  pins: VersionPin[];
}

export interface Dataset {
  generatedAt: string;
  repos: RepoData[];
  versions: AutowareVersion[];
}

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "All";

export interface HoverPayload {
  repo: RepoData;
  commit: CommitRecord;
  isPinned: boolean;
  clientX: number;
  clientY: number;
}
