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
