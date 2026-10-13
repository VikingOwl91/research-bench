/** Display-only: preserve original names and all stored citation/source identities. */
export function displaySourceName(name: string): string {
  return name.replace(/[\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/gu, character =>
    `⟦U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`);
}
