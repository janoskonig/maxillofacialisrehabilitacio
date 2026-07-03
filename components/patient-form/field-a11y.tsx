/**
 * Akadálymentes mezőhiba-megjelenítés a betegkarton űrlaphoz.
 *
 * A hibás inputra `aria-invalid` + `aria-describedby` kerül, a hibaszöveg
 * pedig azonosítóval rendelkező <p>-ben jelenik meg, így a képernyőolvasó
 * a mezőre lépve felolvassa a hibát is.
 */

export function fieldErrorId(name: string): string {
  return `field-error-${name}`;
}

/** Input aria-attribútumai: hibánál invalid + a hibaszövegre mutató describedby. */
export function fieldAriaProps(name: string, hasError: boolean, describedByWithoutError?: string) {
  return {
    'aria-invalid': hasError || undefined,
    'aria-describedby': hasError ? fieldErrorId(name) : describedByWithoutError,
  } as const;
}

interface FieldErrorTextProps {
  name: string;
  message?: string;
}

export function FieldErrorText({ name, message }: FieldErrorTextProps) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(name)} className="text-red-500 dark:text-red-400 text-sm mt-1">
      {message}
    </p>
  );
}
