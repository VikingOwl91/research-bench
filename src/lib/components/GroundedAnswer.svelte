<script lang="ts">
  import { displaySourceName } from '#lib/display-source-name.ts';
  import { locale, t } from '#lib/i18n/store.ts';
  import { formatNumber } from '#lib/i18n/index.ts';
  import { FileText } from 'lucide-svelte';
  import type { GroundedAnswer, Citation } from '#lib/types.ts';
  export let answer: GroundedAnswer;
  export let citations: Citation[];
  export let onCitation: (citation: Citation) => void;
  export let availableSourceIds: string[] = [];
</script>

<div class="grounded-answer">
  {#if answer.title}<h3 class="answer-title">{answer.title}</h3>{/if}
  {#each answer.blocks as block}
    <section class="answer-block">
      {#if block.heading}<h4>{block.heading}</h4>{/if}
      <p>{block.text}</p>
      {#if block.citationIds.length}
        <div class="citations" aria-label={$t('components.citations')}>
          {#each block.citationIds as id}
            {@const citation = citations.find((item) => item.id === id)}
            {#if citation}
              <button class="citation" disabled={!availableSourceIds.includes(citation.sourceId)} onclick={() => onCitation(citation)} title={`${displaySourceName(citation.sourceName)} · ${$t('components.citation.page', { page: citation.page })}\n${citation.text}`}>
                <FileText size={11}/><span><bdi>{displaySourceName(citation.sourceName)}</bdi> · {formatNumber($locale, citation.page)}</span>
                {#if !availableSourceIds.includes(citation.sourceId)}<span>{$t('components.citation.removed')}</span>{/if}
              </button>
            {:else}
              <span class="muted small">{$t('components.citation.unavailable')}</span>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>
