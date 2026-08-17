import { paiseToAmountString } from './money';

/**
 * Builds a UPI deep link (TRD Section 8):
 *
 *   upi://pay?pa={vpa}&pn={name}&am={rupees}&cu=INR&tn={note}
 *
 * `am` comes from paiseToAmountString, so it is derived from integer paise and
 * carries exactly two decimals — 10001 becomes "100.01", never 100.00999999.
 *
 * Encoding note: '@' is legal unencoded in a URI query (RFC 3986 pchar includes
 * '@'), and UPI apps in the wild expect to see it that way in `pa`, so it is
 * restored after encoding. Everything else is percent-encoded normally, which
 * matters for `pn` and `tn` where spaces and punctuation are common.
 *
 * This only resolves on a device with a UPI app installed. On desktop the
 * browser has nothing to hand it to, and that is expected — there is no reliable
 * way to detect whether the payment happened, which is why confirmation is
 * manual.
 */
export function buildUpiLink({
  payeeVpa,
  payeeName,
  amountMinor,
  note,
}: {
  payeeVpa: string;
  payeeName: string;
  amountMinor: number | bigint;
  note: string;
}): string {
  const pa = encodeURIComponent(payeeVpa.trim()).replace(/%40/g, '@');
  const pn = encodeURIComponent(payeeName.trim());
  const am = paiseToAmountString(amountMinor);
  const tn = encodeURIComponent(note.trim());

  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

/** Short transaction note, kept well inside what UPI apps display. */
export function settleNote(groupName: string): string {
  const trimmed = groupName.trim();
  const base = trimmed.length > 24 ? `${trimmed.slice(0, 24).trimEnd()}…` : trimmed;
  return `${base} settle`;
}
