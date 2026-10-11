/** Narrows to a plain object. Fields stay `unknown`; read each one with a typed check. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
