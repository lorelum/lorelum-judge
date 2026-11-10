import {
  type CodeProblem,
  type CodeSourceItem,
  identityOf,
  type SourceSnapshot,
} from "@lorelum/judge-protocol";

/** Compare the actual material and its relationship to the rest of the snapshot, not a claimed hash. */
export function matchingItem(
  original: SourceSnapshot,
  supplied: SourceSnapshot,
  id: string,
): boolean {
  const left = original.items.find((item) => item.id === id);
  const right = supplied.items.find((item) => item.id === id);
  if (!left || !right || !original.consistent || !supplied.consistent) return false;
  const same = (a: unknown, b: unknown) => {
    const x = identityOf("lorelum.judge.suggestion-comparison/v1", a as never);
    const y = identityOf("lorelum.judge.suggestion-comparison/v1", b as never);
    return x.ok && y.ok && x.identity === y.identity;
  };
  return same(left, right) && same(original.comparisons, supplied.comparisons);
}

export function usableProblem(
  problem: CodeProblem,
  original: SourceSnapshot,
  supplied: SourceSnapshot,
): string | undefined {
  if (!problem.evidenceIds.length || !problem.locations.length) return "missing_evidence";
  for (const id of problem.evidenceIds) {
    const item = original.items.find((entry) => entry.id === id);
    if (!item?.complete) return "incomplete_material";
    if (!supplied.items.some((entry) => entry.id === id)) return "incomplete_material";
    if (!matchingItem(original, supplied, id)) return "version_mismatch";
  }
  return undefined;
}

export function visibleLocations(
  problem: CodeProblem,
  shown: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  return problem.locations.some((location) => {
    const lines = shown.get(location.itemId);
    if (!lines) return false;
    for (let line = location.startLine; line <= location.endLine; line++)
      if (!lines.has(line)) return false;
    return true;
  });
}

export function codeItems(
  source: SourceSnapshot,
  problems: readonly CodeProblem[],
): CodeSourceItem[] {
  const ids = new Set(problems.flatMap((problem) => problem.evidenceIds));
  return source.items.filter((item) => ids.has(item.id));
}
