import { axisTop } from "d3-axis";
import { scaleTime } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import type { CommitRecord, Dataset, HoverPayload, RepoData } from "./types";

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

  // commits group
  const commitsGroup = root
    .append("g")
    .attr("class", "commits")
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
  }

  // Zoom behavior — X only
  const z: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 400])
    .on("zoom", (event) => {
      const t: ZoomTransform = event.transform;
      xCurrent = t.rescaleX(xBase);
      render();
    });

  svg.call(z);

  // disable double-click zoom (it's annoying when clicking commits near each other)
  svg.on("dblclick.zoom", null);

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
    svg.transition().duration(400).call(z.transform, t);
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
    resize,
    destroy() {
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
    },
  };
}

export type { TimelineCallbacks };
