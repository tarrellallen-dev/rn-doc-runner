/** Mirrors synthetic-ehr's render.ts sanitizeId() exactly, so allowlist selectors stay in lockstep with rendered ids. */
export function controlSelector(key: string): string {
  return `#ctrl-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
