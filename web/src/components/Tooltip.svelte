<script lang="ts">
  import type { HoverPayload } from "../lib/types";
  import { formatDateTime } from "../lib/format";

  export let payload: HoverPayload | null;

  const OFFSET_X = 14;
  const OFFSET_Y = 14;
  const TIP_WIDTH = 360;
  const TIP_HEIGHT = 140;

  $: position = computePosition(payload);

  function computePosition(p: HoverPayload | null): { left: number; top: number } {
    if (!p) return { left: -9999, top: -9999 };
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = p.clientX + OFFSET_X;
    let top = p.clientY + OFFSET_Y;
    if (left + TIP_WIDTH > w) left = p.clientX - TIP_WIDTH - OFFSET_X;
    if (top + TIP_HEIGHT > h) top = p.clientY - TIP_HEIGHT - OFFSET_Y;
    return { left, top };
  }
</script>

{#if payload}
  <div
    class="tooltip"
    class:pinned={payload.isPinned}
    style="left: {position.left}px; top: {position.top}px;"
  >
    <div class="row repo">
      <span class="cat">{payload.repo.category}</span>
      <span class="key">{payload.repo.key}</span>
    </div>
    <div class="row sha">
      <code>{payload.commit.short}</code>
      <span class="dot">·</span>
      <span class="date">{formatDateTime(payload.commit.date)}</span>
      <span class="dot">·</span>
      <span class="author">{payload.commit.authorName}</span>
    </div>
    <div class="row subject">{payload.commit.subject}</div>
    {#if payload.isPinned}
      <div class="row pinned-row">
        <span class="badge">PINNED</span>
        <span>
          <strong>{payload.repo.pinnedVersion}</strong>
          <span class="kind">({payload.repo.pinnedRefKind})</span>
        </span>
      </div>
    {/if}
    <div class="row hint">click bubble → open commit on GitHub</div>
  </div>
{/if}

<style>
  .tooltip {
    position: fixed;
    pointer-events: none;
    z-index: 100;
    width: 360px;
    background: var(--tooltip-bg);
    color: var(--tooltip-fg);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.5;
    box-shadow: var(--shadow);
  }

  .tooltip.pinned {
    border: 1.5px solid var(--accent);
  }

  .row + .row {
    margin-top: 4px;
  }

  .repo {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .cat {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .key {
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.75;
  }

  .sha {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    opacity: 0.85;
  }

  .sha code {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .dot {
    opacity: 0.4;
  }

  .subject {
    font-weight: 500;
    word-break: break-word;
  }

  .pinned-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 6px;
    margin-top: 8px !important;
    border-top: 1px solid rgba(128, 128, 128, 0.25);
  }

  .badge {
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .kind {
    opacity: 0.6;
  }

  .hint {
    margin-top: 6px !important;
    font-size: 10px;
    opacity: 0.5;
  }
</style>
