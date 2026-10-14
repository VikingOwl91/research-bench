/** Keep keyboard focus in native modal dialogs, including nested confirmations.
 * showModal() still owns inertness, Escape, and restoration to the opening control.
 */
export function modalKeyboard(node: HTMLDialogElement): { destroy(): void } {
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(node.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter(item => !item.matches(':disabled, [tabindex="-1"]') && item.getClientRects().length > 0
        && (!item.matches('input[type="radio"]') || (item as HTMLInputElement).checked));
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); node.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) {
      event.preventDefault(); first.focus();
    }
  }
  node.addEventListener('keydown', onKeydown);
  node.addEventListener('click', closeOnBackdrop);
  return { destroy: () => { node.removeEventListener('keydown', onKeydown); node.removeEventListener('click', closeOnBackdrop); } };
}

/** Dismiss only an actual backdrop click, not whitespace inside the dialog. */
export function closeOnBackdrop(event: MouseEvent): void {
  const dialog = event.currentTarget as HTMLDialogElement;
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}
