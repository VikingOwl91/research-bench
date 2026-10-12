<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { FileText, ChevronLeft, ChevronRight, X, ArrowUpRight } from 'lucide-svelte';
  import type { Source, Citation } from '#lib/types.ts';
  export let source: Source;
  export let citation: Citation | undefined = undefined;
  export let onClose: () => void;
  let pageNumber = citation?.page ?? source.pages[0]?.page ?? 1;
  let marker: HTMLElement | undefined;
  // The parent remounts this viewer for every explicit selection, including re-clicks.
  // Citation IDs are request-local and cannot identify a navigation event.
  onMount(() => { void focusMark(); });
  $: page = source.pages.find((item) => item.page === pageNumber);
  $: validSpan = !!(page && citation && citation.page === pageNumber && citation.start >= 0 && citation.end > citation.start && citation.end <= page.text.length && page.text.slice(citation.start, citation.end) === citation.text);
  async function focusMark() {
    await tick();
    marker?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    marker?.focus({ preventScroll: true });
  }
</script>

<div class="source-viewer">
  <header class="viewer-header">
    <div class="viewer-title"><div class="file-icon"><FileText size={19}/></div><div><strong>{source.name}</strong><span>Extrahierter Quelltext · {source.pages.length} {source.pages.length === 1 ? 'Seite' : 'Seiten'}</span></div></div>
    <button class="icon-button" onclick={onClose} aria-label="Quellenansicht schließen"><X size={18}/></button>
  </header>
  <div class="page-navigation">
    <span class="eyebrow">QUELLENANSICHT</span>
    <div class="page-controls"><button class="icon-button" disabled={pageNumber <= 1} onclick={() => pageNumber -= 1} aria-label="Vorherige Seite"><ChevronLeft size={16}/></button><span>Seite {pageNumber} / {source.pages.length}</span><button class="icon-button" disabled={pageNumber >= source.pages.length} onclick={() => pageNumber += 1} aria-label="Nächste Seite"><ChevronRight size={16}/></button></div>
  </div>
  {#if citation}
    <div class="source-notice"><ArrowUpRight size={15}/><span>{validSpan ? 'Der zitierte Ausschnitt ist im Quelltext markiert.' : 'Auf dieser Seite ist keine gültige Markierung verfügbar.'}</span></div>
  {/if}
  <div class="source-scroll">
    <article class="source-paper">
      <div class="paper-heading"><span>{source.name}</span><span>{String(pageNumber).padStart(2, '0')}</span></div>
      {#if page}
        <div class="page-text">{#if validSpan && citation}{page.text.slice(0, citation.start)}<mark bind:this={marker} tabindex="-1">{page.text.slice(citation.start, citation.end)}</mark>{page.text.slice(citation.end)}{:else}{page.text}{/if}</div>
      {:else}<p class="muted">Diese Seite ist nicht verfügbar.</p>{/if}
    </article>
  </div>
</div>
