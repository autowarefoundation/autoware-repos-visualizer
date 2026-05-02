<script lang="ts">
  import { onMount } from "svelte";
  import RangePicker from "./components/RangePicker.svelte";
  import Timeline from "./components/Timeline.svelte";
  import Tooltip from "./components/Tooltip.svelte";
  import VersionSidebar from "./components/VersionSidebar.svelte";
  import type { Dataset, HoverPayload, RangeKey } from "./lib/types";
  import { parseRangeFromQuery, writeRangeToQuery } from "./lib/range";
  import { formatDateTime } from "./lib/format";

  let dataset: Dataset | null = null;
  let loadError: string | null = null;
  let range: RangeKey = parseRangeFromQuery();
  let hover: HoverPayload | null = null;
  let selectedVersions: Set<string> = new Set();

  onMount(async () => {
    try {
      const url = `${import.meta.env.BASE_URL}data/commits.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dataset = await res.json();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  function handleRangeChange(next: RangeKey): void {
    range = next;
    writeRangeToQuery(next);
  }

  function handleHover(p: HoverPayload): void {
    hover = p;
  }

  function handleLeave(): void {
    hover = null;
  }

  function handleVersionsChange(next: Set<string>): void {
    selectedVersions = next;
  }
</script>

<header class="app-header">
  <div class="brand">
    <a
      class="logo-link"
      href="https://github.com/autowarefoundation/autoware"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Autoware Foundation upstream repository"
      title="autowarefoundation/autoware"
    >
      <img
        class="logo"
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        alt=""
      />
    </a>
    <div class="title-block">
      <h1>autoware repos pin tracker</h1>
      {#if dataset}
        <span class="meta">
          snapshot · generated {formatDateTime(dataset.generatedAt)} · full history
        </span>
      {/if}
    </div>
  </div>
  <div class="controls">
    <span class="legend">
      <span class="dot dot-commit"></span> commit
      <span class="dot dot-pinned"></span> pinned in <code>autoware.repos</code>
    </span>
    <RangePicker value={range} onChange={handleRangeChange} />
    <a
      class="repo-link"
      href="https://github.com/autowarefoundation/autoware-repos-visualizer"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View source on GitHub"
      title="View source on GitHub"
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    </a>
  </div>
</header>

<main>
  {#if loadError}
    <div class="error">
      <p>Failed to load <code>data/commits.json</code>: {loadError}</p>
      <p class="hint">
        Run <code>npm run data</code> from the <code>web/</code> directory to
        generate it.
      </p>
    </div>
  {:else if dataset}
    <div class="layout">
      <div class="chart">
        <Timeline
          {dataset}
          {range}
          {selectedVersions}
          onHover={handleHover}
          onLeave={handleLeave}
        />
      </div>
      <VersionSidebar
        versions={dataset.versions}
        selected={selectedVersions}
        onChange={handleVersionsChange}
      />
    </div>
  {:else}
    <div class="loading">loading commits…</div>
  {/if}
</main>

<Tooltip payload={hover} />

<style>
  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 24px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .logo-link {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    border-radius: 6px;
    padding: 4px;
    margin: -4px;
    transition: background-color 100ms ease;
    color: var(--fg);
  }

  .logo-link:hover {
    background: var(--bg-muted);
  }

  .logo {
    width: 36px;
    height: 36px;
    display: block;
  }

  @media (prefers-color-scheme: dark) {
    .logo {
      filter: invert(1);
    }
  }

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .meta {
    font-size: 11px;
    color: var(--fg-muted);
    font-family: var(--font-mono);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .repo-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    color: var(--fg-muted);
    text-decoration: none;
    transition:
      color 100ms ease,
      background-color 100ms ease;
  }

  .repo-link:hover {
    color: var(--fg);
    background: var(--bg-muted);
  }

  .repo-link svg {
    width: 22px;
    height: 22px;
    display: block;
  }

  .legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--fg-muted);
  }

  .legend code {
    font-size: 10.5px;
  }

  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 4px;
  }

  .dot-commit {
    background: var(--commit);
  }

  .dot-pinned {
    background: var(--accent);
    border: 1.5px solid var(--bg);
    box-shadow: 0 0 0 1.5px var(--accent);
    margin-left: 8px;
  }

  main {
    padding: 0;
  }

  .layout {
    display: flex;
    align-items: stretch;
    min-height: calc(100vh - 60px);
  }

  .chart {
    flex: 1;
    min-width: 0;
    padding: 16px 0 32px 24px;
  }

  .loading,
  .error {
    padding: 48px 0;
    text-align: center;
    color: var(--fg-muted);
  }

  .error code {
    background: var(--bg-muted);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
  }

  .error p {
    margin: 6px 0;
  }

  .hint {
    font-size: 12px;
  }
</style>
