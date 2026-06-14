/**
 * Single source of truth for the privacy notice (adatvédelmi tájékoztató) version.
 *
 * Bump CURRENT_PRIVACY_POLICY_VERSION whenever the privacy notice content
 * materially changes. The consent-obligation check gates on the CURRENT version,
 * so a bump automatically re-prompts every patient to acknowledge the new notice.
 *
 * Keep the rendered page (app/privacy-hu/page.tsx) in sync with these values.
 */
export const CURRENT_PRIVACY_POLICY_VERSION = '1.1';

/** ISO date the current version took effect (display only). */
export const CURRENT_PRIVACY_POLICY_EFFECTIVE_FROM = '2026-04-03';
