import type { Provider } from './types';
export const PROVIDER_NAMES: Record<Provider, string> = { mistral: 'Mistral direkt', openrouter: 'OpenRouter' };
export const MODEL_NAMES: Record<Provider, string> = { mistral: 'Mistral Small 4 · EU-Endpunkt', openrouter: 'Mistral Small 4 · OpenRouter' };
export const MODEL_IDS: Record<Provider, string> = { mistral: 'mistral-small-2603', openrouter: 'mistralai/mistral-small-2603' };
export const ENDPOINTS: Record<Provider, string> = { mistral: 'https://api.eu.mistral.ai/v1/chat/completions', openrouter: 'https://openrouter.ai/api/v1/chat/completions' };
export const LIMITS = { fileBytes: 10 * 1024 * 1024, sources: 10, characters: 500_000, chunks: 1000, contextCharacters: 24_000 };
export const EMBEDDING_VERSION = 'multilingual-e5-small:761b726dd34fb83930e26aab4e9ac3899aa1fa78:q8:mean:normalized:v1';
export const MODEL_CACHE = 'researchbench-models-v1';
