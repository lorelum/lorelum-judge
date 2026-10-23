/** Canonical evidence normalization; preserves the v1 prompt and content identity. */
export function normalizeEvidenceText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

export function escapeEvidenceText(text: string): string {
  return text.replace(/<(\/?)(evidence)/gi, "&lt;$1$2");
}
