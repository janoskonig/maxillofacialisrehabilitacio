/** Scroll a buborékhoz; ismétli, amíg a DOM fel nem épül (beszélgetésváltás után). */
export async function scrollToMessageWithRetry(
  scrollTo: (messageId: string) => boolean,
  messageId: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 120;

  for (let i = 0; i < attempts; i++) {
    if (scrollTo(messageId)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export function highlightMessageElement(messageId: string, container?: HTMLElement | null): boolean {
  const root = container ?? document;
  const el =
    root instanceof Document
      ? root.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      : root.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-amber-400', 'rounded-lg');
  window.setTimeout(() => {
    el.classList.remove('ring-2', 'ring-amber-400', 'rounded-lg');
  }, 1600);
  return true;
}
