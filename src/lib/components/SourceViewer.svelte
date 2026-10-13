<script lang="ts">
  import { displaySourceName } from '#lib/display-source-name.ts';
  import { t } from '#lib/i18n/store.ts';
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
    <div class="viewer-title"><div class="file-icon"><FileText size={19}/></div><div><strong><bdi>{displaySourceName(source.name)}</bdi></strong><span>{$t(source.pages.length === 1 ? 'components.viewer.description.one' : 'components.viewer.description.many', { count: source.pages.length })}</span></div></div>
    <button class="icon-button" onclick={onClose} aria-label={$t('components.viewer.close')}><X size={18}/></button>
  </header>
  <div class="page-navigation">
    <span class="eyebrow">{$t('components.viewer.heading')}</span>
    <div class="page-controls"><button class="icon-button" disabled={pageNumber <= 1} onclick={() => pageNumber -= 1} aria-label={$t('components.viewer.previous')}><ChevronLeft size={16}/></button><span>{$t('components.viewer.page', { page: pageNumber, count: source.pages.length })}</span><button class="icon-button" disabled={pageNumber >= source.pages.length} onclick={() => pageNumber += 1} aria-label={$t('components.viewer.next')}><ChevronRight size={16}/></button></div>
  </div>
  {#if citation}
    <div class="source-notice"><ArrowUpRight size={15}/><span>{$t(validSpan ? 'components.viewer.highlight' : 'components.viewer.noHighlight')}</span></div>
  {/if}
  <div class="source-scroll">
    <article class="source-paper">
      <div class="paper-heading"><span><bdi>{displaySourceName(source.name)}</bdi></span><span>{String(pageNumber).padStart(2, '0')}</span></div>
      {#if page}
        <div class="page-text">{#if validSpan && citation}{page.text.slice(0, citation.start)}<mark bind:this={marker} tabindex="-1">{page.text.slice(citation.start, citation.end)}</mark>{page.text.slice(citation.end)}{:else}{page.text}{/if}</div>
      {:else}<p class="muted">{$t('components.viewer.unavailable')}</p>{/if}
    </article>
  </div>
</div>
