import { message, translateMessage, type MessageDescriptor, type MessageKey, type MessageParams } from './index';

/** Keep legacy diagnostic wording while presentation resolves the descriptor in the current UI locale. */
export class LocalizedError extends Error {
  readonly messageRef: MessageDescriptor;
  constructor(key: MessageKey, params?: MessageParams) {
    const descriptor = message(key, params);
    super(translateMessage('de', descriptor));
    this.name = 'LocalizedError'; this.messageRef = descriptor;
  }
}
export function localizedError(key: MessageKey, params?: MessageParams): LocalizedError { return new LocalizedError(key, params); }
export function errorDescriptor(error: unknown): MessageDescriptor | undefined {
  return error instanceof Error && 'messageRef' in error ? (error as LocalizedError).messageRef : undefined;
}
