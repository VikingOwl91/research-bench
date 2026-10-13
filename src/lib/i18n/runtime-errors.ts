import { message, type MessageDescriptor, type MessageKey, type MessageParams } from './index';
import { errorDescriptor, localizedError } from './message';
import { runtimeMessages } from './runtime';
import type { Progress } from '../types';

// Only known application diagnostics cross the presentation boundary. Unknown provider,
// parser and platform payloads can contain document text or credentials and stay private.
const known = new Map<string, MessageKey>(Object.entries(runtimeMessages).filter(([, entry]) => !entry.de.includes('{')).map(([key, entry]) => [entry.de, key as MessageKey]));
export function legacyMessageDescriptor(text: string): MessageDescriptor | undefined {
  const key = known.get(text);
  return key ? message(key) : undefined;
}
export function runtimeErrorDescriptor(error: unknown): MessageDescriptor {
  const reference = errorDescriptor(error);
  if (reference) return reference;
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return message('runtime.quota');
  if (name === 'SecurityError') return message('runtime.storageBlocked');
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return legacyMessageDescriptor(text) ?? message('runtime.operationFailed');
}
export function runtimeError(key: MessageKey, params?: MessageParams) { return localizedError(key, params); }
export function localizedProgress(value: Progress): Progress {
  return {
    ...value,
    stageMessage: value.stageMessage ?? legacyMessageDescriptor(value.stage) ?? message(value.stage === 'encoding' ? 'runtime.audioEncoding' : 'runtime.processing'),
    ...(value.detail === undefined ? {} : { detailMessage: value.detailMessage ?? legacyMessageDescriptor(value.detail) ?? message('runtime.processing') })
  };
}
