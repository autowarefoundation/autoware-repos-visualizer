<script lang="ts">
  import type { RangeKey } from "../lib/types";
  import { RANGE_KEYS } from "../lib/range";

  export let value: RangeKey = "6M";
  export let onChange: (key: RangeKey) => void;
</script>

<div class="range-picker" role="tablist" aria-label="Time range">
  {#each RANGE_KEYS as key (key)}
    <button
      type="button"
      role="tab"
      aria-selected={value === key}
      class:active={value === key}
      on:click={() => onChange(key)}
    >
      {key}
    </button>
  {/each}
</div>

<style>
  .range-picker {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--bg-muted);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  button {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--fg-muted);
    padding: 4px 10px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition: background-color 120ms ease, color 120ms ease;
  }

  button:hover {
    color: var(--fg);
  }

  button.active {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
