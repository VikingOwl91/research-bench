<script lang="ts">
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
        <div class="citations" aria-label="Quellenbelege">
          {#each block.citationIds as id}
            {@const citation = citations.find((item) => item.id === id)}
            {#if citation}
              <button class="citation" disabled={!availableSourceIds.includes(citation.sourceId)} onclick={() => onCitation(citation)} title={`${citation.sourceName} · Seite ${citation.page}\n${citation.text}`}>
                <FileText size={11}/><span>{citation.sourceName} · {citation.page}</span>
                {#if !availableSourceIds.includes(citation.sourceId)}<span>(entfernt)</span>{/if}
              </button>
            {:else}
              <span class="muted small">Beleg nicht verfügbar</span>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>
