import {
  type EvidenceBundle,
  type EvidenceItem,
  escapeEvidenceText,
  identityOf,
  normalizeEvidenceText,
  type ValidationIssue,
  type ValidationResult,
  validateEvidenceBundle,
} from "@lorelum/judge-protocol";

import { isRecord } from "./type-guards.js";

export const EVIDENCE_CONTENT_SCHEMA = "lorelum.judge.evidence-content/v1";
export const EVIDENCE_ITEM_SCHEMA = "lorelum.judge.evidence-item/v1";
export const EVIDENCE_BUNDLE_SCHEMA = "lorelum.judge.evidence-bundle/v1";

export const EVIDENCE_ID = /^[A-Za-z0-9_.:-]+$/;

export type EvidenceStatus = EvidenceItem["status"];

export interface EvidenceMaterial {
  readonly id: string;
  readonly status: EvidenceStatus;
  /** Required for `present` and `contradiction`; forbidden otherwise. */
  readonly text?: string;
  readonly conflictsWith?: readonly string[];
}

/**
 * Mechanical normalization applied before rendering or hashing: NFC, LF line
 * endings, and no trailing spaces or tabs. Text that differs only in these ways
 * produces identical output and identities.
 */
export const normalizeText = normalizeEvidenceText;
export { escapeEvidenceText };

export function isWellFormed(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

function issue(path: string, message: string): ValidationIssue {
  return { path, code: "schema", message };
}

/**
 * Validates raw materials and normalizes their text exactly once. Both the
 * program path and prompt compilation consume this copy.
 */
export function validateMaterials(raw: unknown): ValidationResult<EvidenceMaterial[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [issue("$.evidence", "evidence must be an array")] };
  }
  const issues: ValidationIssue[] = [];
  const materials: EvidenceMaterial[] = [];
  for (const [index, entry] of raw.entries()) {
    const path = `$.evidence[${index}]`;
    if (!isRecord(entry)) {
      issues.push(issue(path, "evidence item must be an object"));
      continue;
    }
    const { id, status, text, conflictsWith } = entry;
    if (typeof id !== "string" || !EVIDENCE_ID.test(id)) {
      issues.push(issue(`${path}.id`, "id must match ^[A-Za-z0-9_.:-]+$"));
      continue;
    }
    if (
      status !== "present" &&
      status !== "no_evidence" &&
      status !== "unavailable" &&
      status !== "contradiction"
    ) {
      issues.push(issue(`${path}.status`, "unknown status"));
      continue;
    }
    if (typeof text === "string" && !isWellFormed(text)) {
      issues.push(issue(`${path}.text`, "text must be well-formed Unicode"));
      continue;
    }
    const hasText = status === "present" || status === "contradiction";
    if (hasText && typeof text !== "string") {
      issues.push(issue(`${path}.text`, `status "${status}" requires text`));
      continue;
    }
    if (!hasText && text !== undefined) {
      issues.push(issue(`${path}.text`, `status "${status}" must not carry text`));
      continue;
    }
    if (conflictsWith !== undefined) {
      if (
        !Array.isArray(conflictsWith) ||
        !conflictsWith.every((other) => typeof other === "string" && EVIDENCE_ID.test(other))
      ) {
        issues.push(issue(`${path}.conflictsWith`, "conflictsWith must be a list of valid ids"));
        continue;
      }
    }
    materials.push({
      id,
      status,
      ...(hasText ? { text: normalizeText(text as string) } : {}),
      ...(conflictsWith === undefined ? {} : { conflictsWith: [...conflictsWith] as string[] }),
    });
  }
  return issues.length === 0 ? { ok: true, value: materials } : { ok: false, issues };
}

export interface ManifestOptions {
  /** Characters (code points) of evidence text that may be shown. */
  readonly budget?: number;
  /** Escape block markers before lengths and hashing. */
  readonly escape?: boolean;
  /** Sort items by id; the prompt renderer requires this, the program path does not. */
  readonly sort?: boolean;
}

export interface RenderedEvidence {
  readonly id: string;
  readonly status: EvidenceStatus;
  readonly conflictsWith?: readonly string[];
  readonly text?: string;
  readonly state?: "rendered" | "truncated" | "withheld";
  readonly originalLength?: number;
  readonly renderedLength?: number;
}

export interface ManifestResult {
  readonly manifest: EvidenceBundle;
  /** Caller index of each manifest item, in manifest order. */
  readonly sources: readonly number[];
  readonly rendered: readonly RenderedEvidence[];
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

function remapItemPath(path: string, sources: readonly number[]): string {
  const match = /^\$\.items\[(\d+)\](.*)$/.exec(path);
  if (match === null) return path;
  const source = sources[Number(match[1])];
  return source === undefined ? path : `$.evidence[${source}]${match[2] ?? ""}`;
}

/**
 * Builds one manifest from already validated materials. The program path uses no
 * budget or escaping; prompt compilation renders and escapes within its budget.
 */
export function buildManifest(
  materials: readonly EvidenceMaterial[],
  options: ManifestOptions = {},
): ValidationResult<ManifestResult> {
  const order = materials
    .map((material, index) => ({ material, index }))
    .sort((left, right) =>
      options.sort === true
        ? left.material.id < right.material.id
          ? -1
          : left.material.id > right.material.id
            ? 1
            : 0
        : left.index - right.index,
    );
  const items: EvidenceItem[] = [];
  const sources: number[] = [];
  const rendered: RenderedEvidence[] = [];
  let remaining = options.budget;

  for (const { material, index } of order) {
    const conflicts =
      material.conflictsWith === undefined ? undefined : [...material.conflictsWith].sort();
    sources.push(index);
    if (material.text === undefined) {
      items.push({
        schema: EVIDENCE_ITEM_SCHEMA,
        id: material.id,
        status: material.status,
        ...(conflicts === undefined ? {} : { conflictsWith: conflicts }),
      });
      rendered.push({
        id: material.id,
        status: material.status,
        ...(conflicts === undefined ? {} : { conflictsWith: conflicts }),
      });
      continue;
    }

    const raw = normalizeText(material.text);
    const contentIdentity = identityOf(EVIDENCE_CONTENT_SCHEMA, raw);
    if (!contentIdentity.ok) {
      return {
        ok: false,
        issues: [
          issue(
            `$.evidence[${index}].text`,
            `content identity failed: ${contentIdentity.error.reason}`,
          ),
        ],
      };
    }

    const text = options.escape === true ? escapeEvidenceText(raw) : raw;
    const characters = codePoints(text);
    const originalLength = characters.length;
    let state: "rendered" | "truncated" | "withheld";
    let kept: string;
    if (remaining === undefined || (remaining > 0 && originalLength <= remaining)) {
      state = "rendered";
      kept = text;
      if (remaining !== undefined) remaining -= originalLength;
    } else if (remaining > 0) {
      state = "truncated";
      kept = characters.slice(0, remaining).join("");
      remaining = 0;
    } else {
      state = "withheld";
      kept = "";
    }
    const renderedLength = codePoints(kept).length;
    items.push({
      schema: EVIDENCE_ITEM_SCHEMA,
      id: material.id,
      status: material.status,
      contentIdentity: contentIdentity.identity,
      render: { state, originalLength, renderedLength },
      ...(conflicts === undefined ? {} : { conflictsWith: conflicts }),
    });
    rendered.push({
      id: material.id,
      status: material.status,
      ...(conflicts === undefined ? {} : { conflictsWith: conflicts }),
      text: kept,
      state,
      originalLength,
      renderedLength,
    });
  }

  const manifest: EvidenceBundle = { schema: EVIDENCE_BUNDLE_SCHEMA, items };
  const checked = validateEvidenceBundle(manifest);
  return checked.ok
    ? { ok: true, value: { manifest: checked.value, sources, rendered } }
    : {
        ok: false,
        issues: checked.issues.map((entry) => ({
          ...entry,
          path: remapItemPath(entry.path, sources),
        })),
      };
}
