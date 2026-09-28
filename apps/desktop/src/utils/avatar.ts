/** Up to two uppercase letters from a display name, Telegram-style
 * ("Иван Петров" -> "ИП", "Admin" -> "AD"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// A calm, muted palette (no saturated/neon colors) so avatars stay
// consistent with the app's overall "спокойные тона" design direction.
const PALETTE = [
  "#b3785c",
  "#7a9569",
  "#5c8ea3",
  "#a3708c",
  "#8a7fbf",
  "#ab8a4a",
  "#5f9e8f",
  "#a4685f",
];

/** Deterministic color per id, so the same person always gets the same
 * avatar background across the whole app. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}
