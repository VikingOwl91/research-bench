import type { MessageDescriptor } from './i18n/index';

export type Provider = 'mistral' | 'openrouter';
export type SourceKind = 'pdf' | 'md' | 'txt';
export type GeneratorKind = 'summary' | 'faq' | 'study';
export type StudioKind = GeneratorKind | 'podcast';
export type PodcastLanguage = 'de' | 'en';
export type PodcastSpeaker = 'A' | 'B';
export interface HiddenSpan { start: number; end: number; kind: 'invisible' | 'white'; }
export interface PageText { page: number; text: string; hiddenSpans?: HiddenSpan[]; }
export interface Chunk {
  id: string;
  notebookId: string;
  sourceId: string;
  page: number;
  start: number;
  end: number;
  text: string;
}
export interface Source {
  id: string;
  notebookId: string;
  name: string;
  kind: SourceKind;
  size: number;
  createdAt: number;
  parser: string;
  original: Blob;
  pages: PageText[];
  chunkCount: number;
}
export interface Notebook { id: string; name: string; createdAt: number; revision: number; }
export interface Citation {
  id: string;
  sourceId: string;
  sourceName: string;
  page: number;
  start: number;
  end: number;
  text: string;
}
export interface AnswerBlock { heading?: string; text: string; citationIds: string[]; }
export interface GroundedAnswer { title: string; blocks: AnswerBlock[]; }
export interface ChatMessage {
  id: string;
  notebookId: string;
  revision: number;
  createdAt: number;
  role: 'user' | 'assistant';
  text: string;
  answer?: GroundedAnswer;
  citations: Citation[];
  provider?: Provider;
  model?: string;
}
export interface Coverage { selectedCharacters: number; totalCharacters: number; selectedSources: number; totalSources: number; limited: boolean; }
export interface TextArtifact {
  id: string;
  notebookId: string;
  revision: number;
  kind: GeneratorKind;
  createdAt: number;
  answer: GroundedAnswer;
  citations: Citation[];
  coverage: Coverage;
  provider: Provider;
  model: string;
}
export interface PodcastTurn {
  id: string;
  speaker: PodcastSpeaker;
  text: string;
  citationIds: string[];
}
export interface PodcastScript {
  title: string;
  language: PodcastLanguage;
  turns: PodcastTurn[];
}
export interface PodcastPcmFormat {
  sampleRate: number;
  channels: 1;
  encoding: 'f32le' | 's16le';
}
export interface PodcastAudioConfig {
  provider: Provider;
  model: string;
  voices: Record<PodcastSpeaker, { id: string; slug: string }>;
  format: 'wav' | 'pcm' | 'mp3';
  pcmFormat?: PodcastPcmFormat;
  encoderVersion: string;
  pauseMs: number;
  loudness?: 'speech-rms-v1';
}
export interface PodcastTiming { turnId: string; start: number; end: number; }
export interface PodcastAudioSegment {
  turnId: string;
  blob: Blob;
  mimeType: 'audio/wav' | 'audio/pcm' | 'audio/mpeg';
  pcmFormat?: PodcastPcmFormat;
  durationSeconds: number;
  sampleRate: number;
  sampleCount: number;
}
export interface PodcastRenderedAudio {
  blob: Blob;
  durationSeconds: number;
  timeline: PodcastTiming[];
  encodingMs: number;
  peakBufferBytes: number;
}
export interface PodcastArtifact {
  id: string;
  notebookId: string;
  revision: number;
  kind: 'podcast';
  createdAt: number;
  script: PodcastScript;
  citations: Citation[];
  coverage: Coverage;
  provider: Provider;
  model: string;
  audioConfig: PodcastAudioConfig;
  status: 'rendering' | 'paused' | 'ready';
  renderId: string | null;
  completedTurnIds: string[];
  durationSeconds?: number;
  timeline?: PodcastTiming[];
  encodingMs?: number;
  peakBufferBytes?: number;
}
export interface PodcastFence {
  notebookId: string;
  episodeId: string;
  language: PodcastLanguage;
  revision: number;
  dataEpoch: number;
  renderId: string;
  configSignature: string;
}
export type Artifact = TextArtifact | PodcastArtifact;
export interface SearchHit { chunk: Chunk; sourceName: string; score: number; }
export interface Progress { stage: string; current: number; total: number; detail?: string; stageMessage?: MessageDescriptor; detailMessage?: MessageDescriptor; }
export interface SourceSelection { source: Source; citation?: Citation; }
export interface AppSnapshot {
  notebooks: Notebook[];
  activeNotebook: Notebook | null;
  sources: Source[];
  messages: ChatMessage[];
  artifacts: Artifact[];
  searchHits: SearchHit[];
  progress: Progress | null;
  busy: boolean;
  provider: Provider;
  hasKey: boolean;
  error: string | null;
  errorMessage?: MessageDescriptor | null;
}
