<script lang="ts">
  import { displaySourceName } from '#lib/display-source-name.ts';
  import { onDestroy } from 'svelte';
  import { Headphones, FileText, Check, Trash2, Volume2, Play } from 'lucide-svelte';
  import { locale, t } from '#lib/i18n/store.ts';
  import { formatNumber, type MessageKey } from '#lib/i18n/index.ts';
  import type { ResearchBenchController } from '#lib/controller.ts';
  import type { AppSnapshot, Citation, PodcastArtifact, PodcastLanguage, PodcastTiming } from '#lib/types.ts';

  export let controller: ResearchBenchController;
  export let state: AppSnapshot;
  export let onCitation: (citation: Citation) => void;
  export let onDelete: (episode: PodcastArtifact) => void;
  let language: PodcastLanguage = 'en';
  let audioUrl = '';
  let probeUrl = '';
  let loadedEpisodeId = '';
  let audioRequest = 0;
  let probeRequest = 0;
  let player: HTMLAudioElement;
  let probePlayer: HTMLAudioElement;
  let currentTime = 0;
  let speed = 'auto';
  let probeTimeline: PodcastTiming[] = [];
  let probeLanguage: PodcastLanguage = 'en';
  let loadingAudio = false;
  let audioError: MessageKey | '' = '';
  let destroyed = false;
  let probeIdentity = '';
  const locksAvailable = typeof navigator !== 'undefined' && !!navigator.locks;
  $: episodes = state.artifacts.filter((item): item is PodcastArtifact => item.kind === 'podcast' && item.script.language === language);
  $: finished = episodes.find((item) => item.status === 'ready');
  $: partial = episodes.find((item) => item.status !== 'ready');
  $: transcript = finished ?? partial;
  $: stale = !!(transcript && transcript.revision !== state.activeNotebook?.revision);
  $: availableSourceIds = state.sources.map((source) => source.id);
  $: activeTurnId = finished?.timeline?.find((timing) => currentTime >= timing.start && currentTime < timing.end)?.turnId;
  $: canCreate = !state.busy && state.hasKey && state.sources.length > 0 && locksAvailable;
  $: canResume = !!(partial && !state.busy && state.hasKey && locksAvailable && partial.provider === state.provider && partial.revision === state.activeNotebook?.revision);
  $: if ((finished?.id ?? '') !== loadedEpisodeId) loadAudio(finished);
  $: if (probeIdentity !== `${state.provider}:${state.hasKey}:${language}`) {
    probeIdentity = `${state.provider}:${state.hasKey}:${language}`;
    probeRequest += 1;
    clearProbe();
  }
  async function loadAudio(episode: PodcastArtifact | undefined) {
    const request = ++audioRequest;
    loadedEpisodeId = episode?.id ?? '';
    player?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = ''; currentTime = 0; audioError = ''; loadingAudio = !!episode;
    if (!episode) return;
    try {
      const blob = await controller.getPodcastAudio(episode.id);
      if (destroyed || request !== audioRequest) return;
      if (blob) audioUrl = URL.createObjectURL(blob);
      else audioError = 'components.podcast.error.missing';
    } catch {
      if (!destroyed && request === audioRequest) audioError = 'components.podcast.error.load';
    } finally { if (!destroyed && request === audioRequest) loadingAudio = false; }
  }
  function clearProbe() { probePlayer?.pause(); if (probeUrl) URL.revokeObjectURL(probeUrl); probeUrl = ''; probeTimeline = []; }
  async function probeVoices() {
    const request = ++probeRequest;
    clearProbe();
    const result = await controller.probePodcastVoices(language);
    if (!result || destroyed || request !== probeRequest) return;
    probeTimeline = result.audio.timeline; probeLanguage = language;
    probeUrl = URL.createObjectURL(result.audio.blob);
  }
  function seek(turnId: string) {
    const timing = finished?.timeline?.find((item) => item.turnId === turnId);
    if (player && timing) { player.currentTime = timing.start; currentTime = timing.start; applyPodcastSpeed(); }
  }
  function recommendedRate(audioLanguage: PodcastLanguage, speaker: 'A' | 'B') { return audioLanguage === 'de' ? 1.3 : speaker === 'A' ? 1.2 : 1; }
  function applyPodcastSpeed() {
    if (!player) return;
    player.preservesPitch = true;
    const timing = finished?.timeline?.find((entry) => player.currentTime >= entry.start && player.currentTime < entry.end);
    const speaker = finished?.script.turns.find((entry) => entry.id === timing?.turnId)?.speaker ?? 'A';
    player.playbackRate = speed === 'auto' ? recommendedRate(finished?.script.language ?? language, speaker) : Number(speed);
  }
  function applyProbeSpeed() {
    if (!probePlayer) return;
    probePlayer.preservesPitch = true;
    const turn = probeTimeline.find((entry) => probePlayer.currentTime >= entry.start && probePlayer.currentTime < entry.end);
    probePlayer.playbackRate = recommendedRate(probeLanguage, turn?.turnId === 'T2' ? 'B' : 'A');
  }
  function formatTime(value: number) { const seconds = Math.max(0, Math.floor(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  onDestroy(() => {
    destroyed = true; audioRequest += 1; probeRequest += 1;
    player?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    clearProbe();
  });
</script>

<div class="studio-content podcast-content">
  <div class="podcast-options"><label for="podcast-language">{$t('components.podcast.language')}</label><select id="podcast-language" bind:value={language} disabled={state.busy}><option value="en">{$t('components.podcast.english')}</option><option value="de">{$t('components.podcast.german')}</option></select><span>{$t('components.podcast.length')}</span></div>
  {#if language === 'de'}<p class="stale-note">{$t('components.podcast.experimental')}</p>{/if}
  <div class="podcast-voices"><span><Volume2 size={14}/>{$t('components.podcast.voices')}</span><button class="text-button" onclick={probeVoices} disabled={!state.hasKey || state.busy || !locksAvailable}>{$t('components.podcast.testVoices')}</button><p>{$t('components.podcast.probeNotice', { provider: $t(`components.provider.${state.provider}`) })}</p>{#if probeUrl}<audio bind:this={probePlayer} class="podcast-probe" controls src={probeUrl} aria-label={$t('components.podcast.probe')} preload="metadata" onloadedmetadata={applyProbeSpeed} ontimeupdate={applyProbeSpeed} onseeked={applyProbeSpeed}></audio><p>{$t('components.podcast.listen')}</p>{/if}</div>
  {#if !locksAvailable}<p class="stale-note" role="status">{$t('components.podcast.noLocks')}</p>{/if}
  {#if partial}
    <div class="podcast-draft"><div class="artifact-heading"><span class="eyebrow">{$t(partial.status === 'rendering' && state.busy ? 'components.podcast.rendering' : 'components.podcast.draft')}</span><span>{$t('components.podcast.progress', { completed: partial.completedTurnIds.length, total: partial.script.turns.length })}</span></div><strong>{partial.script.title}</strong><p>{$t(partial.completedTurnIds.length === 1 ? 'components.podcast.segments.one' : 'components.podcast.segments.many', { count: partial.completedTurnIds.length })}</p>{#if partial.revision !== state.activeNotebook?.revision}<p class="stale-note">{$t('components.podcast.changed')}</p>{:else if partial.provider !== state.provider}<p class="stale-note">{$t('components.podcast.resumeProvider', { provider: $t(`components.provider.${partial.provider}`) })}</p>{/if}<div class="podcast-draft-actions"><button class="button secondary small-button" onclick={() => controller.resumePodcast(partial.id)} disabled={!canResume}><Play size={12}/>{$t('components.podcast.resume')}</button><button class="icon-button" aria-label={$t('components.podcast.deleteDraft')} onclick={() => onDelete(partial)}><Trash2 size={14}/></button></div></div>
  {/if}
  {#if transcript}
    <div class="artifact-heading"><span class="eyebrow">{$t(finished ? 'components.podcast.yours' : 'components.podcast.transcript')}</span>{#if stale}<span class="stale-badge">{$t('components.podcast.sourcesChanged')}</span>{:else if finished}<span class="ready-badge"><Check size={11}/>{$t('components.podcast.created')}</span>{/if}</div>
    <h3 class="answer-title podcast-title">{transcript.script.title}</h3>
    {#if stale}<p class="stale-note">{$t('components.podcast.oldRevision')}</p>{/if}
    {#if finished}
      <div class="podcast-player">
        {#if audioUrl}<audio bind:this={player} controls src={audioUrl} aria-label={$t('components.podcast.play')} preload="metadata" ontimeupdate={() => { currentTime = player.currentTime; applyPodcastSpeed(); }} onloadedmetadata={applyPodcastSpeed} onseeked={applyPodcastSpeed} onerror={() => audioError = 'components.podcast.error.play'}></audio>{:else if loadingAudio}<p role="status">{$t('components.podcast.loading')}</p>{/if}
        <div class="podcast-player-tools"><span>{formatTime(finished.durationSeconds ?? 0)} · MP3</span><label>{$t('components.podcast.speed')}<select aria-label={$t('components.podcast.playbackSpeed')} bind:value={speed} onchange={applyPodcastSpeed}><option value="auto">{$t('components.podcast.recommended')}</option><option value="1">1×</option><option value="1.2">{formatNumber($locale, 1.2)}×</option><option value="1.4">{formatNumber($locale, 1.4)}×</option><option value="1.5">{formatNumber($locale, 1.5)}×</option><option value="2">2×</option></select></label></div>
        {#if audioUrl}<a class="button secondary small-button full-width" href={audioUrl} download={`researchbench-podcast-${language}.mp3`}>{$t('components.podcast.download')}</a><p class="podcast-tempo-note">{$t('components.podcast.downloadSpeed')}</p>{/if}
        {#if audioError}<p class="stale-note" role="alert">{$t(audioError)}</p>{/if}
      </div>
    {/if}
    <div class="podcast-transcript" aria-label={$t('components.podcast.transcriptLabel')}>
      {#each transcript.script.turns as turn}
        {@const timing = finished?.timeline?.find((item) => item.turnId === turn.id)}
        <section class="podcast-turn" class:playing={activeTurnId === turn.id}>
          <button class="podcast-turn-seek" onclick={() => seek(turn.id)} disabled={!audioUrl || !timing} aria-label={$t('components.podcast.jump', { number: transcript.script.turns.indexOf(turn) + 1 })}><span class="podcast-speaker" class:speaker-b={turn.speaker === 'B'}>{turn.speaker === 'A' ? 'Oliver' : 'Jane'}</span>{#if timing}<span>{formatTime(timing.start)}</span>{/if}</button>
          <p>{turn.text}</p>
          {#if turn.citationIds.length}<div class="citations" aria-label={$t('components.citations')}>{#each turn.citationIds as id}{@const citation = transcript.citations.find((item) => item.id === id)}{#if citation}<button class="citation" disabled={!availableSourceIds.includes(citation.sourceId)} onclick={() => onCitation(citation)} title={`${displaySourceName(citation.sourceName)} · ${$t('components.citation.page', { page: citation.page })}\n${citation.text}`}><FileText size={11}/><span><bdi>{displaySourceName(citation.sourceName)}</bdi> · {formatNumber($locale, citation.page)}</span>{#if !availableSourceIds.includes(citation.sourceId)}<span>{$t('components.citation.removed')}</span>{/if}</button>{/if}{/each}</div>{/if}
        </section>
      {/each}
    </div>
    <div class="coverage-info"><span>{$t('components.podcast.coverage', { selected: transcript.coverage.selectedSources, total: transcript.coverage.totalSources, percent: transcript.coverage.totalCharacters ? Math.round(transcript.coverage.selectedCharacters / transcript.coverage.totalCharacters * 100) : 0 })}</span><span>{$t(transcript.coverage.limited ? 'components.podcast.limited' : 'components.podcast.complete')} · {$t(`components.provider.${transcript.provider}`)}</span></div>
    {#if finished}<button class="text-button podcast-delete" onclick={() => onDelete(finished)}><Trash2 size={12}/>{$t('components.podcast.deleteEpisode')}</button>{/if}
  {:else}
    <div class="studio-empty podcast-empty"><div class="studio-art"><Headphones size={32} strokeWidth={1.2}/><span class="studio-art-line"></span><span class="studio-art-line short"></span></div><h3>{$t('components.podcast.emptyTitle')}</h3><p>{$t('components.podcast.emptyDescription')}</p><ul><li><Check size={13}/>{$t('components.podcast.featureCitations')}</li><li><Check size={13}/>{$t('components.podcast.featureDownload')}</li></ul></div>
  {/if}
</div>
<div class="studio-generate podcast-generate"><button class="button full-width" onclick={() => controller.generatePodcast(language)} disabled={!canCreate}><Headphones size={16}/>{$t(finished ? 'components.podcast.recreate' : 'components.podcast.create')}</button><p>{!state.sources.length ? $t('components.podcast.needSource') : !state.hasKey ? $t('components.podcast.needKey') : $t('components.podcast.sent', { provider: $t(`components.provider.${state.provider}`) })}</p><p>{$t('components.podcast.costs')}</p></div>
