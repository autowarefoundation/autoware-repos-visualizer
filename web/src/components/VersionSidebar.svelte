<script lang="ts">
  import type { AutowareVersion } from "../lib/types";
  import { formatDate } from "../lib/format";

  export let versions: AutowareVersion[];
  export let selected: Set<string>;
  export let onChange: (next: Set<string>) => void;

  // newest first
  $: ordered = [...versions].sort((a, b) =>
    a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0,
  );

  function toggle(tag: string): void {
    const next = new Set(selected);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(next);
  }

  function showAll(): void {
    onChange(new Set(versions.map((v) => v.tag)));
  }

  function hideAll(): void {
    onChange(new Set());
  }

  function label(v: AutowareVersion): string {
    return v.isMain ? "main" : v.tag;
  }
</script>

<aside class="sidebar" aria-label="Autoware versions">
  <header>
    <span class="title">autoware versions</span>
    <span class="hint">click to highlight pinned commits</span>
  </header>
  <div class="actions">
    <button type="button" on:click={showAll}>show all</button>
    <button type="button" on:click={hideAll} disabled={selected.size === 0}>
      hide all
    </button>
    <span class="count">{selected.size} / {versions.length}</span>
  </div>
  <ul>
    {#each ordered as v (v.tag)}
      {@const isSelected = selected.has(v.tag)}
      <li>
        <button
          type="button"
          class:selected={isSelected}
          class:main={v.isMain}
          on:click={() => toggle(v.tag)}
          aria-pressed={isSelected}
        >
          <span class="swatch" style="background: {v.color}"></span>
          <span class="tag">{label(v)}</span>
          <span class="date">{formatDate(v.releasedAt)}</span>
          <span class="pins">{v.pins.length}</span>
        </button>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-muted);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .hint {
    font-size: 11px;
    color: var(--fg-muted);
    opacity: 0.85;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }

  .actions button {
    appearance: none;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .actions button:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .count {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-muted);
    font-family: var(--font-mono);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    overflow-y: auto;
    min-height: 0;
  }

  li button {
    appearance: none;
    width: 100%;
    background: transparent;
    border: none;
    color: var(--fg);
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding: 5px 14px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    transition: background-color 80ms ease;
  }

  li button:hover {
    background: var(--bg-elev);
  }

  li button.selected {
    background: var(--bg-elev);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, currentColor 25%, transparent);
  }

  .tag {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  li button.main .tag {
    font-weight: 700;
  }

  .date {
    font-size: 10.5px;
    color: var(--fg-muted);
    font-family: var(--font-mono);
  }

  .pins {
    font-size: 10px;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
</style>
