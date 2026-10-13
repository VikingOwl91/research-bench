<script context="module" lang="ts">
  declare const __SOURCE_COMMIT__: string;
</script>
<script lang="ts">
  const sourceArchive = `/source/researchbench-${__SOURCE_COMMIT__}.tar.gz`;
  const sourceLicense = `/source/researchbench-${__SOURCE_COMMIT__}.license.txt`;
  import { displaySourceName } from '#lib/display-source-name.ts';
  import { displaySearchSnippet } from '#lib/display-search-snippet.ts';
  import { onMount, tick } from 'svelte';
  import { BookOpen, Plus, ChevronDown, ArrowUp, ArrowRight, MessageSquare, Search, FileText, Upload, X, Settings2, ShieldCheck, Sparkles, GraduationCap, PanelLeft, Trash2, Pencil, Check, LoaderCircle, CircleHelp, CheckCircle2, AlertCircle, Square, NotebookPen, Headphones } from 'lucide-svelte';
  import { ResearchBenchController } from '#lib/controller.ts';
  import { locale, t, initializeLocale, setLocale } from '#lib/i18n/store.ts';
  import { formatNumber, formatSize } from '#lib/i18n/index.ts';
  import type { AppSnapshot, Citation, GeneratorKind, Provider, Source, StudioKind, TextArtifact } from '#lib/types.ts';
  import GroundedAnswer from '#lib/components/GroundedAnswer.svelte';
  import SourceViewer from '#lib/components/SourceViewer.svelte';
  import PodcastView from '#lib/components/PodcastView.svelte';

  let controller: ResearchBenchController;
  let state: AppSnapshot = { notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [], progress: null, busy: false, provider: 'mistral', hasKey: false, error: null };
  let ready = false;
  let activeTab: 'chat' | 'search' | 'source' = 'chat';
  let mobilePane: 'sources' | 'work' | 'studio' = 'work';
  let generator: StudioKind = 'summary';
  let prompt = '';
  let keyInput = '';
  let notebookName = '';
  let notebookEditing: 'create' | 'rename' | null = null;
  let selectedSource: Source | null = null;
  let selectedCitation: Citation | undefined;
  let sourceSelectionVersion = 0;
  let dragging = false;
  let settingsDialog: HTMLDialogElement;
  let confirmDialog: HTMLDialogElement;
  let deletion: { kind: 'all' | 'notebook' | 'source' | 'podcast'; id?: string; name: string } | null = null;
  let fileInput: HTMLInputElement;
  let chatFeed: HTMLDivElement;
  let previousMessageCount = 0;
  let searchedQuery = '';
  let searchAttempted = false;
  const generatorDetails = {
    summary: { titleKey: 'page.summaryTitle', descriptionKey: 'page.summaryDescription', icon: FileText },
    faq: { titleKey: 'page.faqTitle', descriptionKey: 'page.faqDescription', icon: CircleHelp },
    study: { titleKey: 'page.studyTitle', descriptionKey: 'page.studyDescription', icon: GraduationCap },
    podcast: { titleKey: 'page.podcastTitle', descriptionKey: 'page.podcastDescription', icon: Headphones }
  } as const;
  $: artifact = state.artifacts.find((item): item is TextArtifact => item.kind !== 'podcast' && item.kind === generator);
  $: availableSourceIds = state.sources.map((source) => source.id);
  $: staleArtifact = !!(artifact && artifact.revision !== state.activeNotebook?.revision);
  $: canGenerate = ready && !state.busy && state.hasKey && state.sources.length > 0;
  $: if (state.messages.length !== previousMessageCount) {
    previousMessageCount = state.messages.length;
    scrollChat();
  }
  onMount(() => {
    initializeLocale();
    controller = new ResearchBenchController();
    const unsubscribe = controller.subscribe((snapshot: AppSnapshot) => {
      if (state.activeNotebook?.id !== snapshot.activeNotebook?.id) {
        selectedSource = null;
        selectedCitation = undefined;
        activeTab = 'chat';
        prompt = '';
        searchedQuery = '';
        searchAttempted = false;
      } else if (selectedSource && !snapshot.sources.some((source) => source.id === selectedSource?.id)) {
        selectedSource = null;
        selectedCitation = undefined;
        activeTab = 'chat';
      }
      state = snapshot;
    });
    controller.initialize().then(() => ready = true);
    return () => { unsubscribe(); controller.cancel(); };
  });
  async function scrollChat() { await tick(); chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' }); }
  function openSettings() { keyInput = ''; settingsDialog.showModal(); }
  function changeProvider(provider: Provider) { keyInput = ''; controller.setProvider(provider); }
  function saveKey() { if (!keyInput.trim()) return; controller.setKey(keyInput.trim()); keyInput = ''; }
  async function saveNotebook() {
    if (!notebookName.trim()) return;
    if (notebookEditing === 'rename') await controller.renameNotebook(notebookName.trim());
    else await controller.createNotebook(notebookName.trim());
    notebookName = ''; notebookEditing = null;
  }
  function beginNotebook(mode: 'create' | 'rename') { notebookEditing = mode; notebookName = mode === 'rename' ? state.activeNotebook?.name ?? '' : ''; mobilePane = 'sources'; }
  function showSource(source: Source, citation?: Citation) { selectedSource = source; selectedCitation = citation; sourceSelectionVersion += 1; activeTab = 'source'; mobilePane = 'work'; }
  function showCitation(citation: Citation) { const source = state.sources.find((item) => item.id === citation.sourceId); if (source) showSource(source, citation); }
  async function upload(files: FileList | File[]) { if (!state.busy && ready) await controller.importFiles(Array.from(files)); }
  function onDrop(event: DragEvent) { event.preventDefault(); dragging = false; if (event.dataTransfer?.files) upload(event.dataTransfer.files); }
  async function submitPrompt() {
    const value = prompt.trim();
    if (!value || state.busy || !state.sources.length) return;
    if (activeTab === 'search') { searchedQuery = value; await controller.search(value); searchAttempted = true; }
    else { if (!state.hasKey) { openSettings(); return; } prompt = ''; await controller.ask(value); }
  }
  function askSuggestion(question: string) { prompt = question; }
  function requestDelete(kind: 'all' | 'notebook' | 'source' | 'podcast', name: string, id?: string) { deletion = { kind, name, id }; confirmDialog.showModal(); }
  async function confirmDelete() {
    const request = deletion; confirmDialog.close(); deletion = null;
    if (!request) return;
    if (request.kind === 'all') { settingsDialog.close(); await controller.clearAll(); }
    else if (request.kind === 'notebook' && request.id) await controller.deleteNotebook(request.id);
    else if (request.kind === 'source' && request.id) await controller.deleteSource(request.id);
    else if (request.kind === 'podcast' && request.id) await controller.deletePodcast(request.id);
  }
</script>

<svelte:head><title>{$t('page.documentTitle')}</title><meta name="description" content={$t('page.metaDescription')}/></svelte:head>

<div class="app-shell">
  <header class="app-header">
    <a href="/" class="brand" aria-label={$t('page.home')}><span class="brand-symbol"><BookOpen size={21} strokeWidth={1.8}/></span><span>research<span class="brand-light">bench</span><span class="brand-dot">.</span></span></a>
    <div class="header-center"><span class="status-dot"></span><span>{$t('page.headerTagline')}</span></div>
    <div class="header-actions"><label class="interface-language" for="interface-language"><span class="visually-hidden">{$t('page.interfaceLanguage')}</span><select id="interface-language" aria-label={$t('page.interfaceLanguage')} value={$locale} onchange={(event) => setLocale(event.currentTarget.value)}><option value="en">English</option><option value="de">Deutsch</option></select></label><span class="version-pill">{$t('page.browserEdition')}</span><button class="settings-trigger" onclick={openSettings} disabled={!ready}><Settings2 size={16}/><span>{$t('page.settings')}</span></button></div>
  </header>

  <div class="workspace-heading"><div><div class="eyebrow">{$t('page.workspaceEyebrow')}</div><h1>{$t('page.workspaceTitle')}<span>.</span></h1></div><div class="workspace-note"><ShieldCheck size={16}/><span>{$t('page.localSources')}</span></div></div>

  <nav class="mobile-navigation" aria-label={$t('page.workspaces')}><button class:active={mobilePane === 'sources'} onclick={() => mobilePane = 'sources'}><PanelLeft size={16}/>{$t('page.sources')}</button><button class:active={mobilePane === 'work'} onclick={() => mobilePane = 'work'}><MessageSquare size={16}/>{$t('page.research')}</button><button class:active={mobilePane === 'studio'} onclick={() => mobilePane = 'studio'}><Sparkles size={16}/>{$t('page.studio')}</button></nav>

  <main class="workspace">
    <aside class="sources-panel panel" class:mobile-visible={mobilePane === 'sources'}>
      <div class="panel-header"><div class="panel-title"><BookOpen size={17}/><h2>{$t('page.notebooks')}</h2></div><button class="icon-button" onclick={() => beginNotebook('create')} disabled={state.busy || !ready} aria-label={$t('page.createNotebook')} title={$t('page.createNotebook')}><Plus size={18}/></button></div>
      <div class="notebook-section">
        {#if state.notebooks.length}<div class="notebook-select"><BookOpen size={16}/><select aria-label={$t('page.activeNotebook')} value={state.activeNotebook?.id ?? ''} onchange={(event) => controller.selectNotebook(event.currentTarget.value)} disabled={state.busy}>{#each state.notebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}</select><ChevronDown size={14}/></div><div class="notebook-meta"><span>{$t(state.sources.length === 1 ? 'page.sourceCountDeviceOne' : 'page.sourceCountDeviceMany', { count: state.sources.length })}</span><div><button class="icon-button small-icon" onclick={() => beginNotebook('rename')} disabled={state.busy || !state.activeNotebook} aria-label={$t('page.renameNotebook')}><Pencil size={13}/></button><button class="icon-button small-icon" onclick={() => state.activeNotebook && requestDelete('notebook', state.activeNotebook.name, state.activeNotebook.id)} disabled={!state.activeNotebook} aria-label={$t('page.deleteNotebook')}><Trash2 size={13}/></button></div></div>{/if}
        {#if notebookEditing}<form class="notebook-form" onsubmit={(event) => { event.preventDefault(); saveNotebook(); }}><label for="notebook-name">{$t(notebookEditing === 'rename' ? 'page.renameNotebook' : 'page.newNotebook')}</label><input id="notebook-name" bind:value={notebookName} placeholder={$t('page.notebookPlaceholder')} maxlength="100" required/><div><button type="button" class="text-button" onclick={() => notebookEditing = null}>{$t('page.cancel')}</button><button class="button small-button" disabled={!notebookName.trim() || state.busy}>{$t('page.save')}</button></div></form>{/if}
        {#if !state.notebooks.length && !notebookEditing}<div class="notebook-empty"><p>{$t('page.notebookEmpty')}</p><button class="button secondary full-width" onclick={() => beginNotebook('create')} disabled={!ready}><Plus size={15}/>{$t('page.createNotebook')}</button></div>{/if}
      </div>

      <div class="sources-label"><span class="eyebrow">{$t('page.sourcesEyebrow')}</span><span class="count-badge">{formatNumber($locale, state.sources.length)}</span></div>
      <div class="source-list">{#each state.sources as source}<div class="source-row" class:selected={selectedSource?.id === source.id}><button class="source-open" onclick={() => showSource(source)}><span class="file-icon"><FileText size={18}/></span><span><strong><bdi>{displaySourceName(source.name)}</bdi></strong><small>{source.kind.toUpperCase()} · {formatSize($locale, source.size)} · {$t(source.chunkCount === 1 ? 'page.chunkCountOne' : 'page.chunkCountMany', { count: source.chunkCount })}</small></span></button><button class="icon-button source-remove" onclick={() => requestDelete('source', source.name, source.id)} aria-label={$t('page.deleteNamedSource', { name: displaySourceName(source.name) })}><X size={13}/></button></div>{/each}</div>
      <div class="upload-section">
        <div class="dropzone" class:dragging role="region" aria-label={$t('page.uploadSources')} ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={onDrop}>
          <span class="upload-icon"><Upload size={20}/></span><strong>{$t('page.addKnowledge')}</strong><p>{$t('page.dropFiles')}<br/>{$t('page.chooseFiles')}</p><label class="button secondary small-button" class:disabled={state.busy || !state.activeNotebook} for="source-upload"><Plus size={14}/>{$t('page.addSources')}</label><input class="visually-hidden" id="source-upload" bind:this={fileInput} type="file" multiple accept=".pdf,.md,.txt,application/pdf,text/plain,text/markdown" disabled={state.busy || !state.activeNotebook} onchange={(event) => { if (event.currentTarget.files) upload(event.currentTarget.files); event.currentTarget.value = ''; }}/><small>{$t('page.uploadFormats')}</small>
        </div>
        <p class="download-note">{$t('page.downloadNote')}</p>
      </div>
      <div class="sidebar-footer"><span class="tiny-lock"><ShieldCheck size={15}/></span><p>{$t('page.documentsStay')}<br/><span>{$t('page.noIndexUpload')}</span></p></div>
    </aside>

    <section class="research-panel panel" class:mobile-visible={mobilePane === 'work'} aria-label={$t('page.research')}>
      <div class="panel-header research-header"><div class="research-tabs"><button class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}><MessageSquare size={16}/>{$t('page.chat')}</button><button class:active={activeTab === 'search'} onclick={() => activeTab = 'search'}><Search size={16}/>{$t('page.localSearch')}</button>{#if selectedSource}<button class:active={activeTab === 'source'} onclick={() => activeTab = 'source'}><FileText size={16}/>{$t('page.source')}</button>{/if}</div><span class="local-pill"><span class="status-dot"></span>{$t(activeTab === 'search' ? 'page.local' : 'page.sourceGrounded')}</span></div>
      {#if state.error}<div class="error-banner" role="alert"><AlertCircle size={17}/><span>{#if state.errorMessage && (state.errorMessage.key === 'runtime.fileTooLarge' || state.errorMessage.key === 'runtime.emptyFile')}<bdi>{state.errorMessage.params?.filename}</bdi>{$t(state.errorMessage.key, { ...state.errorMessage.params, filename: '' })}{:else}{state.errorMessage ? $t(state.errorMessage.key, state.errorMessage.params) : $t('runtime.operationFailed')}{/if}</span><button class="icon-button" onclick={() => controller.clearError()} aria-label={$t('page.dismissError')}><X size={15}/></button></div>{/if}
      {#if state.progress}<div class="progress-banner" role="status" data-stage={state.progress.stage}><LoaderCircle size={17} class="spin"/><div><strong>{state.progress.stageMessage ? $t(state.progress.stageMessage.key, state.progress.stageMessage.params) : $t('runtime.processing')}</strong><span>{#if state.progress.detailMessage?.key === 'runtime.fileProgress'}<bdi>{state.progress.detailMessage.params?.filename}</bdi>{$t(state.progress.detailMessage.key, { ...state.progress.detailMessage.params, filename: '' })}{:else}{state.progress.detailMessage ? $t(state.progress.detailMessage.key, state.progress.detailMessage.params) : (state.progress.total > 0 ? $t('page.progressCount', { current: state.progress.current, total: state.progress.total }) : $t('page.justAMoment'))}{/if}</span>{#if state.progress.total > 0}<progress max={state.progress.total} value={state.progress.current}></progress>{:else}<progress aria-label={$t('page.processing')}></progress>{/if}</div><button class="text-button" onclick={() => controller.cancel()}><Square size={12}/>{$t('page.cancel')}</button></div>{/if}
      {#if activeTab === 'source' && selectedSource}{#key sourceSelectionVersion}<SourceViewer source={selectedSource} citation={selectedCitation} onClose={() => activeTab = 'chat'}/>{/key}
      {:else}
        <div class="research-feed" bind:this={chatFeed} aria-live="polite">
          {#if activeTab === 'search'}
            {#if state.searchHits.length}<div class="results-heading"><span class="eyebrow">{$t('page.semanticResults')}</span><span>{$t(state.searchHits.length === 1 ? 'page.excerptCountOne' : 'page.excerptCountMany', { count: state.searchHits.length })}</span></div>{#each state.searchHits as hit}<button class="search-result" onclick={() => showCitation({ id: hit.chunk.id, sourceId: hit.chunk.sourceId, sourceName: hit.sourceName, page: hit.chunk.page, start: hit.chunk.start, end: hit.chunk.end, text: hit.chunk.text })}><div><span><FileText size={13}/><bdi>{displaySourceName(hit.sourceName)}</bdi> · {$t('page.pageNumber', { page: hit.chunk.page })}</span><ArrowUp size={14}/></div><p>{displaySearchSnippet(hit.chunk, state.sources.find(source => source.id === hit.chunk.sourceId)?.pages.find(page => page.page === hit.chunk.page)?.text)}</p><span class="result-score">{$t('page.similarity', { score: formatNumber($locale, hit.score * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span></button>{/each}{:else}<div class="research-empty"><div class="empty-illustration search-illustration"><Search size={31} strokeWidth={1.4}/><span class="orbit-dot"></span></div><span class="eyebrow">{$t('page.searchEyebrow')}</span><h2>{$t(searchAttempted ? 'page.noResults' : 'page.searchMeaning')}</h2><p>{#if searchAttempted}{$t('page.noResultsQuery', { query: searchedQuery })}{:else}{$t('page.searchIntro')}<br/>{$t('page.searchLocal')}{/if}</p></div>{/if}
          {:else if state.messages.length}
            {#each state.messages as message}<article class="chat-message" class:user-message={message.role === 'user'}><div class="message-author">{#if message.role === 'assistant'}<span class="assistant-symbol"><Sparkles size={13}/></span>ResearchBench{#if message.revision !== state.activeNotebook?.revision}<span class="stale-inline">{$t('page.olderSources')}</span>{/if}{:else}<span class="user-avatar">{$t('page.you')}</span>{$t('page.yourQuestion')}{/if}</div>{#if message.answer}<GroundedAnswer answer={message.answer} citations={message.citations} onCitation={showCitation} {availableSourceIds}/>{:else}<p class="message-text">{message.text}</p>{/if}</article>{/each}
          {:else}<div class="research-empty"><div class="empty-illustration"><BookOpen size={35} strokeWidth={1.35}/><span class="illustration-spark"><Sparkles size={16}/></span><span class="orbit-dot"></span></div><span class="eyebrow">{$t('page.chatEyebrow')}</span><h2>{$t('page.chatEmptyTitle')}</h2><p>{$t('page.chatEmptyIntro')}<br/>{$t('page.chatEmptyEvidence')}</p><div class="suggestion-grid"><button onclick={() => askSuggestion($t('page.overviewQuestion'))} disabled={!state.sources.length}><span>{$t('page.overviewSuggestion')}</span><small>{$t('page.overviewSuggestionDetail')}</small><ArrowRight size={15}/></button><button onclick={() => askSuggestion($t('page.connectionsQuestion'))} disabled={!state.sources.length}><span>{$t('page.connectionsSuggestion')}</span><small>{$t('page.connectionsSuggestionDetail')}</small><ArrowRight size={15}/></button></div><div class="empty-step"><span>1</span>{$t('page.addSources')}<span class="step-line"></span><span>2</span>{$t('page.askStep')}<span class="step-line"></span><span>3</span>{$t('page.evidenceStep')}</div></div>{/if}
        </div>
        <div class="composer-area"><form class="composer" onsubmit={(event) => { event.preventDefault(); submitPrompt(); }}><label class="visually-hidden" for="question">{$t(activeTab === 'search' ? 'page.queryLabel' : 'page.questionLabel')}</label><textarea id="question" rows="2" bind:value={prompt} placeholder={$t(activeTab === 'search' ? 'page.searchPlaceholder' : 'page.questionPlaceholder')} disabled={!ready || state.busy || !state.sources.length} onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitPrompt(); } }}></textarea><div class="composer-bottom"><span><FileText size={12}/>{$t(state.sources.length === 1 ? 'page.notebookSourceCountOne' : 'page.notebookSourceCountMany', { count: state.sources.length })}</span><button class="send-button" disabled={!prompt.trim() || state.busy || !state.sources.length} aria-label={$t(activeTab === 'search' ? 'page.search' : 'page.sendQuestion')}>{#if state.busy}<LoaderCircle size={19} class="spin"/>{:else}<ArrowUp size={19}/>{/if}</button></div></form><p class="composer-footnote">{$t(activeTab === 'search' ? 'page.searchFootnote' : 'page.chatFootnote')}</p></div>
      {/if}
      <button class="provider-bar" onclick={openSettings} disabled={!ready}><span><span class="provider-mark">M</span><span>{$t(state.provider === 'mistral' ? 'page.providerMistral' : 'page.providerOpenrouter')}<small>{$t(state.hasKey ? 'page.sessionKeySaved' : 'page.addKey')}</small></span></span><span class="provider-status" class:connected={state.hasKey}>{#if state.hasKey}<CheckCircle2 size={14}/>{:else}<Plus size={14}/>{/if}<Settings2 size={15}/></span></button>
    </section>

    <aside class="studio-panel panel" class:mobile-visible={mobilePane === 'studio'}>
      <div class="panel-header"><div class="panel-title"><Sparkles size={17}/><h2>{$t('page.studio')}</h2></div><span class="studio-badge">{$t('page.studioBadge')}</span></div>
      <div class="studio-intro"><h3>{$t('page.studioTitle')}</h3><p>{$t('page.studioIntro')}</p></div>
      <div class="generator-tabs" role="group" aria-label={$t('page.selectContent')}>{#each Object.entries(generatorDetails) as [kind, details]}<button class:active={generator === kind} onclick={() => generator = kind as StudioKind}><svelte:component this={details.icon} size={18}/><span>{$t(kind === 'summary' ? 'page.summaryTab' : kind === 'faq' ? 'page.faqTitle' : kind === 'study' ? 'page.studyTab' : 'page.podcastTitle')}</span></button>{/each}</div>
      {#if generator === 'podcast' && controller}
        {#key state.activeNotebook?.id}<PodcastView {controller} {state} onCitation={showCitation} onDelete={(episode) => requestDelete('podcast', episode.script.title, episode.id)}/>{/key}
      {:else}
      <div class="studio-content">
        {#if artifact}<div class="artifact-heading"><span class="eyebrow">{$t(generatorDetails[generator].titleKey)}</span>{#if staleArtifact}<span class="stale-badge">{$t('page.sourcesChanged')}</span>{:else}<span class="ready-badge"><Check size={11}/>{$t('page.created')}</span>{/if}</div>{#if staleArtifact}<p class="stale-note">{$t('page.staleArtifact')}</p>{/if}<GroundedAnswer answer={artifact.answer} citations={artifact.citations} onCitation={showCitation} {availableSourceIds}/><div class="coverage-info"><span>{$t('page.coverage', { selected: artifact.coverage.selectedSources, total: artifact.coverage.totalSources, percent: artifact.coverage.totalCharacters ? Math.round(artifact.coverage.selectedCharacters / artifact.coverage.totalCharacters * 100) : 0 })}</span><span>{$t(artifact.coverage.limited ? 'page.coverageLimited' : 'page.coverageFull')} · {$t(artifact.provider === 'mistral' ? 'page.providerMistral' : 'page.providerOpenrouter')}</span></div>
        {:else}<div class="studio-empty"><div class="studio-art"><svelte:component this={generatorDetails[generator].icon} size={32} strokeWidth={1.2}/><span class="studio-art-line"></span><span class="studio-art-line short"></span><span class="studio-art-line"></span></div><h3>{$t(generatorDetails[generator].titleKey)}</h3><p>{$t(generatorDetails[generator].descriptionKey)}</p><ul>{#if generator === 'summary'}<li><Check size={13}/>{$t('page.summaryBenefit')}</li><li><Check size={13}/>{$t('page.summaryEvidence')}</li>{:else if generator === 'faq'}<li><Check size={13}/>{$t('page.faqBenefit')}</li><li><Check size={13}/>{$t('page.faqEvidence')}</li>{:else}<li><Check size={13}/>{$t('page.studyBenefit')}</li><li><Check size={13}/>{$t('page.studyEvidence')}</li>{/if}</ul></div>{/if}
      </div>
      <div class="studio-generate"><button class="button full-width" onclick={() => controller.generate(generator as GeneratorKind)} disabled={!canGenerate}><Sparkles size={16}/>{artifact ? $t('page.regenerate') : $t('page.createContent', { title: $t(generatorDetails[generator].titleKey) })}</button><p>{!state.sources.length ? $t('page.addSourceFirst') : !state.hasKey ? $t('page.addKeySettings') : $t('page.excerptsSent', { provider: $t(state.provider === 'mistral' ? 'page.providerMistral' : 'page.providerOpenrouter') })}</p></div>
      {/if}
      <div class="studio-tip"><span class="tip-icon"><NotebookPen size={17}/></span><div><strong>{$t('page.studioTipTitle')}</strong><p>{$t('page.studioTip')}</p></div></div>
    </aside>
  </main>
  <footer class="app-footer"><span>{$t('page.footerTagline')}</span><span>{$t('page.localProcessing')}<span>·</span> Rust + WebAssembly <span>·</span> BYOK <span>·</span> <a class="repo-link" href="https://github.com/VikingOwl91/research-bench" target="_blank" rel="noopener noreferrer">GitHub</a> <span>·</span> <a class="repo-link" href={sourceArchive}>{$locale === 'de' ? 'Quellcode' : 'Source code'}</a> <span>·</span> <a class="repo-link" href={sourceLicense}>AGPL-3.0-or-later</a></span></footer>
</div>

<dialog class="settings-dialog" bind:this={settingsDialog} onclose={() => keyInput = ''}>
  <div class="dialog-header"><div><span class="eyebrow">{$t('page.settingsEyebrow')}</span><h2>{$t('page.settingsTitle')}</h2></div><button class="icon-button" onclick={() => settingsDialog.close()} aria-label={$t('page.closeSettings')}><X size={20}/></button></div>
  <p class="dialog-description">{$t('page.settingsIntro')}</p>
  <fieldset class="provider-options"><legend>{$t('page.aiProvider')}</legend><label class:selected={state.provider === 'mistral'}><input type="radio" name="provider" value="mistral" checked={state.provider === 'mistral'} onchange={() => changeProvider('mistral')}/><span><strong>{$t('page.providerMistral')}<span class="recommended">{$t('page.default')}</span></strong><small>{$t('page.mistralEndpoint')}</small></span></label><label class:selected={state.provider === 'openrouter'}><input type="radio" name="provider" value="openrouter" checked={state.provider === 'openrouter'} onchange={() => changeProvider('openrouter')}/><span><strong>{$t('page.providerOpenrouter')}</strong><small>{$t('page.openrouterEndpoint')}</small></span></label></fieldset>
  <div class="settings-model"><span class="eyebrow">{$t('page.model')}</span><strong>{$t(state.provider === 'mistral' ? 'page.modelMistral' : 'page.modelOpenrouter')}</strong></div>
  <form class="key-form" onsubmit={(event) => { event.preventDefault(); saveKey(); }}><label for="api-key">{$t(state.provider === 'mistral' ? 'page.providerMistral' : 'page.providerOpenrouter')} {$t('page.apiKey')} {#if state.hasKey}<span class="ready-badge"><Check size={12}/>{$t('page.keySaved')}</span>{/if}</label><div><input id="api-key" type="password" bind:value={keyInput} placeholder={$t(state.hasKey ? 'page.replaceKeyPlaceholder' : 'page.keyPlaceholder')} autocomplete="off" spellcheck="false"/><button class="button" disabled={!keyInput.trim()}>{$t('page.save')}</button></div><p>{$t('page.keyPrivacy')}</p>{#if state.hasKey}<button type="button" class="text-button" onclick={() => controller.setKey('')}>{$t('page.removeKey')}</button>{/if}</form>
  <div class="privacy-detail"><ShieldCheck size={18}/><div><strong>{$t('page.privacyTitle')}</strong><p>{$t('page.privacyDataFlow')}</p><p>{$t(state.provider === 'mistral' ? 'page.mistralPrivacy' : 'page.openrouterPrivacy')}</p></div></div>
  <div class="danger-zone"><div><strong>{$t('page.clearData')}</strong><p>{$t('page.clearDataDetail')}</p></div><button class="button danger-button" onclick={() => requestDelete('all', '')}><Trash2 size={15}/>{$t('page.delete')}</button></div>
</dialog>

<dialog class="confirmation-dialog" bind:this={confirmDialog}>
  <div class="delete-icon"><Trash2 size={24}/></div><h2>{$t(deletion?.kind === 'all' ? 'page.deleteAllQuestion' : deletion?.kind === 'notebook' ? 'page.deleteNotebookQuestion' : deletion?.kind === 'podcast' ? 'page.deletePodcastQuestion' : 'page.deleteSourceQuestion')}</h2><p><strong><bdi>{deletion?.kind === 'all' ? $t('page.allDataName') : deletion?.kind === 'source' ? displaySourceName(deletion.name) : deletion?.name}</bdi></strong></p><p>{$t(deletion?.kind === 'all' ? 'page.deleteAllDetail' : deletion?.kind === 'notebook' ? 'page.deleteNotebookDetail' : deletion?.kind === 'podcast' ? 'page.deletePodcastDetail' : 'page.deleteSourceDetail')}</p><div class="dialog-actions"><button class="button secondary" onclick={() => confirmDialog.close()}>{$t('page.cancel')}</button><button class="button danger-button" onclick={confirmDelete}>{$t('page.deletePermanently')}</button></div>
</dialog>
