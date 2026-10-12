export type Provider = 'mistral' | 'openrouter';
export type SourceKind = 'pdf' | 'md' | 'txt';
export type GeneratorKind = 'summary' | 'faq' | 'study';
export interface PageText { page: number; text: string; }
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
export interface Artifact {
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
export interface SearchHit { chunk: Chunk; sourceName: string; score: number; }
export interface Progress { stage: string; current: number; total: number; detail?: string; }
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
}
