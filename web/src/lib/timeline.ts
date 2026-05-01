import { axisTop } from "d3-axis";
import { scaleTime } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import type {
  AutowareVersion,
  CommitRecord,
  Dataset,
  HoverPayload,
  RepoData,
  VersionPin,
} from "./types";

interface TimelineCallbacks {
  onHover: (payload: HoverPayload) => void;
  onLeave: () => void;
}

interface LaneDatum {
  repo: RepoData;
  y: number;
  isCategoryHead: boolean;
}

const MARGIN = { top: 36, right: 24, bottom: 28, left: 240 };
const LANE_HEIGHT = 26;
const CATEGORY_GAP = 16;
const COMMIT_RADIUS = 4;
const PINNED_RADIUS = 7;
const NAME_MAX = 30;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const CATEGORY_ORDER = ["core", "universe", "launcher", "sensor_component"];

function categoryRank(c: string): number {
  const idx = CATEGORY_ORDER.indexOf(c);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function sortRepos(repos: RepoData[]): RepoData[] {
  return [...repos].sort((a, b) => {
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    return a.key.localeCompare(b.key);
  });
}

function buildLanes(repos: RepoData[]): { lanes: LaneDatum[]; height: number } {
  const sorted = sortRepos(repos);
  const lanes: LaneDatum[] = [];
  let y = 0;
  let prevCat: string | null = null;
  for (const repo of sorted) {
    const isCategoryHead = repo.category !== prevCat;
    if (isCategoryHead && prevCat !== null) y += CATEGORY_GAP;
    lanes.push({ repo, y: y + LANE_HEIGHT / 2, isCategoryHead });
    y += LANE_HEIGHT;
    prevCat = repo.category;
  }
  return { lanes, height: y };
}

export interface Timeline {
  setDomain(domain: [Date, Date]): void;
  setSelectedVersions(tags: Iterable<string>): void;
  resize(): void;
  destroy(): void;
}

export function createTimeline(
  svgEl: SVGSVGElement,
  dataset: Dataset,
  callbacks: TimelineCallbacks,
): Timeline {
  const { lanes, height: contentHeight } = buildLanes(dataset.repos);
  const repoIndex = new Map(lanes.map((l) => [l.repo.key, l]));

  // Find earliest commit for the "All" preset
  let dataMin = new Date();
  let dataMax = new Date(0);
  for (const r of dataset.repos) {
    for (const c of r.commits) {
      const d = new Date(c.date);
      if (d < dataMin) dataMin = d;
      if (d > dataMax) dataMax = d;
    }
  }
  const now = new Date();
  if (dataMax < now) dataMax = now;

  const svg = select(svgEl);
  svg.selectAll("*").remove();

  const totalHeight =
    contentHeight + MARGIN.top + MARGIN.bottom;
  svgEl.setAttribute("height", String(totalHeight));
  svgEl.setAttribute("width", "100%");

  // Defs: clip path for plot area
  const defs = svg.append("defs");
  defs
    .append("clipPath")
    .attr("id", "plot-clip")
    .append("rect")
    .attr("x", 0)
    .attr("y", -MARGIN.top + 2)
    .attr("width", 100)
    .attr("height", contentHeight + MARGIN.top);

  // root translate
  const root = svg
    .append("g")
    .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);

  // transparent capture rect so wheel/drag fire across the whole plot area
  // (including the gaps between lanes). Must be at the bottom of the z-order
  // and inside `root` so pointer coords align with xBase's local range.
  const captureRect = root
    .append("rect")
    .attr("class", "zoom-capture")
    .attr("x", 0)
    .attr("y", -MARGIN.top + 2)
    .attr("width", 0)
    .attr("height", contentHeight + MARGIN.top + MARGIN.bottom)
    .attr("fill", "transparent")
    .style("pointer-events", "all")
    .style("cursor", "grab");

  // background lane guides
  const lanesGroup = root
    .append("g")
    .attr("class", "lanes")
    .attr("clip-path", "url(#plot-clip)");

  lanesGroup
    .selectAll<SVGLineElement, LaneDatum>("line.lane")
    .data(lanes, (d) => d.repo.key)
    .join("line")
    .attr("class", "lane")
    .attr("x1", 0)
    .attr("x2", 100)
    .attr("y1", (d) => d.y)
    .attr("y2", (d) => d.y)
    .attr("stroke", "var(--lane-line)")
    .attr("stroke-width", 1);

  // repo name labels (left axis area, in fixed pixel space — outside transform)
  const labelGroup = svg
    .append("g")
    .attr("class", "labels")
    .attr("transform", `translate(0, ${MARGIN.top})`);

  labelGroup
    .selectAll<SVGGElement, LaneDatum>("g.label")
    .data(lanes, (d) => d.repo.key)
    .join((enter) => {
      const g = enter
        .append("g")
        .attr("class", "label")
        .style("cursor", "pointer")
        .on("click", (_event: MouseEvent, d: LaneDatum) => {
          window.open(d.repo.remoteUrl, "_blank", "noopener,noreferrer");
        });
      g.attr("transform", (d) => `translate(0, ${d.y})`);
      g.append("title").text((d) => `${d.repo.key}\n→ ${d.repo.remoteUrl}`);
      g.append("text")
        .attr("x", MARGIN.left - 12)
        .attr("y", 4)
        .attr("text-anchor", "end")
        .attr("fill", "var(--fg)")
        .attr("font-size", "12px")
        .attr("font-family", "var(--font-mono)")
        .text((d) => truncate(d.repo.shortName, NAME_MAX));
      return g;
    });

  // category dividers
  const categoryHeads = lanes.filter((l) => l.isCategoryHead);
  labelGroup
    .selectAll<SVGTextElement, LaneDatum>("text.category")
    .data(categoryHeads, (d) => d.repo.category)
    .join("text")
    .attr("class", "category")
    .attr("x", 12)
    .attr("y", (d) => d.y - LANE_HEIGHT / 2 + 4)
    .attr("fill", "var(--fg-muted)")
    .attr("font-size", "11px")
    .attr("font-weight", "600")
    .attr("text-transform", "uppercase")
    .attr("letter-spacing", "0.04em")
    .text((d) => d.repo.category);

  // x axis group
  const xAxisGroup = root
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0, -6)`)
    .attr("color", "var(--fg-muted)");

  // version polylines (behind commits)
  const versionLineGroup = root
    .append("g")
    .attr("class", "version-lines")
    .attr("clip-path", "url(#plot-clip)");

  // commits group
  const commitsGroup = root
    .append("g")
    .attr("class", "commits")
    .attr("clip-path", "url(#plot-clip)");

  // version rings (above commits, so they remain visible around dots)
  const versionRingGroup = root
    .append("g")
    .attr("class", "version-rings")
    .attr("clip-path", "url(#plot-clip)");

  // Data preparation: flatten commits with repo y-coordinate
  type CommitDatum = {
    repo: RepoData;
    commit: CommitRecord;
    isPinned: boolean;
    y: number;
    date: Date;
  };
  const allCommits: CommitDatum[] = [];
  for (const repo of dataset.repos) {
    const lane = repoIndex.get(repo.key);
    if (!lane) continue;
    for (const commit of repo.commits) {
      allCommits.push({
        repo,
        commit,
        isPinned: commit.sha === repo.pinnedSha,
        y: lane.y,
        date: new Date(commit.date),
      });
    }
  }

  // pinned commits last so they paint on top
  allCommits.sort((a, b) =>
    a.isPinned === b.isPinned ? 0 : a.isPinned ? 1 : -1,
  );

  // pre-compute pinned-commit datum per repo for off-view indicators
  type OffViewDatum = {
    repo: RepoData;
    commit: CommitRecord;
    y: number;
    date: Date;
    side: "left" | "right";
  };
  const pinnedByRepo = new Map<string, CommitDatum>();
  for (const cd of allCommits) {
    if (cd.isPinned) pinnedByRepo.set(cd.repo.key, cd);
  }

  // index repos by key for quick commit lookup
  const repoByKey = new Map<string, RepoData>(
    dataset.repos.map((r) => [r.key, r] as const),
  );

  // pre-compute, for each autoware version, the list of (date, y) points to
  // draw rings around / connect with a polyline. Sorted by lane order.
  type OverlayPoint = {
    repoKey: string;
    sha: string;
    pinnedVersion: string;
    date: Date;
    y: number;
    repo: RepoData;
    commit: CommitRecord;
  };
  const overlayPointsByVersion = new Map<string, OverlayPoint[]>();
  for (const v of dataset.versions ?? []) {
    const pts: OverlayPoint[] = [];
    for (const pin of v.pins as VersionPin[]) {
      const lane = repoIndex.get(pin.repoKey);
      const repo = repoByKey.get(pin.repoKey);
      if (!lane || !repo) continue;
      const commit = repo.commits.find((c) => c.sha === pin.sha);
      if (!commit) continue;
      pts.push({
        repoKey: pin.repoKey,
        sha: pin.sha,
        pinnedVersion: pin.pinnedVersion,
        date: new Date(commit.date),
        y: lane.y,
        repo,
        commit,
      });
    }
    pts.sort((a, b) => a.y - b.y);
    overlayPointsByVersion.set(v.tag, pts);
  }

  // selection state
  let selectedVersionTags = new Set<string>();

  // Base scales — set when we know width
  const xBase = scaleTime();
  let xCurrent = xBase.copy();

  let width = 0;

  function applyWidth(w: number): void {
    width = Math.max(0, w - MARGIN.left - MARGIN.right);
    // reversed range: newest dates render at x=0 (left), oldest at x=width (right)
    xBase.range([width, 0]);
    xCurrent.range([width, 0]);
    defs.select("rect").attr("width", width);
    captureRect.attr("width", width);
    lanesGroup.selectAll<SVGLineElement, LaneDatum>("line.lane").attr("x2", width);
  }

  function setBaseDomain(domain: [Date, Date]): void {
    xBase.domain(domain);
    xCurrent = xBase.copy();
  }

  function render(): void {
    // axis (drawn above the plot area)
    const axis = axisTop<Date>(xCurrent)
      .ticks(Math.max(4, Math.floor(width / 110)))
      .tickSizeOuter(0);
    xAxisGroup.call(axis);
    xAxisGroup
      .selectAll("text")
      .attr("fill", "var(--fg-muted)")
      .attr("font-size", "11px");
    xAxisGroup.selectAll("path, line").attr("stroke", "var(--border)");

    // viewport-cull commits
    const [d0, d1] = xCurrent.domain();
    const visible = allCommits.filter((d) => d.date >= d0 && d.date <= d1);

    const sel = commitsGroup
      .selectAll<SVGCircleElement, CommitDatum>("circle.commit")
      .data(visible, (d) => `${d.repo.key}|${d.commit.sha}`);

    sel.exit().remove();

    const enter = sel
      .enter()
      .append("circle")
      .attr("class", (d) => "commit" + (d.isPinned ? " pinned" : ""))
      .attr("r", (d) => (d.isPinned ? PINNED_RADIUS : COMMIT_RADIUS))
      .attr("fill", (d) => (d.isPinned ? "var(--accent)" : "var(--commit)"))
      .attr("stroke", (d) => (d.isPinned ? "var(--bg)" : "none"))
      .attr("stroke-width", (d) => (d.isPinned ? 2 : 0))
      .style("cursor", "pointer")
      .on("mouseover", function (this: SVGCircleElement, event: MouseEvent, d: CommitDatum) {
        select(this)
          .attr("r", d.isPinned ? PINNED_RADIUS + 2 : COMMIT_RADIUS + 2)
          .attr("fill", d.isPinned ? "var(--accent)" : "var(--commit-hover)");
        callbacks.onHover({
          repo: d.repo,
          commit: d.commit,
          isPinned: d.isPinned,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mousemove", (event: MouseEvent, d: CommitDatum) => {
        callbacks.onHover({
          repo: d.repo,
          commit: d.commit,
          isPinned: d.isPinned,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mouseout", function (this: SVGCircleElement, _event: MouseEvent, d: CommitDatum) {
        select(this)
          .attr("r", d.isPinned ? PINNED_RADIUS : COMMIT_RADIUS)
          .attr("fill", d.isPinned ? "var(--accent)" : "var(--commit)");
        callbacks.onLeave();
      })
      .on("click", (_event: MouseEvent, d: CommitDatum) => {
        window.open(d.commit.url, "_blank", "noopener,noreferrer");
      });

    enter
      .merge(sel)
      .attr("cx", (d) => xCurrent(d.date))
      .attr("cy", (d) => d.y);

    // off-view pinned indicators: hollow accent rings at the lane edge for
    // each repo whose pinned commit lies outside the visible domain.
    // Reversed range: newer-than-d1 → off the LEFT edge; older-than-d0 → off
    // the RIGHT edge.
    const offMarkers: OffViewDatum[] = [];
    for (const pinned of pinnedByRepo.values()) {
      if (pinned.date > d1) {
        offMarkers.push({
          repo: pinned.repo,
          commit: pinned.commit,
          y: pinned.y,
          date: pinned.date,
          side: "left",
        });
      } else if (pinned.date < d0) {
        offMarkers.push({
          repo: pinned.repo,
          commit: pinned.commit,
          y: pinned.y,
          date: pinned.date,
          side: "right",
        });
      }
    }

    const offSel = commitsGroup
      .selectAll<SVGCircleElement, OffViewDatum>("circle.offview")
      .data(offMarkers, (d) => d.repo.key);

    offSel.exit().remove();

    const offEnter = offSel
      .enter()
      .append("circle")
      .attr("class", "offview")
      .attr("r", PINNED_RADIUS - 1)
      .attr("fill", "none")
      .attr("stroke", "var(--accent)")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseover", function (this: SVGCircleElement, event: MouseEvent, d: OffViewDatum) {
        select(this).attr("stroke-width", 3);
        callbacks.onHover({
          repo: d.repo,
          commit: d.commit,
          isPinned: true,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mousemove", (event: MouseEvent, d: OffViewDatum) => {
        callbacks.onHover({
          repo: d.repo,
          commit: d.commit,
          isPinned: true,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mouseout", function (this: SVGCircleElement) {
        select(this).attr("stroke-width", 2);
        callbacks.onLeave();
      })
      .on("click", (_event: MouseEvent, d: OffViewDatum) => {
        window.open(d.commit.url, "_blank", "noopener,noreferrer");
      });

    const edgeInset = PINNED_RADIUS + 2;
    offEnter
      .merge(offSel)
      .attr("cx", (d) => (d.side === "left" ? edgeInset : width - edgeInset))
      .attr("cy", (d) => d.y);

    // ---- version overlays (polylines + rings around pinned commits) ----
    type SelectedOverlay = {
      version: AutowareVersion;
      points: OverlayPoint[];
      idx: number; // index among the currently-selected versions
    };
    const orderedVersions = (dataset.versions ?? []).filter((v) =>
      selectedVersionTags.has(v.tag),
    );
    const selectedOverlays: SelectedOverlay[] = orderedVersions.map(
      (version, idx) => ({
        version,
        points: overlayPointsByVersion.get(version.tag) ?? [],
        idx,
      }),
    );

    // polylines
    const lineSel = versionLineGroup
      .selectAll<SVGPathElement, SelectedOverlay>("path.version-line")
      .data(selectedOverlays, (d) => d.version.tag);
    lineSel.exit().remove();
    const lineEnter = lineSel
      .enter()
      .append("path")
      .attr("class", "version-line")
      .attr("fill", "none")
      .attr("stroke-width", 1.6)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("opacity", 0.85)
      .style("pointer-events", "none");

    lineEnter
      .merge(lineSel)
      .attr("stroke", (d) => d.version.color)
      .attr("d", (d) => {
        if (d.points.length === 0) return "";
        const segs = d.points.map(
          (p) => `${xCurrent(p.date).toFixed(2)},${p.y.toFixed(2)}`,
        );
        return "M" + segs.join("L");
      });

    // rings
    type RingDatum = {
      version: AutowareVersion;
      point: OverlayPoint;
      idx: number;
    };
    const ringData: RingDatum[] = [];
    for (const o of selectedOverlays) {
      for (const p of o.points) {
        ringData.push({ version: o.version, point: p, idx: o.idx });
      }
    }
    const ringSel = versionRingGroup
      .selectAll<SVGCircleElement, RingDatum>("circle.version-ring")
      .data(ringData, (d) => `${d.version.tag}|${d.point.repoKey}`);
    ringSel.exit().remove();
    const ringEnter = ringSel
      .enter()
      .append("circle")
      .attr("class", "version-ring")
      .attr("fill", "none")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseover", function (
        this: SVGCircleElement,
        event: MouseEvent,
        d: RingDatum,
      ) {
        select(this).attr("stroke-width", 3);
        callbacks.onHover({
          repo: d.point.repo,
          commit: d.point.commit,
          isPinned: d.point.sha === d.point.repo.pinnedSha,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mousemove", (event: MouseEvent, d: RingDatum) => {
        callbacks.onHover({
          repo: d.point.repo,
          commit: d.point.commit,
          isPinned: d.point.sha === d.point.repo.pinnedSha,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      })
      .on("mouseout", function (this: SVGCircleElement) {
        select(this).attr("stroke-width", 2);
        callbacks.onLeave();
      })
      .on("click", (_event: MouseEvent, d: RingDatum) => {
        window.open(d.point.commit.url, "_blank", "noopener,noreferrer");
      });

    ringEnter
      .merge(ringSel)
      .attr("stroke", (d) => d.version.color)
      .attr("r", (d) => 9 + d.idx * 2.5)
      .attr("cx", (d) => xCurrent(d.point.date))
      .attr("cy", (d) => d.point.y);
  }

  function setSelectedVersions(tags: Iterable<string>): void {
    selectedVersionTags = new Set(tags);
    render();
  }

  // Zoom behavior — X only. Attached to the inner `root` group so the cursor
  // coordinates d3-zoom uses for anchoring are in the same local space as
  // xBase's range; otherwise the wheel anchor is offset by MARGIN.left.
  const z: ZoomBehavior<SVGGElement, unknown> = zoom<SVGGElement, unknown>()
    .scaleExtent([1, 400])
    .on("zoom", (event) => {
      const t: ZoomTransform = event.transform;
      xCurrent = t.rescaleX(xBase);
      render();
    })
    .on("start", () => captureRect.style("cursor", "grabbing"))
    .on("end", () => captureRect.style("cursor", "grab"));

  root.call(z);

  // disable double-click zoom (it's annoying when clicking commits near each other)
  root.on("dblclick.zoom", null);

  function setDomain(domain: [Date, Date]): void {
    // domain = [oldest, newest]; with reversed range, newest lands at screen x=0 (left).
    const [d0, d1] = domain;
    const fullSpan = +xBase.domain()[1] - +xBase.domain()[0];
    const subSpan = +d1 - +d0;
    if (fullSpan <= 0 || subSpan <= 0 || width <= 0) return;
    const k = fullSpan / subSpan;
    // place d1 (newest) at zoomed x=0: k * xBase(d1) + tx = 0
    const tx = -k * xBase(d1)!;
    const t = zoomIdentity.translate(tx, 0).scale(k);
    root.transition().duration(400).call(z.transform, t);
  }

  function resize(): void {
    const rect = svgEl.getBoundingClientRect();
    applyWidth(rect.width);
    render();
  }

  // initial setup: base domain spans all data
  setBaseDomain([dataMin, dataMax]);
  applyWidth(svgEl.getBoundingClientRect().width || 1200);
  // start at identity (showing entire range), caller will likely call setDomain with initial preset
  render();

  return {
    setDomain,
    setSelectedVersions,
    resize,
    destroy() {
      root.on(".zoom", null);
      svg.selectAll("*").remove();
    },
  };
}

export type { TimelineCallbacks };
