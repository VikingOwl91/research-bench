<script lang="ts">
  import { displaySourceName } from '#lib/display-source-name.ts';
  import { t } from '#lib/i18n/store.ts';
  import { onMount, tick } from 'svelte';
  import { FileText, ChevronLeft, ChevronRight, X, ArrowUpRight } from 'lucide-svelte';
  import type { Citation, HiddenSpan, Source } from '#lib/types.ts';
  export let source: Source;
  export let citation: Citation | undefined = undefined;
  export let onClose: () => void;
  let pageNumber = citation?.page ?? source.pages[0]?.page ?? 1;
  let marker: HTMLElement | undefined;
  let heading: HTMLElement;
  interface Segment { text: string; hidden: boolean; cited: boolean }
  // The parent remounts this viewer for every explicit selection, including re-clicks.
  // Citation IDs are request-local and cannot identify a navigation event.
  onMount(() => { void focusMark(); });
  $: page = source.pages.find((item) => item.page === pageNumber);
  $: validSpan = !!(page && citation && citation.page === pageNumber && citation.start >= 0 && citation.end > citation.start && citation.end <= page.text.length && page.text.slice(citation.start, citation.end) === citation.text);
  $: hasHiddenText = !!page?.hiddenSpans?.length;
  $: textlessPages = source.kind === 'pdf' ? source.pages.filter((item) => !item.text.trim()).length : 0;
  // Split the page text into segments marked by hidden spans and the cited span.
  $: segments = buildSegments(page?.text ?? '', page?.hiddenSpans ?? [], validSpan && citation ? citation : undefined);
  function buildSegments(text: string, hiddenSpans: HiddenSpan[], cited?: Citation): Segment[] {
    const boundaries = new Set<number>([0, text.length]);
    for (const span of hiddenSpans) {
      if (span.start >= 0 && span.end > span.start && span.end <= text.length) {
        boundaries.add(span.start);
        boundaries.add(span.end);
      }
    }
    if (cited && cited.end <= text.length) {
      boundaries.add(cited.start);
      boundaries.add(cited.end);
    }
    const points = [...boundaries].sort((a, b) => a - b);
    const segments: Segment[] = [];
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index], end = points[index + 1];
      if (end <= start) continue;
      const hidden = hiddenSpans.some((span) => span.start < end && start < span.end);
      const citedSpan = cited && cited.start < end && start < cited.end;
      segments.push({ text: text.slice(start, end), hidden, cited: !!citedSpan });
    }
    return segments;
  }
  async function focusMark() {
    await tick();
    marker?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    (marker ?? heading)?.focus({ preventScroll: true });
  }
</script>

<div id="research-content" class="source-viewer">
  <header class="viewer-header">
    <div class="viewer-title" tabindex="-1" bind:this={heading}><div class="file-icon"><FileText size={19}/></div><div><strong><bdi>{displaySourceName(source.name)}</bdi></strong><span>{$t(source.pages.length === 1 ? 'components.viewer.description.one' : 'components.viewer.description.many', { count: source.pages.length })}</span></div></div>
    <button class="icon-button" onclick={onClose} aria-label={$t('components.viewer.close')}><X size={18}/></button>
  </header>
  <div class="page-navigation">
    <span class="eyebrow">{$t('components.viewer.heading')}</span>
    <div class="page-controls"><button class="icon-button" disabled={pageNumber <= 1} onclick={() => pageNumber -= 1} aria-label={$t('components.viewer.previous')}><ChevronLeft size={16}/></button><span>{$t('components.viewer.page', { page: pageNumber, count: source.pages.length })}</span><button class="icon-button" disabled={pageNumber >= source.pages.length} onclick={() => pageNumber += 1} aria-label={$t('components.viewer.next')}><ChevronRight size={16}/></button></div>
  </div>
  {#if citation}
    <div class="source-notice"><ArrowUpRight size={15}/><span>{$t(validSpan ? 'components.viewer.highlight' : 'components.viewer.noHighlight')}</span></div>
  {/if}
  {#if hasHiddenText}
    <div class="source-notice hidden-text-legend"><span class="hidden-text-sample" aria-hidden="true">abc</span><span>{$t('components.viewer.hiddenText')}</span></div>
  {/if}
  {#if textlessPages > 0}
    <div class="source-notice"><span>{$t('components.viewer.textlessPages', { count: textlessPages, total: source.pages.length })}</span></div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable content needs keyboard access even without enabled descendant controls.) -->
<div class="source-scroll" tabindex="0" role="region" aria-label={$t('components.viewer.heading')}>
    <article class="source-paper">
      <div class="paper-heading"><span><bdi>{displaySourceName(source.name)}</bdi></span><span>{String(pageNumber).padStart(2, '0')}</span></div>
      {#if page}
        <div class="page-text">{#each segments as segment}{#if segment.cited}<mark bind:this={marker} tabindex="-1" class:pdf-hidden-text={segment.hidden}>{segment.text}</mark>{:else if segment.hidden}<span class="pdf-hidden-text">{segment.text}</span>{:else}{segment.text}{/if}{/each}</div>
      {:else}<p class="muted">{$t('components.viewer.unavailable')}</p>{/if}
    </article>
  </div>
</div>

<style>
  .pdf-hidden-text {
    text-decoration: underline dotted;
    text-decoration-color: var(--color-text-faint, #8a857c);
    text-underline-offset: 3px;
  }
  .hidden-text-sample {
    text-decoration: underline dotted;
    text-decoration-color: var(--color-text-faint, #8a857c);
    text-underline-offset: 3px;
    margin-right: 6px;
  }
</style>
