<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { BookOpen, Plus, ChevronDown, ArrowUp, ArrowRight, MessageSquare, Search, FileText, Upload, X, Settings2, ShieldCheck, Sparkles, GraduationCap, PanelLeft, Trash2, Pencil, Check, LoaderCircle, CircleHelp, CheckCircle2, AlertCircle, Square, NotebookPen } from 'lucide-svelte';
  import { ResearchBenchController } from '#lib/controller.ts';
  import { MODEL_NAMES, PROVIDER_NAMES } from '#lib/constants.ts';
  import type { AppSnapshot, Citation, GeneratorKind, Provider, Source } from '#lib/types.ts';
  import GroundedAnswer from '#lib/components/GroundedAnswer.svelte';
  import SourceViewer from '#lib/components/SourceViewer.svelte';

  let controller: ResearchBenchController;
  let state: AppSnapshot = { notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [], progress: null, busy: false, provider: 'mistral', hasKey: false, error: null };
  let ready = false;
  let activeTab: 'chat' | 'search' | 'source' = 'chat';
  let mobilePane: 'sources' | 'work' | 'studio' = 'work';
  let generator: GeneratorKind = 'summary';
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
  let deletion: { kind: 'all' | 'notebook' | 'source'; id?: string; name: string } | null = null;
  let fileInput: HTMLInputElement;
  let chatFeed: HTMLDivElement;
  let previousMessageCount = 0;
  let searchedQuery = '';
  let searchAttempted = false;
  const generatorDetails = {
    summary: { title: 'Zusammenfassung', description: 'Die wichtigsten Gedanken, klar auf den Punkt.', icon: FileText },
    faq: { title: 'FAQ', description: 'Die richtigen Fragen. Belegte Antworten.', icon: CircleHelp },
    study: { title: 'Study Guide', description: 'Aus deinen Quellen wird ein Lernpfad.', icon: GraduationCap }
  };
  $: artifact = state.artifacts.find((item) => item.kind === generator);
  $: availableSourceIds = state.sources.map((source) => source.id);
  $: staleArtifact = !!(artifact && artifact.revision !== state.activeNotebook?.revision);
  $: canGenerate = ready && !state.busy && state.hasKey && state.sources.length > 0;
  $: if (state.messages.length !== previousMessageCount) {
    previousMessageCount = state.messages.length;
    scrollChat();
  }
  onMount(() => {
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
  function requestDelete(kind: 'all' | 'notebook' | 'source', name: string, id?: string) { deletion = { kind, name, id }; confirmDialog.showModal(); }
  async function confirmDelete() {
    const request = deletion; confirmDialog.close(); deletion = null;
    if (!request) return;
    if (request.kind === 'all') { settingsDialog.close(); await controller.clearAll(); }
    else if (request.kind === 'notebook' && request.id) await controller.deleteNotebook(request.id);
    else if (request.kind === 'source' && request.id) await controller.deleteSource(request.id);
  }
  function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
</script>

<svelte:head><title>ResearchBench — Wissen beginnt mit deinen Quellen.</title><meta name="description" content="Dein privater Recherche-Arbeitsplatz: lokale Dokumente, belegte Antworten und Lernmaterial. Direkt im Browser."/></svelte:head>

<div class="app-shell">
  <header class="app-header">
    <a href="/" class="brand" aria-label="ResearchBench Startseite"><span class="brand-symbol"><BookOpen size={21} strokeWidth={1.8}/></span><span>research<span class="brand-light">bench</span><span class="brand-dot">.</span></span></a>
    <div class="header-center"><span class="status-dot"></span><span>Dein Wissen. Dein Browser.</span></div>
    <div class="header-actions"><span class="version-pill">BROWSER EDITION</span><button class="settings-trigger" onclick={openSettings} disabled={!ready}><Settings2 size={16}/><span>Einstellungen</span></button></div>
  </header>

  <div class="workspace-heading"><div><div class="eyebrow">DEIN RECHERCHE-ARBEITSPLATZ</div><h1>Raum für neue Erkenntnisse<span>.</span></h1></div><div class="workspace-note"><ShieldCheck size={16}/><span>Quellen & Index bleiben lokal</span></div></div>

  <nav class="mobile-navigation" aria-label="Arbeitsbereiche"><button class:active={mobilePane === 'sources'} onclick={() => mobilePane = 'sources'}><PanelLeft size={16}/>Quellen</button><button class:active={mobilePane === 'work'} onclick={() => mobilePane = 'work'}><MessageSquare size={16}/>Recherche</button><button class:active={mobilePane === 'studio'} onclick={() => mobilePane = 'studio'}><Sparkles size={16}/>Studio</button></nav>

  <main class="workspace">
    <aside class="sources-panel panel" class:mobile-visible={mobilePane === 'sources'}>
      <div class="panel-header"><div class="panel-title"><BookOpen size={17}/><h2>Notebooks</h2></div><button class="icon-button" onclick={() => beginNotebook('create')} disabled={state.busy || !ready} aria-label="Notebook erstellen" title="Notebook erstellen"><Plus size={18}/></button></div>
      <div class="notebook-section">
        {#if state.notebooks.length}<div class="notebook-select"><BookOpen size={16}/><select aria-label="Aktives Notebook" value={state.activeNotebook?.id ?? ''} onchange={(event) => controller.selectNotebook(event.currentTarget.value)} disabled={state.busy}>{#each state.notebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}</select><ChevronDown size={14}/></div><div class="notebook-meta"><span>{state.sources.length} {state.sources.length === 1 ? 'Quelle' : 'Quellen'} · nur auf diesem Gerät</span><div><button class="icon-button small-icon" onclick={() => beginNotebook('rename')} disabled={state.busy || !state.activeNotebook} aria-label="Notebook umbenennen"><Pencil size={13}/></button><button class="icon-button small-icon" onclick={() => state.activeNotebook && requestDelete('notebook', state.activeNotebook.name, state.activeNotebook.id)} disabled={!state.activeNotebook} aria-label="Notebook löschen"><Trash2 size={13}/></button></div></div>{/if}
        {#if notebookEditing}<form class="notebook-form" onsubmit={(event) => { event.preventDefault(); saveNotebook(); }}><label for="notebook-name">{notebookEditing === 'rename' ? 'Notebook umbenennen' : 'Neues Notebook'}</label><input id="notebook-name" bind:value={notebookName} placeholder="z. B. Meine Recherche" maxlength="100" required/><div><button type="button" class="text-button" onclick={() => notebookEditing = null}>Abbrechen</button><button class="button small-button" disabled={!notebookName.trim() || state.busy}>Speichern</button></div></form>{/if}
        {#if !state.notebooks.length && !notebookEditing}<div class="notebook-empty"><p>Ein neuer Gedanke braucht einen Ort.</p><button class="button secondary full-width" onclick={() => beginNotebook('create')} disabled={!ready}><Plus size={15}/>Notebook erstellen</button></div>{/if}
      </div>

      <div class="sources-label"><span class="eyebrow">DEINE QUELLEN</span><span class="count-badge">{state.sources.length}</span></div>
      <div class="source-list">{#each state.sources as source}<div class="source-row" class:selected={selectedSource?.id === source.id}><button class="source-open" onclick={() => showSource(source)}><span class="file-icon"><FileText size={18}/></span><span><strong>{source.name}</strong><small>{source.kind.toUpperCase()} · {formatSize(source.size)} · {source.chunkCount} Chunks</small></span></button><button class="icon-button source-remove" onclick={() => requestDelete('source', source.name, source.id)} aria-label={`${source.name} löschen`}><X size={13}/></button></div>{/each}</div>
      <div class="upload-section">
        <div class="dropzone" class:dragging role="region" aria-label="Quellen hochladen" ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={onDrop}>
          <span class="upload-icon"><Upload size={20}/></span><strong>Wissen hinzufügen</strong><p>Ziehe deine Dateien hierher<br/>oder wähle sie aus.</p><label class="button secondary small-button" class:disabled={state.busy || !state.activeNotebook} for="source-upload"><Plus size={14}/>Quellen hinzufügen</label><input class="visually-hidden" id="source-upload" bind:this={fileInput} type="file" multiple accept=".pdf,.md,.txt,application/pdf,text/plain,text/markdown" disabled={state.busy || !state.activeNotebook} onchange={(event) => { if (event.currentTarget.files) upload(event.currentTarget.files); event.currentTarget.value = ''; }}/><small>PDF, Markdown, TXT · max. 10 MB / Datei</small>
        </div>
        <p class="download-note">Beim ersten Import werden ca. 160 MB für Modell und lokale Laufzeiten geladen. Der Browser kann zwischengespeicherte Dateien bei Platzmangel entfernen.</p>
      </div>
      <div class="sidebar-footer"><span class="tiny-lock"><ShieldCheck size={15}/></span><p>Deine Dokumente bleiben hier.<br/><span>Kein Upload für die Indexierung.</span></p></div>
    </aside>

    <section class="research-panel panel" class:mobile-visible={mobilePane === 'work'} aria-label="Recherche">
      <div class="panel-header research-header"><div class="research-tabs"><button class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}><MessageSquare size={16}/>Chat</button><button class:active={activeTab === 'search'} onclick={() => activeTab = 'search'}><Search size={16}/>Lokale Suche</button>{#if selectedSource}<button class:active={activeTab === 'source'} onclick={() => activeTab = 'source'}><FileText size={16}/>Quelle</button>{/if}</div><span class="local-pill"><span class="status-dot"></span>{activeTab === 'search' ? 'Lokal' : 'Quellenbasiert'}</span></div>
      {#if state.error}<div class="error-banner" role="alert"><AlertCircle size={17}/><span>{state.error}</span><button class="icon-button" onclick={() => controller.clearError()} aria-label="Fehler schließen"><X size={15}/></button></div>{/if}
      {#if state.progress}<div class="progress-banner" role="status"><LoaderCircle size={17} class="spin"/><div><strong>{state.progress.stage}</strong><span>{state.progress.detail ?? (state.progress.total > 0 ? `${state.progress.current} / ${state.progress.total}` : 'Einen Moment …')}</span>{#if state.progress.total > 0}<progress max={state.progress.total} value={state.progress.current}></progress>{:else}<progress aria-label="Verarbeitung läuft"></progress>{/if}</div><button class="text-button" onclick={() => controller.cancel()}><Square size={12}/>Abbrechen</button></div>{/if}
      {#if activeTab === 'source' && selectedSource}{#key sourceSelectionVersion}<SourceViewer source={selectedSource} citation={selectedCitation} onClose={() => activeTab = 'chat'}/>{/key}
      {:else}
        <div class="research-feed" bind:this={chatFeed} aria-live="polite">
          {#if activeTab === 'search'}
            {#if state.searchHits.length}<div class="results-heading"><span class="eyebrow">SEMANTISCHE TREFFER</span><span>{state.searchHits.length} Ausschnitte</span></div>{#each state.searchHits as hit}<button class="search-result" onclick={() => showCitation({ id: hit.chunk.id, sourceId: hit.chunk.sourceId, sourceName: hit.sourceName, page: hit.chunk.page, start: hit.chunk.start, end: hit.chunk.end, text: hit.chunk.text })}><div><span><FileText size={13}/>{hit.sourceName} · Seite {hit.chunk.page}</span><ArrowUp size={14}/></div><p>{hit.chunk.text}</p><span class="result-score">Ähnlichkeit: {(hit.score * 100).toFixed(1)} %</span></button>{/each}{:else}<div class="research-empty"><div class="empty-illustration search-illustration"><Search size={31} strokeWidth={1.4}/><span class="orbit-dot"></span></div><span class="eyebrow">FINDEN, WAS ZUSAMMENHÄNGT</span><h2>{searchAttempted ? 'Keine passenden Treffer.' : 'Suche nach Bedeutung.'}</h2><p>{#if searchAttempted}Für „{searchedQuery}“ gibt es keine Treffer. Versuche eine andere Formulierung.{:else}Entdecke passende Passagen in deinen Quellen.<br/>Die Suche läuft vollständig lokal, ohne API-Key.{/if}</p></div>{/if}
          {:else if state.messages.length}
            {#each state.messages as message}<article class="chat-message" class:user-message={message.role === 'user'}><div class="message-author">{#if message.role === 'assistant'}<span class="assistant-symbol"><Sparkles size={13}/></span>ResearchBench{#if message.revision !== state.activeNotebook?.revision}<span class="stale-inline">Älterer Quellenstand</span>{/if}{:else}<span class="user-avatar">Du</span>Deine Frage{/if}</div>{#if message.answer}<GroundedAnswer answer={message.answer} citations={message.citations} onCitation={showCitation} {availableSourceIds}/>{:else}<p class="message-text">{message.text}</p>{/if}</article>{/each}
          {:else}<div class="research-empty"><div class="empty-illustration"><BookOpen size={35} strokeWidth={1.35}/><span class="illustration-spark"><Sparkles size={16}/></span><span class="orbit-dot"></span></div><span class="eyebrow">VON QUELLEN ZU ERKENNTNISSEN</span><h2>Was möchtest du verstehen?</h2><p>Füge deine Quellen hinzu und stelle eine Frage.<br/>Jede Antwort bringt ihre Belege mit.</p><div class="suggestion-grid"><button onclick={() => askSuggestion('Was sind die wichtigsten Erkenntnisse meiner Quellen?')} disabled={!state.sources.length}><span>Den Überblick gewinnen</span><small>Was sind die wichtigsten Erkenntnisse?</small><ArrowRight size={15}/></button><button onclick={() => askSuggestion('Welche Zusammenhänge gibt es zwischen meinen Quellen?')} disabled={!state.sources.length}><span>Verbindungen entdecken</span><small>Was haben meine Quellen gemeinsam?</small><ArrowRight size={15}/></button></div><div class="empty-step"><span>1</span>Quellen hinzufügen<span class="step-line"></span><span>2</span>Frage stellen<span class="step-line"></span><span>3</span>Belege entdecken</div></div>{/if}
        </div>
        <div class="composer-area"><form class="composer" onsubmit={(event) => { event.preventDefault(); submitPrompt(); }}><label class="visually-hidden" for="question">{activeTab === 'search' ? 'Suchanfrage' : 'Frage an deine Quellen'}</label><textarea id="question" rows="2" bind:value={prompt} placeholder={activeTab === 'search' ? 'Suche in deinen Quellen …' : 'Stelle eine Frage an deine Quellen …'} disabled={!ready || state.busy || !state.sources.length} onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitPrompt(); } }}></textarea><div class="composer-bottom"><span><FileText size={12}/>{state.sources.length} {state.sources.length === 1 ? 'Quelle' : 'Quellen'} im Notebook</span><button class="send-button" disabled={!prompt.trim() || state.busy || !state.sources.length} aria-label={activeTab === 'search' ? 'Suchen' : 'Frage senden'}>{#if state.busy}<LoaderCircle size={19} class="spin"/>{:else}<ArrowUp size={19}/>{/if}</button></div></form><p class="composer-footnote">{activeTab === 'search' ? 'Semantische Suche · lokale Embeddings · kein Datenversand' : 'Antworten können Fehler enthalten. Prüfe die verlinkten Quellen.'}</p></div>
      {/if}
      <button class="provider-bar" onclick={openSettings} disabled={!ready}><span><span class="provider-mark">M</span><span>{PROVIDER_NAMES[state.provider]}<small>{state.hasKey ? 'Key für diese Sitzung hinterlegt' : 'API-Key hinzufügen'}</small></span></span><span class="provider-status" class:connected={state.hasKey}>{#if state.hasKey}<CheckCircle2 size={14}/>{:else}<Plus size={14}/>{/if}<Settings2 size={15}/></span></button>
    </section>

    <aside class="studio-panel panel" class:mobile-visible={mobilePane === 'studio'}>
      <div class="panel-header"><div class="panel-title"><Sparkles size={17}/><h2>Studio</h2></div><span class="studio-badge">AUS DEINEN QUELLEN</span></div>
      <div class="studio-intro"><h3>Wissen weiterdenken.</h3><p>Mach aus deinen Quellen etwas Neues.</p></div>
      <div class="generator-tabs" role="group" aria-label="Inhalt auswählen">{#each Object.entries(generatorDetails) as [kind, details]}<button class:active={generator === kind} onclick={() => generator = kind as GeneratorKind}><svelte:component this={details.icon} size={18}/><span>{kind === 'summary' ? 'Überblick' : kind === 'faq' ? 'FAQ' : 'Lernen'}</span></button>{/each}</div>
      <div class="studio-content">
        {#if artifact}<div class="artifact-heading"><span class="eyebrow">{generatorDetails[generator].title}</span>{#if staleArtifact}<span class="stale-badge">Quellen geändert</span>{:else}<span class="ready-badge"><Check size={11}/>Erstellt</span>{/if}</div>{#if staleArtifact}<p class="stale-note">Dieser Inhalt bezieht sich auf einen älteren Quellenstand. Generiere ihn neu, um Änderungen einzubeziehen.</p>{/if}<GroundedAnswer answer={artifact.answer} citations={artifact.citations} onCitation={showCitation} {availableSourceIds}/><div class="coverage-info"><span>{artifact.coverage.selectedSources} / {artifact.coverage.totalSources} Quellen · {artifact.coverage.totalCharacters ? Math.round(artifact.coverage.selectedCharacters / artifact.coverage.totalCharacters * 100) : 0} % des Textumfangs</span><span>{artifact.coverage.limited ? 'Begrenzte, über Quellen verteilte Auswahl' : 'Vollständiger Quelltext berücksichtigt'} · {PROVIDER_NAMES[artifact.provider]}</span></div>
        {:else}<div class="studio-empty"><div class="studio-art"><svelte:component this={generatorDetails[generator].icon} size={32} strokeWidth={1.2}/><span class="studio-art-line"></span><span class="studio-art-line short"></span><span class="studio-art-line"></span></div><h3>{generatorDetails[generator].title}</h3><p>{generatorDetails[generator].description}</p><ul>{#if generator === 'summary'}<li><Check size={13}/>Wesentliche Aussagen auf einen Blick</li><li><Check size={13}/>Mit Belegen aus deinen Dokumenten</li>{:else if generator === 'faq'}<li><Check size={13}/>Fragen, die sich aus den Quellen ergeben</li><li><Check size={13}/>Antworten mit nachvollziehbaren Belegen</li>{:else}<li><Check size={13}/>Strukturiert lernen und vertiefen</li><li><Check size={13}/>Auf Basis deiner eigenen Quellen</li>{/if}</ul></div>{/if}
      </div>
      <div class="studio-generate"><button class="button full-width" onclick={() => controller.generate(generator)} disabled={!canGenerate}><Sparkles size={16}/>{artifact ? 'Neu generieren' : `${generatorDetails[generator].title} erstellen`}</button><p>{!state.sources.length ? 'Füge zuerst eine Quelle hinzu.' : !state.hasKey ? 'Hinterlege einen API-Key in den Einstellungen.' : `Ausgewählte Auszüge werden an ${PROVIDER_NAMES[state.provider]} gesendet.`}</p></div>
      <div class="studio-tip"><span class="tip-icon"><NotebookPen size={17}/></span><div><strong>Weniger sammeln. Mehr verstehen.</strong><p>Alle Inhalte bleiben in deinem Notebook — auch nach dem Schließen.</p></div></div>
    </aside>
  </main>
  <footer class="app-footer"><span>Ein guter Gedanke beginnt mit einer guten Quelle.</span><span>Lokale Verarbeitung <span>·</span> Rust + WebAssembly <span>·</span> BYOK</span></footer>
</div>

<dialog class="settings-dialog" bind:this={settingsDialog} onclose={() => keyInput = ''}>
  <div class="dialog-header"><div><span class="eyebrow">DEIN ARBEITSPLATZ</span><h2>Verbindung & Datenschutz</h2></div><button class="icon-button" onclick={() => settingsDialog.close()} aria-label="Einstellungen schließen"><X size={20}/></button></div>
  <p class="dialog-description">Indexierung und Suche bleiben auf deinem Gerät. Für Chat und Studio wählst du deine API-Verbindung.</p>
  <fieldset class="provider-options"><legend>KI-Anbieter</legend><label class:selected={state.provider === 'mistral'}><input type="radio" name="provider" value="mistral" checked={state.provider === 'mistral'} onchange={() => changeProvider('mistral')}/><span><strong>Mistral direkt <span class="recommended">STANDARD</span></strong><small>Direkt an den EU-Endpunkt von Mistral.</small></span></label><label class:selected={state.provider === 'openrouter'}><input type="radio" name="provider" value="openrouter" checked={state.provider === 'openrouter'} onchange={() => changeProvider('openrouter')}/><span><strong>OpenRouter</strong><small>Über den US-Gateway-Anbieter zum Modellanbieter.</small></span></label></fieldset>
  <div class="settings-model"><span class="eyebrow">MODELL</span><strong>{MODEL_NAMES[state.provider]}</strong></div>
  <form class="key-form" onsubmit={(event) => { event.preventDefault(); saveKey(); }}><label for="api-key">{PROVIDER_NAMES[state.provider]} API-Key {#if state.hasKey}<span class="ready-badge"><Check size={12}/>Hinterlegt</span>{/if}</label><div><input id="api-key" type="password" bind:value={keyInput} placeholder={state.hasKey ? 'Neuen Key eingeben, um ihn zu ersetzen' : 'Deinen persönlichen API-Key eingeben'} autocomplete="off" spellcheck="false"/><button class="button" disabled={!keyInput.trim() || state.busy}>Speichern</button></div><p>Nur für diese Browser-Sitzung gespeichert. Keys der Anbieter werden getrennt gehalten.</p>{#if state.hasKey}<button type="button" class="text-button" disabled={state.busy} onclick={() => controller.setKey('')}>Gespeicherten Key entfernen</button>{/if}</form>
  <div class="privacy-detail"><ShieldCheck size={18}/><div><strong>Du entscheidest, was dein Browser verlässt.</strong><p>Für Generierungen werden ausgewählte Quellauszüge, deine Frage bzw. Anweisung und begrenzter Chatverlauf übertragen. Dokumente, Embeddings und Index bleiben lokal.</p><p>{state.provider === 'mistral' ? 'Die App nutzt Mistrals EU-Endpunkt. Training und Aufbewahrung hängen von deinem Konto und Vertrag ab; Zero Data Retention wird hier nicht als geprüft zugesichert.' : 'OpenRouter ist ein US-Anbieter und leitet Anfragen weiter. ZDR und „keine Datensammlung“ beschränken das Routing; sie sind keine Zusicherung einer ausschließlichen EU-Verarbeitung. Ohne passende Endpoints schlägt die Anfrage fehl.'}</p></div></div>
  <div class="danger-zone"><div><strong>Alle lokalen Daten löschen</strong><p>Notebooks, Quellen, Chat, Inhalte, Keys und Modell-Caches.</p></div><button class="button danger-button" onclick={() => requestDelete('all', 'Alle ResearchBench-Daten')}><Trash2 size={15}/>Löschen</button></div>
</dialog>

<dialog class="confirmation-dialog" bind:this={confirmDialog}>
  <div class="delete-icon"><Trash2 size={24}/></div><h2>{deletion?.kind === 'all' ? 'Alles löschen?' : deletion?.kind === 'notebook' ? 'Notebook löschen?' : 'Quelle löschen?'}</h2><p><strong>{deletion?.name}</strong></p><p>{deletion?.kind === 'all' ? 'Alle ResearchBench-Daten auf diesem Gerät werden entfernt. Dieser Schritt kann nicht rückgängig gemacht werden.' : deletion?.kind === 'notebook' ? 'Das Notebook und alle enthaltenen Quellen und Inhalte werden dauerhaft entfernt.' : 'Die Quelle wird aus dem Notebook und aus der Suche entfernt. Vorhandene Inhalte werden als veraltet markiert.'}</p><div class="dialog-actions"><button class="button secondary" onclick={() => confirmDialog.close()}>Abbrechen</button><button class="button danger-button" onclick={confirmDelete}>Endgültig löschen</button></div>
</dialog>
