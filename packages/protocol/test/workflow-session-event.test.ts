import { describe, expect, test } from "bun:test";
import {
  validateWorkflowSessionEvent,
  validateWorkflowSessionEvents,
  type WorkflowSessionEvent,
} from "../src/index.js";

const event: WorkflowSessionEvent = {
  schema: "workflow-session-event/v1",
  sessionId: "session_1",
  sequence: 1,
  stage: "proposed",
  actionId: "action_1",
  actionKind: "write",
  status: "proposed",
  reason: null,
};

describe("workflow session events", () => {
  test("accepts real lifecycle stages and preserves action association", () => {
    const events: WorkflowSessionEvent[] = [
      event,
      { ...event, sequence: 2, stage: "authorization", status: "allowed" },
      { ...event, sequence: 3, stage: "started", status: "started" },
      { ...event, sequence: 4, stage: "result", status: "completed" },
      {
        ...event,
        sequence: 5,
        stage: "check",
        actionId: "check_1",
        actionKind: "check",
        status: "passed",
      },
      {
        ...event,
        sequence: 6,
        stage: "terminal",
        actionId: null,
        actionKind: null,
        status: "completed",
      },
    ];
    expect(validateWorkflowSessionEvents(events)).toEqual({ ok: true, value: events });
  });

  test("represents denial, failed, unavailable, unknown, truncated and cancelled states", () => {
    for (const input of [
      { ...event, stage: "authorization", status: "denied", reason: "permission_denied" },
      { ...event, stage: "result", status: "failed", reason: "error" },
      { ...event, stage: "result", status: "unknown", reason: "unavailable" },
      { ...event, stage: "result", status: "truncated" },
      { ...event, stage: "check", actionKind: "check", status: "not_started" },
      { ...event, stage: "check", actionKind: "check", status: "unavailable" },
      { ...event, stage: "check", actionKind: "review", status: "truncated" },
      {
        ...event,
        stage: "terminal",
        actionId: null,
        actionKind: null,
        status: "cancelled",
        reason: "revoked",
      },
    ])
      expect(validateWorkflowSessionEvent(input).ok).toBe(true);
  });

  test("rejects body, output, unrecognized metadata and invalid stage/status combinations", () => {
    for (const input of [
      { ...event, content: "secret" },
      { ...event, stdout: "secret" },
      { ...event, command: "secret" },
      { ...event, status: "passed" },
      { ...event, stage: "terminal", status: "completed" },
      { ...event, actionId: null },
      { ...event, stage: "check", status: "passed" },
      { ...event, sessionId: "file body" },
      { ...event, reason: "arbitrary error output" },
      { ...event, sequence: 0 },
      { ...event, sequence: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(validateWorkflowSessionEvent(input).ok).toBe(false);
  });

  test("requires a single session and strictly increasing sequences, allowing gaps", () => {
    expect(validateWorkflowSessionEvents([event, { ...event, sequence: 3 }]).ok).toBe(true);
    expect(validateWorkflowSessionEvents([event, { ...event }]).ok).toBe(false);
    expect(validateWorkflowSessionEvents([{ ...event, sequence: 2 }, event]).ok).toBe(false);
    expect(
      validateWorkflowSessionEvents([event, { ...event, sequence: 2, sessionId: "other" }]).ok,
    ).toBe(false);
    expect(
      validateWorkflowSessionEvents([event, { ...event, sequence: 2, stdout: "secret" }]).ok,
    ).toBe(false);
    expect(validateWorkflowSessionEvents({}).ok).toBe(false);
  });
});
