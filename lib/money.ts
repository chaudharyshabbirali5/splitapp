/**
 * Money is integer paise everywhere (TRD Section 3). Nothing here produces a
 * fractional number, and no arithmetic is done on a float.
 */

/** Largest amount accepted: ₹9,99,99,999.99 — comfortably inside Number.MAX_SAFE_INTEGER. */
const MAX_PAISE = 99_999_999_99;

/**
 * Parses user-entered rupees into integer paise.
 *
 * "100.50" -> 10050, "1,200" -> 120000, "₹99.9" -> 9990.
 * Returns null for anything malformed rather than guessing.
 *
 * The fractional part is parsed as its own integer and added, so a value like
 * 100.50 never goes through 100.5 * 100 — which is 10049.999999999998 in
 * binary floating point and would truncate to the wrong paise.
 */
export function parseRupeesToPaise(raw: string): number | null {
  const cleaned = raw.trim().replace(/[₹,\s]/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));

  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_PAISE) return null;
  return paise;
}

/**
 * Renders paise as ₹ with two decimals and Indian digit grouping.
 *
 * Accepts bigint so balance values, which are read as bigint to avoid any
 * float rounding, can be printed without converting back through Number.
 */
export function formatPaise(paise: number | bigint): string {
  const negative = paise < 0;
  const abs = typeof paise === 'bigint' ? (negative ? -paise : paise) : Math.abs(paise);

  const rupees = typeof abs === 'bigint' ? abs / 100n : Math.trunc(abs / 100);
  const rest = typeof abs === 'bigint' ? abs % 100n : abs % 100;

  const grouped =
    typeof rupees === 'bigint'
      ? BigInt(rupees).toLocaleString('en-IN')
      : rupees.toLocaleString('en-IN');

  return `${negative ? '-' : ''}₹${grouped}.${String(rest).padStart(2, '0')}`;
}

/** Plain rupees string for prefilling a number input, e.g. 10050 -> "100.50". */
export function paiseToRupeeInput(paise: number): string {
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}
