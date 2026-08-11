import type { StageCatalogEntry } from '@/lib/types/episode';

export type StepperItemState = 'past' | 'current' | 'future';

export interface StepperItem {
  entry: StageCatalogEntry;
  state: StepperItemState;
  /** A javaslat-motor ezt a stádiumot javasolja (és nem ez a jelenlegi). */
  suggested: boolean;
}

/**
 * A stádium-stepper megjelenítési állapota a katalógus + jelenlegi stádium +
 * javaslat hármasból. Ha a jelenlegi kód nincs a katalógusban (pl. etiológia-
 * váltás vagy adathiba), egyik elem sem 'current' és minden elem 'future' —
 * a hívó a nyers kódot jelenítheti meg fallbackként.
 */
export function buildStepperItems(
  catalog: StageCatalogEntry[],
  currentStageCode: string | null,
  suggestedStage?: string | null
): StepperItem[] {
  const currentIdx = currentStageCode
    ? catalog.findIndex((c) => c.code === currentStageCode)
    : -1;
  return catalog.map((entry, i) => ({
    entry,
    state:
      currentIdx >= 0 && i === currentIdx
        ? 'current'
        : currentIdx >= 0 && i < currentIdx
          ? 'past'
          : 'future',
    suggested:
      !!suggestedStage &&
      entry.code === suggestedStage &&
      suggestedStage !== currentStageCode,
  }));
}

/** Visszafelé lépés-e (korábbi stádiumra állítás) a katalógus-sorrend szerint. */
export function isBackwardMove(
  catalog: StageCatalogEntry[],
  fromCode: string | null,
  toCode: string
): boolean {
  if (!fromCode) return false;
  const from = catalog.findIndex((c) => c.code === fromCode);
  const to = catalog.findIndex((c) => c.code === toCode);
  return from >= 0 && to >= 0 && to < from;
}

/** Címke-feloldás a katalógusból, nyers kód fallbackkel. */
export function stageLabelFor(catalog: StageCatalogEntry[], code: string | null): string {
  if (!code) return '—';
  return catalog.find((c) => c.code === code)?.labelHu ?? code;
}
