export const ACCESS_MODES = Object.freeze(['everyone', 'owner-only', 'allowlist']);
export const MAX_ALLOWED_NUMBERS = 100;

// Store international phone numbers as digits; never interpret a LID or other JID as a number.
export function normalizePhoneNumber(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const text = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(text)) return null;
  const digits = text.replace(/[ ()-]/g, '').replace(/^\+/, '');
  return /^[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}
