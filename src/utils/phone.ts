/**
 * Phone number formatting utilities for Persepolis Vancouver Football Club Society (PVFCS).
 * Enforces live xxx-xxx-xxxx formatting with automatic hyphenation
 * and strict numeric-only input.
 */

export function formatPhoneNumber(raw: string | undefined | null): string {
  if (!raw) return '';
  // Strip optional leading +1 country code from pre-existing stored numbers if followed by 10 digits
  const cleaned = String(raw)
    .trim()
    .replace(/^\+?1(?=[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$)/, '');
  // Strip everything that is not a numeric digit, maximum 10 digits
  const digits = cleaned.replace(/\D/g, '').slice(0, 10);
  if (!digits) return '';
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidPhoneNumber(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const formatted = formatPhoneNumber(raw);
  const digits = formatted.replace(/\D/g, '');
  return digits.length === 10;
}
