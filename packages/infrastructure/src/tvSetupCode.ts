export const TV_SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' as const;

const TV_SETUP_CODE_COMPACT_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const TV_SETUP_CODE_GROUPED_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/**
 * Normalizes a Hosted protocol-v1 TV setup code for display and transport.
 * Hosted may provide either eight compact symbols or the canonical grouped form.
 */
export function formatTVSetupCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  if (TV_SETUP_CODE_GROUPED_PATTERN.test(code)) return code;
  if (!TV_SETUP_CODE_COMPACT_PATTERN.test(code)) return undefined;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
