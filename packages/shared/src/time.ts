export function isoNow(): string {
  return new Date().toISOString();
}

export function parseIso(iso: string): Date {
  return new Date(iso);
}
