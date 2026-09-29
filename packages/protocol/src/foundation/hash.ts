import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json";

export type Sha256Digest = `sha256:${string}`;

export function sha256(input: string | Uint8Array): Sha256Digest {
  const digest = createHash("sha256").update(input).digest("hex");
  return `sha256:${digest}`;
}

export function canonicalHash(value: unknown): Sha256Digest {
  return sha256(canonicalJson(value));
}
