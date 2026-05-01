<script lang="ts">
  import { onMount } from "svelte";
  import RangePicker from "./components/RangePicker.svelte";
  import Timeline from "./components/Timeline.svelte";
  import Tooltip from "./components/Tooltip.svelte";
  import type { Dataset, HoverPayload, RangeKey } from "./lib/types";
  import { parseRangeFromQuery, writeRangeToQuery } from "./lib/range";
  import { formatDateTime } from "./lib/format";

  let dataset: Dataset | null = null;
  let loadError: string | null = null;
  let range: RangeKey = parseRangeFromQuery();
  let hover: HoverPayload | null = null;

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
</script>

<header class="app-header">
  <div class="title-block">
    <h1>autoware repos pin tracker</h1>
    {#if dataset}
      <span class="meta">
        snapshot · generated {formatDateTime(dataset.generatedAt)} · full history
      </span>
    {/if}
  </div>
  <div class="controls">
    <span class="legend">
      <span class="dot dot-commit"></span> commit
      <span class="dot dot-pinned"></span> pinned in <code>autoware.repos</code>
    </span>
    <RangePicker value={range} onChange={handleRangeChange} />
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
    <Timeline
      {dataset}
      {range}
      onHover={handleHover}
      onLeave={handleLeave}
    />
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

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    padding: 16px 24px 32px;
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
