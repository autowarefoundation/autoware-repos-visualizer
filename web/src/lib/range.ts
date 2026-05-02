import type { RangeKey } from "./types";

export const RANGE_KEYS: RangeKey[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
  "2Y",
  "All",
];

const MS_PER_DAY = 86_400_000;

const RANGE_DAYS: Record<Exclude<RangeKey, "All">, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
  "2Y": 730,
};

export function rangeToDomain(
  key: RangeKey,
  fallbackMin: Date,
  now: Date = new Date(),
): [Date, Date] {
  if (key === "All") return [fallbackMin, now];
  const days = RANGE_DAYS[key];
  return [new Date(now.getTime() - days * MS_PER_DAY), now];
}

export function parseRangeFromQuery(): RangeKey {
  if (typeof window === "undefined") return "6M";
  const params = new URLSearchParams(window.location.search);
  const v = params.get("range");
  if (v && (RANGE_KEYS as string[]).includes(v)) return v as RangeKey;
  return "6M";
}

export function writeRangeToQuery(key: RangeKey): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("range", key);
  window.history.replaceState(null, "", url.toString());
}

// Returns null when the param is absent (caller should fall back to its
// default) and a Set otherwise — including an empty Set when the param is
// present but blank, so an explicit empty selection round-trips.
export function parseVersionsFromQuery(): Set<string> | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("versions")) return null;
  const raw = params.get("versions") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function writeVersionsToQuery(versions: Set<string>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (versions.size === 0) {
    url.searchParams.delete("versions");
  } else {
    url.searchParams.set("versions", [...versions].join(","));
  }
  window.history.replaceState(null, "", url.toString());
}
