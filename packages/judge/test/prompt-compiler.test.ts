import { describe, expect, test } from "bun:test";

import { evidenceBundleIdentity, validateEvidenceBundle } from "@lorelum/judge-protocol";

import {
  type CompileResult,
  compilePrompt,
  type EvidenceMaterial,
  type PromptSpec,
  UNTRUSTED_NOTICE,
} from "../src/index.js";

function spec(overrides: Partial<PromptSpec> = {}): PromptSpec {
  return {
    system: "You assess evidence against the rule.",
    template: "Goal: {{goal}}\n\n{{evidence}}\n",
    variables: { goal: "Check the documented status codes" },
    evidenceBudget: 100,
    ...overrides,
  };
}

function present(id: string, text: string): EvidenceMaterial {
  return { id, status: "present", text };
}

function must(result: CompileResult) {
  if (!result.ok) {
    throw new Error(`expected a compiled prompt: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function codes(result: CompileResult): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function compile(prompt: PromptSpec, evidence: readonly EvidenceMaterial[]) {
  return compilePrompt({ prompt, evidence });
}

describe("order independence", () => {
  test("shuffled evidence yields the same messages, manifest, and identities", () => {
    const a = must(
      compile(spec(), [present("e1", "alpha"), present("e2", "beta"), present("e3", "gamma")]),
    );
    const b = must(
      compile(spec(), [present("e3", "gamma"), present("e1", "alpha"), present("e2", "beta")]),
    );
    expect(b.messages).toEqual(a.messages);
    expect(b.manifest).toEqual(a.manifest);
    expect(b.promptIdentity).toBe(a.promptIdentity);
    expect(b.renderIdentity).toBe(a.renderIdentity);
  });

  test("object key order in the input does not matter", () => {
    const evidence = [present("e1", "alpha")];
    const a = must(compilePrompt({ prompt: spec(), evidence }));
    const reordered = {
      evidence: [{ text: "alpha", status: "present", id: "e1" }],
      prompt: {
        evidenceBudget: 100,
        variables: { goal: "Check the documented status codes" },
        template: "Goal: {{goal}}\n\n{{evidence}}\n",
        system: "You assess evidence against the rule.",
      },
    };
    expect(must(compilePrompt(reordered)).renderIdentity).toBe(a.renderIdentity);
  });
});

describe("budget", () => {
  test("fills in id order, truncating the first item that does not fit", () => {
    const value = must(
      compile(spec({ evidenceBudget: 10 }), [present("e2", "ghijkl"), present("e1", "abcdef")]),
    );
    expect(value.manifest.items.map((item) => [item.id, item.render])).toEqual([
      ["e1", { state: "rendered", originalLength: 6, renderedLength: 6 }],
      ["e2", { state: "truncated", originalLength: 6, renderedLength: 4 }],
    ]);
    const user = value.messages[1]?.content ?? "";
    expect(user).toContain("abcdef");
    expect(user).toContain("ghij\n</evidence>");
    expect(user).not.toContain("ghijkl");
  });

  test("withholds every present item after the budget is spent", () => {
    const value = must(
      compile(spec({ evidenceBudget: 6 }), [present("e1", "abcdef"), present("e2", "xyz")]),
    );
    expect(value.manifest.items[1]?.render).toEqual({
      state: "withheld",
      originalLength: 3,
      renderedLength: 0,
    });
    expect(value.messages[1]?.content).toContain(
      '<evidence id="e2" status="present" render="withheld" original="3" rendered="0"/>',
    );
  });

  test("a zero budget withholds present evidence and still records it", () => {
    const value = must(compile(spec({ evidenceBudget: 0 }), [present("e1", "abc")]));
    expect(value.manifest.items[0]?.render?.state).toBe("withheld");
    expect(value.messages[1]?.content).toContain('render="withheld"');
  });

  test("counts code points, so a truncation never splits a surrogate pair", () => {
    const value = must(compile(spec({ evidenceBudget: 1 }), [present("e1", "😀😀")]));
    expect(value.manifest.items[0]?.render).toEqual({
      state: "truncated",
      originalLength: 2,
      renderedLength: 1,
    });
    expect(value.messages[1]?.content).toContain("😀\n</evidence>");
  });

  test("unavailable and no_evidence items render as lines and use no budget", () => {
    const value = must(
      compile(spec({ evidenceBudget: 0 }), [
        { id: "e1", status: "unavailable" },
        { id: "e2", status: "no_evidence" },
      ]),
    );
    expect(value.messages[1]?.content).toContain('<evidence id="e1" status="unavailable"/>');
    expect(value.messages[1]?.content).toContain('<evidence id="e2" status="no_evidence"/>');
    expect(value.manifest.items.every((item) => item.render === undefined)).toBe(true);
  });

  test("states that no evidence was collected when there are no items", () => {
    const value = must(compile(spec(), []));
    expect(value.messages[1]?.content).toContain("No evidence was collected.");
  });

  test.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])("rejects budget %p", (budget) => {
    expect(codes(compile(spec({ evidenceBudget: budget }), []))).toEqual(["invalid_budget"]);
  });
});

describe("manifest", () => {
  test("validates as an evidence bundle", () => {
    const value = must(
      compile(spec({ evidenceBudget: 8 }), [
        present("e1", "abcdef"),
        present("e2", "ghijkl"),
        { id: "e3", status: "unavailable" },
      ]),
    );
    expect(validateEvidenceBundle(value.manifest).ok).toBe(true);
    expect(evidenceBundleIdentity(value.manifest).ok).toBe(true);
  });

  test("a contradiction shows both sides and names its counterpart", () => {
    const value = must(
      compile(spec(), [
        present("e1", "passes"),
        { id: "e2", status: "contradiction", text: "fails", conflictsWith: ["e1"] },
      ]),
    );
    expect(value.messages[1]?.content).toContain("passes");
    expect(value.messages[1]?.content).toContain('conflicts="e1"');
    expect(value.messages[1]?.content).toContain("fails");
  });

  test("a conflict naming an id that is not in the bundle is rejected", () => {
    const result = compile(spec(), [
      { id: "e2", status: "contradiction", text: "fails", conflictsWith: ["missing"] },
    ]);
    expect(codes(result)).toEqual(["invalid_evidence"]);
  });

  test("a non-contradiction carrying conflicts is rejected by the manifest check", () => {
    const result = compile(spec(), [{ id: "e1", status: "unavailable", conflictsWith: ["e2"] }]);
    expect(result.ok).toBe(false);
    expect(codes(result).every((code) => code === "invalid_evidence")).toBe(true);
  });
});

describe("evidence input", () => {
  test.each([
    ["an id with a quote", { id: 'e"1', status: "unavailable" }],
    ["an id with a space", { id: "e 1", status: "unavailable" }],
    ["an unknown status", { id: "e1", status: "maybe" }],
    ["present without text", { id: "e1", status: "present" }],
    ["unavailable with text", { id: "e1", status: "unavailable", text: "x" }],
  ])("rejects %s", (_name, material) => {
    expect(codes(compilePrompt({ prompt: spec(), evidence: [material] }))).toEqual([
      "invalid_evidence",
    ]);
  });

  test("duplicate ids are rejected by the manifest check", () => {
    expect(codes(compile(spec(), [present("e1", "a"), present("e1", "b")]))).toEqual([
      "invalid_evidence",
    ]);
  });
});

describe("variables", () => {
  test("a missing binding fails", () => {
    expect(codes(compile(spec({ variables: {} }), []))).toEqual(["unbound_variable"]);
  });

  test("an extra binding fails", () => {
    expect(codes(compile(spec({ variables: { goal: "g", extra: "e" } }), []))).toEqual([
      "unknown_variable",
    ]);
  });

  test("binding the reserved name fails", () => {
    expect(codes(compile(spec({ variables: { goal: "g", evidence: "e" } }), []))).toEqual([
      "reserved_variable",
    ]);
  });

  test("an invalid variable name fails", () => {
    expect(
      codes(compile(spec({ variables: { Goal: "g" }, template: "{{Goal}}\n{{evidence}}" }), [])),
    ).toEqual(["invalid_variable_name"]);
  });

  test("evidence must appear exactly once", () => {
    const none = { goal: "g" };
    expect(codes(compile(spec({ template: "{{goal}}", variables: none }), []))).toEqual([
      "evidence_placeholder",
    ]);
    expect(
      codes(compile(spec({ template: "{{evidence}} {{evidence}}", variables: {} }), [])),
    ).toEqual(["evidence_placeholder"]);
  });

  test("a value containing a placeholder is not expanded", () => {
    const value = must(
      compile(spec({ variables: { goal: "{{evidence}} and {{goal}}" } }), [present("e1", "real")]),
    );
    const user = value.messages[1]?.content ?? "";
    expect(user).toContain("Goal: {{evidence}} and {{goal}}");
    expect(user.split('<evidence id="e1"').length - 1).toBe(1);
  });
});

describe("untrusted notice", () => {
  test("the system message ends with the fixed notice", () => {
    const value = must(compile(spec(), []));
    expect(value.messages[0]?.content.endsWith(UNTRUSTED_NOTICE)).toBe(true);
    expect(value.messages[0]?.role).toBe("system");
    expect(value.messages[1]?.role).toBe("user");
  });
});

describe("normalization", () => {
  test("CRLF, trailing spaces, and NFC versus NFD do not change any identity", () => {
    const plain = must(
      compile(spec({ template: "Goal: {{goal}}\n\n{{evidence}}\n", variables: { goal: "café" } }), [
        present("e1", "line one\nline two"),
      ]),
    );
    const noisy = must(
      compile(
        spec({
          template: "Goal: {{goal}}  \r\n\r\n{{evidence}}\r\n",
          variables: { goal: "cafe\u0301" },
        }),
        [present("e1", "line one  \r\nline two\t")],
      ),
    );
    expect(noisy.promptIdentity).toBe(plain.promptIdentity);
    expect(noisy.renderIdentity).toBe(plain.renderIdentity);
    expect(noisy.manifest).toEqual(plain.manifest);
  });

  test("one changed word changes the prompt identity", () => {
    const a = must(compile(spec(), []));
    const b = must(compile(spec({ system: "You assess evidence against the rules." }), []));
    expect(b.promptIdentity).not.toBe(a.promptIdentity);
  });

  test("one changed word in evidence changes the content and render identity", () => {
    const a = must(compile(spec(), [present("e1", "alpha beta")]));
    const b = must(compile(spec(), [present("e1", "alpha gamma")]));
    expect(b.manifest.items[0]?.contentIdentity).not.toBe(a.manifest.items[0]?.contentIdentity);
    expect(b.renderIdentity).not.toBe(a.renderIdentity);
  });
});

describe("identity scopes", () => {
  test("a variable value changes only the render identity", () => {
    const a = must(compile(spec(), []));
    const b = must(compile(spec({ variables: { goal: "Something else" } }), []));
    expect(b.promptIdentity).toBe(a.promptIdentity);
    expect(b.renderIdentity).not.toBe(a.renderIdentity);
  });

  test("a variable name changes the prompt identity", () => {
    const a = must(compile(spec({ template: "{{goal}}\n{{evidence}}" }), []));
    const b = must(
      compile(spec({ template: "{{task}}\n{{evidence}}", variables: { task: "x" } }), []),
    );
    expect(b.promptIdentity).not.toBe(a.promptIdentity);
  });

  test("the budget changes the prompt identity", () => {
    const a = must(compile(spec({ evidenceBudget: 10 }), []));
    const b = must(compile(spec({ evidenceBudget: 11 }), []));
    expect(b.promptIdentity).not.toBe(a.promptIdentity);
  });

  test("the evidence changes the render identity but not the prompt identity", () => {
    const a = must(compile(spec(), [present("e1", "alpha")]));
    const b = must(compile(spec(), [present("e1", "beta")]));
    expect(b.promptIdentity).toBe(a.promptIdentity);
    expect(b.renderIdentity).not.toBe(a.renderIdentity);
  });
});

describe("never throws", () => {
  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "x"],
    ["array", []],
  ];

  test.each(inputs)("non-object input (%s) is a structured failure", (_name, bad) => {
    expect(codes(compilePrompt(bad))).toEqual(["invalid_input"]);
  });

  test("a throwing getter yields a failure carrying the cause", () => {
    const hostile = {
      get prompt(): unknown {
        throw new Error("boom");
      },
      evidence: [],
    };
    const result = compilePrompt(hostile);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.issues[0]?.message).toContain("boom");
  });
});
