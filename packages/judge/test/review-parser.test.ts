import { describe, expect, test } from "bun:test";

import { parseReviewResponse } from "../src/index.js";

describe("review response reader", () => {
  test("accepts bare JSON and surrounding whitespace", () => {
    const result = parseReviewResponse('  \n{"verdicts":[{"criterionId":"c1"}]}\n ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verdicts).toHaveLength(1);
  });

  test("accepts one json or unlabelled code block", () => {
    const json = '{"verdicts":[]}';
    expect(parseReviewResponse(`\`\`\`json\n${json}\n\`\`\``).ok).toBe(true);
    expect(parseReviewResponse(`\`\`\`\n${json}\n\`\`\``).ok).toBe(true);
  });

  test("refuses text outside or more than one block", () => {
    const result = parseReviewResponse('here you go\n```json\n{"verdicts":[]}\n```\nthanks');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("invalid_wrapper");

    const multiple = parseReviewResponse(
      '```json\n{"verdicts":[]}\n```\n```json\n{"verdicts":[]}\n```',
    );
    expect(multiple.ok).toBe(false);
  });

  test("refuses malformed JSON", () => {
    const result = parseReviewResponse('{"verdicts":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("malformed_json");
  });

  test("refuses duplicate keys at any depth", () => {
    const top = parseReviewResponse('{"verdicts":[],"verdicts":[]}');
    expect(top.ok).toBe(false);
    if (!top.ok) expect(top.issues[0]?.code).toBe("duplicate_key");

    const nested = parseReviewResponse('{"verdicts":[{"criterionId":"c1","criterionId":"c2"}]}');
    expect(nested.ok).toBe(false);
  });

  test("refuses unknown envelope fields", () => {
    const result = parseReviewResponse('{"verdicts":[],"score":1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("unknown_field");
  });

  test("refuses empty or non-array verdicts", () => {
    expect(parseReviewResponse("").ok).toBe(false);
    const result = parseReviewResponse('{"verdicts":{}}');
    expect(result.ok).toBe(false);
  });
});
