import type { KeyboardEvent } from 'react';

export function focusableControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('input,select,textarea,button,a[href],summary,[tabindex="0"]')).filter(el =>
    !el.matches(':disabled,[readonly],[type="hidden"],[tabindex="-1"]') &&
    !el.closest('[hidden],[inert]') &&
    !Array.from(el.closest('details:not([open])')?.children ?? []).some(child => child.tagName !== 'SUMMARY' && child.contains(el)) &&
    el.getClientRects().length > 0);
}

export function nextControl(current: HTMLElement | null, backwards = false): HTMLElement | undefined {
  const root = current?.closest<HTMLElement>('form,tr,[role="dialog"]');
  if (!root || !current) return;
  const controls = focusableControls(root);
  const index = controls.indexOf(current);
  return index < 0 ? undefined : controls[index + (backwards ? -1 : 1)];
}

// Preserve native Tab/Shift+Tab and multiline text; Enter advances single-line fields.
export function enterNextField(event: KeyboardEvent<HTMLFormElement>) {
  if (event.defaultPrevented || !['Enter','ArrowDown','ArrowUp','ArrowRight','ArrowLeft'].includes(event.key) || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target) || !target.matches('input:not([type="submit"]):not([type="button"]),select')) return;
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!event.repeat) nextControl(target, event.shiftKey || ['ArrowUp','ArrowLeft'].includes(event.key))?.focus();
}

export function receptionShortcut(event: Pick<KeyboardEvent, 'altKey'|'ctrlKey'|'metaKey'|'shiftKey'|'repeat'|'code'|'target'>): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return null;
  const target = event.target as HTMLElement;
  if (target.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="combobox"]')) return null;
  return ({KeyN:'new',KeyA:'active',KeyP:'app',KeyQ:'queue'} as Record<string,string>)[event.code] ?? null;
}
