<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createTimeline, type Timeline } from "../lib/timeline";
  import type { Dataset, HoverPayload, RangeKey } from "../lib/types";
  import { rangeToDomain } from "../lib/range";

  export let dataset: Dataset;
  export let range: RangeKey;
  export let selectedVersions: Set<string> = new Set();
  export let onHover: (p: HoverPayload) => void;
  export let onLeave: () => void;

  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let timeline: Timeline | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let dataMin: Date = new Date();

  $: if (timeline) {
    timeline.setDomain(rangeToDomain(range, dataMin));
  }

  $: if (timeline) {
    timeline.setSelectedVersions(selectedVersions);
  }

  onMount(() => {
    let earliest = new Date();
    for (const r of dataset.repos) {
      for (const c of r.commits) {
        const d = new Date(c.date);
        if (d < earliest) earliest = d;
      }
    }
    dataMin = earliest;

    timeline = createTimeline(svgEl, dataset, { onHover, onLeave });
    timeline.setDomain(rangeToDomain(range, dataMin));
    timeline.setSelectedVersions(selectedVersions);

    resizeObserver = new ResizeObserver(() => {
      timeline?.resize();
      timeline?.setDomain(rangeToDomain(range, dataMin));
    });
    resizeObserver.observe(containerEl);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    timeline?.destroy();
  });
</script>

<div class="timeline-wrap" bind:this={containerEl}>
  <svg bind:this={svgEl} class="timeline" />
</div>

<style>
  .timeline-wrap {
    width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    padding-bottom: 16px;
  }

  .timeline {
    display: block;
    width: 100%;
    user-select: none;
  }

  :global(.timeline circle.commit) {
    transition:
      r 80ms ease,
      fill 80ms ease;
  }

  :global(.timeline .x-axis path.domain) {
    stroke: var(--border);
  }

  :global(.timeline g.label text) {
    transition:
      fill 100ms ease,
      text-decoration-color 100ms ease;
    text-decoration: underline transparent;
    text-underline-offset: 3px;
  }

  :global(.timeline g.label:hover text) {
    fill: var(--accent) !important;
    text-decoration-color: var(--accent);
  }
</style>
