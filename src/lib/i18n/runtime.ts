import type { CatalogEntry } from './index';

export const runtimeMessages = {
  "runtime.operationFailed": {
    "en": "The operation could not be completed.",
    "de": "Der Vorgang konnte nicht abgeschlossen werden."
  },
  "runtime.processing": {
    "en": "Processing",
    "de": "Verarbeitung"
  },
  "runtime.preparing": {
    "en": "Preparing",
    "de": "Vorbereitung"
  },
  "runtime.firstNotebook": {
    "en": "My first notebook",
    "de": "Mein erstes Notebook"
  },
  "runtime.newNotebook": {
    "en": "New notebook",
    "de": "Neues Notebook"
  },
  "runtime.source": {
    "en": "Source",
    "de": "Quelle"
  },
  "runtime.keyWhitespace": {
    "en": "An API key cannot contain spaces or line breaks.",
    "de": "Ein API-Key darf keine Leerzeichen oder Zeilenumbrüche enthalten."
  },
  "runtime.missingKey": {
    "en": "Enter your API key in settings first.",
    "de": "Bitte zuerst deinen API-Key in den Einstellungen eingeben."
  },
  "runtime.missingProviderKey": {
    "en": "Enter your {provider} API key first.",
    "de": "Bitte zuerst deinen {provider}-API-Key eingeben."
  },
  "runtime.fileTooLarge": {
    "en": "{filename}: Files must be no larger than 10 MiB.",
    "de": "{filename}: Dateien dürfen höchstens 10 MiB groß sein."
  },
  "runtime.emptyFile": {
    "en": "{filename}: The file is empty.",
    "de": "{filename}: Die Datei ist leer."
  },
  "runtime.fileProgress": {
    "en": "{filename} · File {current} / {total}",
    "de": "{filename} · Datei {current} / {total}"
  },
  "runtime.fileKinds": {
    "en": "Use PDF, Markdown or TXT files.",
    "de": "Bitte verwende PDF-, Markdown- oder TXT-Dateien."
  },
  "runtime.sourceLimit": {
    "en": "This notebook already contains ten sources.",
    "de": "Das Notebook enthält bereits zehn Quellen."
  },
  "runtime.emptyContext": {
    "en": "Fully index a source first.",
    "de": "Bitte zuerst eine Quelle vollständig indexieren."
  },
  "runtime.emptyContextAtLeast": {
    "en": "Fully index at least one source first.",
    "de": "Bitte zuerst mindestens eine Quelle vollständig indexieren."
  },
  "runtime.emptyPodcastContext": {
    "en": "Fully index sources first.",
    "de": "Bitte zuerst Quellen vollständig indexieren."
  },
  "runtime.indexModelMismatch": {
    "en": "The index model version does not match.",
    "de": "Die Modellversion des Index stimmt nicht überein."
  },
  "runtime.answerProgress": {
    "en": "{provider} is generating an answer using your sources",
    "de": "{provider} generiert eine Antwort anhand deiner Quellen"
  },
  "runtime.studioProgress": {
    "en": "Generating studio content",
    "de": "Studio-Inhalt wird generiert"
  },
  "runtime.podcastLocksUnavailable": {
    "en": "This browser does not support safe concurrent podcast jobs (Web Locks). Playback remains available.",
    "de": "Dieser Browser unterstützt keine sicheren parallelen Podcast-Aufträge (Web Locks). Wiedergabe bleibt verfügbar."
  },
  "runtime.podcastBusy": {
    "en": "This podcast is being processed in another tab. Finish it there or explicitly resume it later.",
    "de": "Dieser Podcast wird bereits in einem anderen Tab verarbeitet. Bitte dort beenden oder später ausdrücklich fortsetzen."
  },
  "runtime.crossTabSourcesChanged": {
    "en": "Local sources or data changed in another tab. Reopen the notebook.",
    "de": "Die lokalen Quellen oder Daten wurden in einem anderen Tab geändert. Bitte das Notebook neu öffnen."
  },
  "runtime.podcastSpeaking": {
    "en": "Generating podcast contributions",
    "de": "Podcast-Beiträge werden gesprochen"
  },
  "runtime.hostTurn": {
    "en": "Host {speaker} · {turn}",
    "de": "Host {speaker} · {turn}"
  },
  "runtime.podcastVoices": {
    "en": "Checking podcast voices",
    "de": "Podcast-Stimmen prüfen"
  },
  "runtime.podcastScript": {
    "en": "Writing a podcast conversation using your sources",
    "de": "Podcast-Gespräch anhand deiner Quellen wird geschrieben"
  },
  "runtime.podcastProviderChanged": {
    "en": "This draft uses a different provider. Select the original provider to resume.",
    "de": "Dieser Entwurf verwendet einen anderen Anbieter. Wähle den ursprünglichen Anbieter zum Fortsetzen."
  },
  "runtime.probePreparing": {
    "en": "Preparing voice test",
    "de": "Stimmenprobe vorbereiten"
  },
  "runtime.probeSpeaking": {
    "en": "Generating voice test",
    "de": "Stimmenprobe wird gesprochen"
  },
  "runtime.quota": {
    "en": "Browser storage is full. Remove sources or use a smaller notebook.",
    "de": "Der Browser-Speicher ist voll. Entferne Quellen oder verwende ein kleineres Notebook."
  },
  "runtime.storageBlocked": {
    "en": "The browser blocks local storage. Allow website data for ResearchBench.",
    "de": "Der Browser blockiert lokalen Speicher. Bitte erlaube Website-Daten für ResearchBench."
  },
  "runtime.wipeIncomplete": {
    "en": "Could not completely delete: {items}. Remove website data in your browser settings.",
    "de": "Nicht vollständig gelöscht: {items}. Bitte entferne die Website-Daten in deinen Browser-Einstellungen."
  },
  "runtime.wipeNotebooks": {
    "en": "local notebook data",
    "de": "lokale Notebook-Daten"
  },
  "runtime.wipeMistralKey": {
    "en": "Mistral session key",
    "de": "Mistral-Sitzungsschlüssel"
  },
  "runtime.wipeOpenRouterKey": {
    "en": "OpenRouter session key",
    "de": "OpenRouter-Sitzungsschlüssel"
  },
  "runtime.wipeProvider": {
    "en": "API selection",
    "de": "API-Auswahl"
  },
  "runtime.wipeNotebookSelection": {
    "en": "notebook selection",
    "de": "Notebook-Auswahl"
  },
  "runtime.wipeModelCache": {
    "en": "model cache",
    "de": "Modell-Cache"
  },
  "runtime.answerHeadingSize": {
    "en": "A heading exceeds 300 characters. Generate again.",
    "de": "Eine Überschrift überschreitet die Grenze von 300 Zeichen. Bitte erneut generieren."
  },
  "runtime.answerTextSize": {
    "en": "An answer section must contain 1–6,000 characters. Generate again.",
    "de": "Ein Antwortabschnitt muss zwischen 1 und 6.000 Zeichen enthalten. Bitte erneut generieren."
  },
  "runtime.answerBlocksSize": {
    "en": "The answer must contain 1–60 sections. Generate again.",
    "de": "Die Antwort muss zwischen 1 und 60 Abschnitte enthalten. Bitte erneut generieren."
  },
  "runtime.answerCitationsSize": {
    "en": "A section contains more citations than the supplied context. Generate again.",
    "de": "Ein Abschnitt enthält mehr Quellenverweise als der gesendete Kontext. Bitte erneut generieren."
  },
  "runtime.answerInvalidFormat": {
    "en": "The answer does not match the expected format. Generate again.",
    "de": "Die Antwort entspricht nicht dem erwarteten Format. Bitte erneut generieren."
  },
  "runtime.answerInvalidCitation": {
    "en": "The answer contains a citation outside the supplied context. Generate again.",
    "de": "Die Antwort enthält einen Quellenverweis, der nicht zum gesendeten Kontext gehört. Bitte erneut generieren."
  },
  "runtime.answerInvalidJson": {
    "en": "The answer does not contain valid structured JSON. Generate again.",
    "de": "Die Antwort enthält kein gültiges strukturiertes JSON. Bitte erneut generieren."
  },
  "runtime.generationTimeout": {
    "en": "Generation took too long. Try again.",
    "de": "Die Generierung hat zu lange gedauert. Bitte erneut versuchen."
  },
  "runtime.apiUnavailable": {
    "en": "The API is unreachable. Check your connection; a browser or CORS restriction may also be responsible.",
    "de": "Die API ist nicht erreichbar. Prüfe deine Verbindung; auch eine Browser- oder CORS-Sperre kann die Ursache sein."
  },
  "runtime.apiBadRequest": {
    "en": "The API rejected the request. The model and output format must be supported.",
    "de": "Die API hat die Anfrage abgelehnt. Modell und Ausgabeformat müssen unterstützt werden."
  },
  "runtime.apiInvalidKey": {
    "en": "The API key is invalid or expired.",
    "de": "Der API-Key ist ungültig oder abgelaufen."
  },
  "runtime.apiCredit": {
    "en": "Credit or the configured spending limit is insufficient.",
    "de": "Guthaben oder das festgelegte Ausgabenlimit reichen nicht aus."
  },
  "runtime.apiAccess": {
    "en": "This account cannot access the model or selected endpoint.",
    "de": "Dieses Konto hat keinen Zugriff auf das Modell oder den gewählten Endpoint."
  },
  "runtime.apiOpenRouterEndpoint": {
    "en": "No endpoint matches the model, JSON schema and privacy routing. Requirements were not relaxed.",
    "de": "Kein Endpoint erfüllt Modell, JSON-Schema und Datenschutz-Routing. Die Anforderungen wurden nicht gelockert."
  },
  "runtime.apiMistralEndpoint": {
    "en": "The model is unavailable for this account at the EU endpoint.",
    "de": "Das Modell ist mit diesem Konto am EU-Endpunkt nicht verfügbar."
  },
  "runtime.apiFormat": {
    "en": "The API does not support this model and output format combination.",
    "de": "Die API unterstützt diese Kombination aus Modell und Ausgabeformat nicht."
  },
  "runtime.apiRateLimit": {
    "en": "Rate limit reached. Wait briefly and generate again.",
    "de": "Rate-Limit erreicht. Bitte warte kurz und starte die Generierung erneut."
  },
  "runtime.apiHttp": {
    "en": "The API returned an error (HTTP {status}). Try again later.",
    "de": "Die API meldet einen Fehler (HTTP {status}). Bitte später erneut versuchen."
  },
  "runtime.apiInvalidJson": {
    "en": "The API did not return valid JSON.",
    "de": "Die API hat keine gültige JSON-Antwort geliefert."
  },
  "runtime.apiIncomplete": {
    "en": "The API response is incomplete. Generate again.",
    "de": "Die API-Antwort ist unvollständig. Bitte erneut generieren."
  },
  "runtime.podcastInvalidScript": {
    "en": "The podcast script does not match the required format or is too long. Generate again.",
    "de": "Das Podcast-Skript entspricht nicht dem vereinbarten Format oder ist zu lang. Bitte erneut erstellen."
  },
  "runtime.podcastInvalidCitation": {
    "en": "The podcast script contains invalid or duplicate citations. Generate again.",
    "de": "Das Podcast-Skript enthält ungültige oder doppelte Quellenverweise. Bitte erneut erstellen."
  },
  "runtime.podcastBothHosts": {
    "en": "Both podcast hosts must contribute.",
    "de": "Für den Podcast müssen beide Hosts zu Wort kommen."
  },
  "runtime.podcastBadRequest": {
    "en": "The API does not support this podcast request or audio format.",
    "de": "Die API unterstützt diese Podcast-Anfrage oder das Audioformat nicht."
  },
  "runtime.podcastCredit": {
    "en": "API credit or the spending limit is insufficient.",
    "de": "Das API-Guthaben oder Ausgabenlimit reicht nicht aus."
  },
  "runtime.podcastAccess": {
    "en": "This account cannot access the podcast model or endpoint.",
    "de": "Dieses Konto hat keinen Zugriff auf das Podcast-Modell oder den Endpoint."
  },
  "runtime.podcastEndpoint": {
    "en": "The podcast model, voices or required privacy routing are unavailable at this endpoint. The provider and region will not change.",
    "de": "Podcast-Modell, Stimmen oder passendes Datenschutz-Routing sind am gewählten Endpoint nicht verfügbar. Es erfolgt kein Anbieter- oder Regionswechsel."
  },
  "runtime.podcastFormat": {
    "en": "The API does not support the requested model and format combination.",
    "de": "Die API unterstützt die angefragte Modell- und Formatkombination nicht."
  },
  "runtime.podcastRateLimit": {
    "en": "Rate limit reached. Wait briefly and explicitly resume the podcast.",
    "de": "Rate-Limit erreicht. Bitte warte kurz und setze den Podcast ausdrücklich fort."
  },
  "runtime.podcastHttp": {
    "en": "The podcast API returned HTTP {status}. Try again later.",
    "de": "Die Podcast-API meldet HTTP {status}. Bitte später erneut versuchen."
  },
  "runtime.apiResponseSize": {
    "en": "The API response exceeds the safe size limit.",
    "de": "Die API-Antwort überschreitet die sichere Größenbegrenzung."
  },
  "runtime.apiNoData": {
    "en": "The API returned no data.",
    "de": "Die API hat keine Daten geliefert."
  },
  "runtime.podcastTimeout": {
    "en": "The podcast API took too long. Explicitly try again.",
    "de": "Die Podcast-API hat zu lange gebraucht. Bitte ausdrücklich erneut versuchen."
  },
  "runtime.podcastUnavailable": {
    "en": "The podcast API is unreachable or the browser blocked the connection.",
    "de": "Die Podcast-API ist nicht erreichbar oder der Browser hat die Verbindung gesperrt."
  },
  "runtime.podcastInvalidJson": {
    "en": "The podcast API did not return valid JSON.",
    "de": "Die Podcast-API hat keine gültige JSON-Antwort geliefert."
  },
  "runtime.podcastIncompleteScript": {
    "en": "The podcast script is incomplete. Generate again.",
    "de": "Das Podcast-Skript ist unvollständig. Bitte erneut erstellen."
  },
  "runtime.podcastScriptJson": {
    "en": "The podcast script does not contain valid JSON.",
    "de": "Das Podcast-Skript enthält kein gültiges JSON."
  },
  "runtime.podcastVoiceList": {
    "en": "The API voice list is invalid.",
    "de": "Die API-Stimmenliste ist ungültig."
  },
  "runtime.podcastAmbiguousVoices": {
    "en": "The selected voices are not uniquely available.",
    "de": "Die vorgesehenen Stimmen sind nicht eindeutig verfügbar."
  },
  "runtime.podcastIncompleteVoices": {
    "en": "The complete voice list could not be checked.",
    "de": "Die Stimmenliste konnte nicht vollständig geprüft werden."
  },
  "runtime.podcastModelUnavailable": {
    "en": "The selected podcast model is not uniquely available on OpenRouter.",
    "de": "Das vorgesehene Podcast-Modell ist bei OpenRouter nicht eindeutig verfügbar."
  },
  "runtime.podcastVoicesUnavailable": {
    "en": "The two selected podcast voices are unavailable at this endpoint. No substitute voices will be used.",
    "de": "Die zwei vorgesehenen Podcast-Stimmen sind am gewählten Endpoint nicht verfügbar. Es werden keine Ersatzstimmen verwendet."
  },
  "runtime.podcastTurnInput": {
    "en": "The spoken contribution is empty or too long.",
    "de": "Der gesprochene Beitrag ist leer oder zu lang."
  },
  "runtime.podcastVoiceConfig": {
    "en": "The podcast voice configuration is invalid.",
    "de": "Die Podcast-Stimmenkonfiguration ist ungültig."
  },
  "runtime.podcastUntestedFormat": {
    "en": "This podcast audio format has not been verified for the selected provider.",
    "de": "Dieses Podcast-Audioformat wurde für den gewählten Anbieter nicht geprüft."
  },
  "runtime.apiInvalidAudio": {
    "en": "The API did not return valid audio data.",
    "de": "Die API hat keine gültigen Audiodaten geliefert."
  },
  "runtime.audioEmptyOrLarge": {
    "en": "Audio data is empty or exceeds the size limit.",
    "de": "Die Audiodaten sind leer oder überschreiten die Größenbegrenzung."
  },
  "runtime.audioTurnEmptyOrLarge": {
    "en": "The audio contribution is empty or too large.",
    "de": "Der Audiobeitrag ist leer oder zu groß."
  },
  "runtime.audioFormatUnsupported": {
    "en": "This audio format is not supported.",
    "de": "Das Audioformat wird nicht unterstützt."
  },
  "runtime.audioBufferPredicted": {
    "en": "Local audio buffers would exceed 128 MiB. Create a shorter episode.",
    "de": "Die lokalen Audiopuffer würden 128 MiB überschreiten. Bitte eine kürzere Folge erstellen."
  },
  "runtime.audioDecodeUnavailable": {
    "en": "This browser does not support local audio decoding.",
    "de": "Dieser Browser unterstützt die lokale Audio-Decodierung nicht."
  },
  "runtime.audioDecodeFailed": {
    "en": "The browser could not decode the MP3 data.",
    "de": "Der Browser konnte die MP3-Daten nicht decodieren."
  },
  "runtime.audioTurnSize": {
    "en": "The audio contribution exceeds the size limit.",
    "de": "Der Audiobeitrag überschreitet die Größenbegrenzung."
  },
  "runtime.audioInvalidSamples": {
    "en": "The audio data contains invalid samples.",
    "de": "Die Audiodaten enthalten ungültige Samples."
  },
  "runtime.audioTurnIdentity": {
    "en": "The audio contribution has no identity.",
    "de": "Der Audiobeitrag hat keine Identität."
  },
  "runtime.audioTurnShort": {
    "en": "The audio contribution is too short.",
    "de": "Der Audiobeitrag ist zu kurz."
  },
  "runtime.audioResampleUnavailable": {
    "en": "This browser does not support the local audio sample rate.",
    "de": "Dieser Browser unterstützt die lokale Audio-Samplingrate nicht."
  },
  "runtime.audioResampleFailed": {
    "en": "The browser could not resample the audio.",
    "de": "Der Browser konnte die Audiosamples nicht umrechnen."
  },
  "runtime.encoderUnavailable": {
    "en": "The encoder worker is unreachable.",
    "de": "Der Encoder-Worker ist nicht erreichbar."
  },
  "runtime.audioAssemblyInvalid": {
    "en": "The audio assembly is invalid or too large.",
    "de": "Die Audio-Zusammenstellung ist ungültig oder zu groß."
  },
  "runtime.encoderProcessFailed": {
    "en": "The local MP3 encoder could not process the audio.",
    "de": "Der lokale MP3-Encoder konnte das Audio nicht verarbeiten."
  },
  "runtime.encoderFailed": {
    "en": "The local MP3 encoder failed.",
    "de": "Der lokale MP3-Encoder ist fehlgeschlagen."
  },
  "runtime.audioBufferLimit": {
    "en": "Local audio buffers exceed 128 MiB. Create a shorter episode.",
    "de": "Die lokalen Audiopuffer überschreiten 128 MiB. Bitte eine kürzere Folge erstellen."
  },
  "runtime.audioEpisodeLimit": {
    "en": "The episode exceeds the maximum duration of ten minutes.",
    "de": "Die Folge überschreitet die maximale Länge von zehn Minuten."
  },
  "runtime.audioEncoding": {
    "en": "Assembling audio",
    "de": "Audio wird zusammengesetzt"
  },
  "runtime.encodingDetail": {
    "en": "Assembling audio {current}/{total}",
    "de": "Audio {current}/{total} zusammenbauen"
  },
  "runtime.encoderNoData": {
    "en": "The encoder returned no audio data.",
    "de": "Der Encoder hat keine Audiodaten geliefert."
  },
  "runtime.encoderDuration": {
    "en": "The MP3 duration does not match the generated audio.",
    "de": "Die MP3-Dauer passt nicht zum erzeugten Audio."
  },
  "runtime.encoderTimeout": {
    "en": "Local MP3 encoding exceeded the 30-second limit.",
    "de": "Das lokale MP3-Encoding hat die Grenze von 30 Sekunden überschritten."
  },
  "runtime.audioInvalidFormat": {
    "en": "The audio format is damaged or unsupported.",
    "de": "Das Audioformat ist beschädigt oder nicht unterstützt."
  },
  "runtime.audioRateUnsupported": {
    "en": "The audio sample rate is not supported.",
    "de": "Die Audio-Samplingrate wird nicht unterstützt."
  },
  "runtime.audioSize": {
    "en": "The audio exceeds the size limit.",
    "de": "Das Audio überschreitet die Größenbegrenzung."
  },
  "runtime.audioRawFormat": {
    "en": "Raw PCM requires a known, complete format description.",
    "de": "Rohes PCM erfordert eine bekannte, vollständige Formatbeschreibung."
  },
  "runtime.encoderInvalidResult": {
    "en": "The MP3 encoder returned an invalid result.",
    "de": "Der MP3-Encoder hat ein ungültiges Ergebnis geliefert."
  },
  "runtime.audioCompressedSize": {
    "en": "The compressed contribution exceeds the safe PCM size.",
    "de": "Der komprimierte Audiobeitrag überschreitet die sichere PCM-Größe."
  },
  "runtime.pipelineAlreadyRunning": {
    "en": "Local processing is already running.",
    "de": "Eine lokale Verarbeitung läuft bereits."
  },
  "runtime.pipelineTimeout": {
    "en": "Local processing has taken longer than five minutes. Use a smaller source.",
    "de": "Die lokale Verarbeitung dauert länger als fünf Minuten. Bitte verwende eine kleinere Quelle."
  },
  "runtime.pipelineWorkerUnavailable": {
    "en": "The local worker could not start. Check browser support and static assets.",
    "de": "Der lokale Worker konnte nicht gestartet werden. Bitte prüfe Browser-Unterstützung und statische Assets."
  },
  "runtime.pdfInitFailed": {
    "en": "PDF processing could not be initialized.",
    "de": "PDF-Verarbeitung konnte nicht initialisiert werden."
  },
  "runtime.modelLoading": {
    "en": "Loading local model",
    "de": "Lokales Modell wird geladen"
  },
  "runtime.tokenLimit": {
    "en": "A text section exceeds the token limit.",
    "de": "Ein Textabschnitt überschreitet das Tokenlimit."
  },
  "runtime.chunkSplitFailed": {
    "en": "Text sections could not be split safely.",
    "de": "Textabschnitte konnten nicht sicher geteilt werden."
  },
  "runtime.sourceChunkLimit": {
    "en": "The text needs more than 1,000 chunks. Use a smaller source.",
    "de": "Der Text benötigt mehr als 1.000 Chunks. Bitte verwende eine kleinere Quelle."
  },
  "runtime.documentReading": {
    "en": "Reading document",
    "de": "Dokument wird gelesen"
  },
  "runtime.sourceNoText": {
    "en": "The source has no extractable text. Scans require OCR, which this version does not support.",
    "de": "Die Quelle enthält keinen extrahierbaren Text. Scans benötigen OCR und werden in dieser Version nicht unterstützt."
  },
  "runtime.notebookCharacterLimit": {
    "en": "The notebook exceeds 500,000 characters.",
    "de": "Das Notebook überschreitet das Limit von 500.000 Zeichen."
  },
  "runtime.notebookChunkLimit": {
    "en": "The notebook exceeds 1,000 chunks.",
    "de": "Das Notebook überschreitet das Limit von 1.000 Chunks."
  },
  "runtime.sourceIndexing": {
    "en": "Indexing sources locally",
    "de": "Quellen werden lokal indexiert"
  },
  "runtime.modelVectorDimension": {
    "en": "The local model returned an unexpected vector dimension.",
    "de": "Das lokale Modell hat eine unerwartete Vektordimension geliefert."
  },
  "runtime.sourceIndexed": {
    "en": "Source indexed",
    "de": "Quelle fertig indexiert"
  },
  "runtime.questionTokenLimit": {
    "en": "The question is too long for the local search model. Shorten it.",
    "de": "Die Frage ist für das lokale Suchmodell zu lang. Bitte kürze sie."
  },
  "runtime.storageConflict": {
    "en": "Sources changed during processing. Try again.",
    "de": "Die Quellen haben sich während der Verarbeitung geändert. Bitte erneut versuchen."
  },
  "runtime.notebookRemoved": {
    "en": "This notebook has already been removed.",
    "de": "Dieses Notebook wurde bereits entfernt."
  },
  "runtime.sourceRemoved": {
    "en": "This source has already been removed.",
    "de": "Diese Quelle wurde bereits entfernt."
  },
  "runtime.storageModelMismatch": {
    "en": "This index uses a different model version. Remove the affected sources and index them again.",
    "de": "Dieser Index verwendet eine andere Modellversion. Bitte entferne die betroffenen Quellen und indexiere sie erneut."
  },
  "runtime.storageNotebookLimit": {
    "en": "The notebook limit was reached (10 sources, 500,000 characters or 1,000 chunks). Use another notebook.",
    "de": "Das Notebook-Limit ist erreicht (10 Quellen, 500.000 Zeichen oder 1.000 Chunks). Bitte verwende ein weiteres Notebook."
  },
  "runtime.storageIndexIncomplete": {
    "en": "The local index is incomplete; the source was not saved.",
    "de": "Der lokale Index ist unvollständig; die Quelle wurde nicht gespeichert."
  },
  "runtime.storagePodcastPath": {
    "en": "Podcast data requires the protected audio storage path.",
    "de": "Podcast-Daten benötigen den abgesicherten Audio-Speicherpfad."
  },
  "runtime.storageInvalidDraft": {
    "en": "Invalid podcast draft.",
    "de": "Ungültiger Podcast-Entwurf."
  },
  "runtime.storageInvalidSegment": {
    "en": "Invalid or already saved audio segment.",
    "de": "Ungültiges oder bereits gespeichertes Audiosegment."
  },
  "runtime.storageIncompletePodcast": {
    "en": "The finished podcast is incomplete or invalid.",
    "de": "Der fertige Podcast ist unvollständig oder ungültig."
  },
  "runtime.rustUtf8": {
    "en": "The text file is not valid UTF-8.",
    "de": "Die Textdatei ist nicht gültig als UTF-8 kodiert."
  },
  "runtime.rustBinary": {
    "en": "The file contains binary data; use UTF-8 text.",
    "de": "Die Datei enthält Binärdaten; bitte UTF-8-Text verwenden."
  },
  "runtime.rustCharacters": {
    "en": "The source exceeds 500,000 extracted characters.",
    "de": "Die Quelle überschreitet 500.000 extrahierte Zeichen."
  },
  "runtime.rustNoText": {
    "en": "The source has no searchable text.",
    "de": "Die Quelle enthält keinen durchsuchbaren Text."
  },
  "runtime.rustEmptyFile": {
    "en": "The file is empty.",
    "de": "Die Datei ist leer."
  },
  "runtime.rustFileSize": {
    "en": "The file exceeds 10 MiB.",
    "de": "Die Datei überschreitet die Grenze von 10 MiB."
  },
  "runtime.rustChunkConfig": {
    "en": "Chunk size must be positive and overlap smaller than its size.",
    "de": "Chunk-Größe muss positiv und Überlappung kleiner als die Größe sein."
  },
  "runtime.rustPages": {
    "en": "Invalid or too many source pages.",
    "de": "Ungültige oder zu viele Quellseiten."
  },
  "runtime.rustVectors": {
    "en": "Invalid vector dimensions.",
    "de": "Ungültige Vektor-Dimensionen."
  },
  "runtime.rustNonFiniteVectors": {
    "en": "Vectors contain non-finite values.",
    "de": "Vektoren enthalten nicht-endliche Werte."
  },
  "runtime.rustEmptyVector": {
    "en": "The search vector is empty; index again.",
    "de": "Der Suchvektor ist leer; bitte erneut indexieren."
  },
  "runtime.rustTransfer": {
    "en": "The WASM result could not be transferred.",
    "de": "WASM-Ergebnis konnte nicht übertragen werden."
  },
  "runtime.rustPageFormat": {
    "en": "Invalid page format.",
    "de": "Ungültiges Seitenformat."
  },
  "runtime.rustPdfPages": {
    "en": "The PDF exceeds 2,000 pages.",
    "de": "Die PDF überschreitet die Grenze von 2.000 Seiten."
  },
  "runtime.rustPdfNoText": {
    "en": "The PDF has no extractable text. Scanned PDFs require OCR, which is not included here.",
    "de": "Die PDF enthält keinen extrahierbaren Text. Gescannte PDFs benötigen OCR, die hier nicht enthalten ist."
  },
  "runtime.rustPdfEncrypted": { en: "The PDF is encrypted or password-protected. Use an unprotected file.", de: "Die PDF ist verschlüsselt oder passwortgeschützt. Bitte eine ungeschützte Datei verwenden." },
  "runtime.rustPdfNotInitialized": { en: "Pdfium has not been initialized.", de: "Pdfium wurde noch nicht initialisiert." },
  "runtime.rustPdfUnavailable": { en: "Pdfium is unavailable.", de: "Pdfium ist nicht verfügbar." },
  "runtime.rustPdfDamaged": { en: "The PDF is damaged or unreadable.", de: "Die PDF ist beschädigt oder kann nicht gelesen werden." }
} as const satisfies Record<string, CatalogEntry>;
