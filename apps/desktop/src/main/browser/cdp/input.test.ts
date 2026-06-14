import { describe, expect, it } from "vitest";
import { resolveActionPoint } from "./input";
import type { CdpSession } from "./session";
import type { SnapshotRefTarget } from "./snapshot";

/**
 * Actionability tests with a stubbed CDP session: the pipeline must scroll the
 * node into view, derive the center from content quads, reject invisible or
 * obscured targets with actionable errors, and translate OOPIF coordinates by
 * the owner iframe's offset.
 */

type Handler = (params: Record<string, unknown>, sessionId: string | undefined) => unknown;

function fakeSession(handlers: Record<string, Handler>): CdpSession {
  const calls: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  const session = {
    calls,
    ensureAttached: async () => {},
    send: async (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ): Promise<unknown> => {
      calls.push({ method, params, ...(sessionId !== undefined ? { sessionId } : {}) });
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`Unexpected CDP method in test: ${method}`);
      }
      return handler(params, sessionId);
    },
  };
  return session as unknown as CdpSession;
}

function callsOf(session: CdpSession): { method: string; sessionId?: string }[] {
  return (session as unknown as { calls: { method: string; sessionId?: string }[] }).calls;
}

/** 100x100 square at (10, 10) → center (60, 60). */
const SQUARE_QUAD = [10, 10, 110, 10, 110, 110, 10, 110];

const target: SnapshotRefTarget = { backendNodeId: 5, role: "button", name: "Accept all" };

describe("resolveActionPoint", () => {
  it("returns the quad center for a visible, unobstructed element", async () => {
    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => ({}),
      "DOM.getContentQuads": () => ({ quads: [SQUARE_QUAD] }),
      "DOM.getNodeForLocation": () => ({ backendNodeId: 5 }),
    });

    const point = await resolveActionPoint(session, target);
    expect(point).toEqual({ x: 60, y: 60 });
    const methods = callsOf(session).map((call) => call.method);
    expect(methods[0]).toBe("DOM.scrollIntoViewIfNeeded");
    expect(methods).toContain("DOM.getNodeForLocation");
  });

  it("rejects elements that are gone from the document", async () => {
    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => {
        throw new Error("No node with given id found");
      },
    });

    await expect(resolveActionPoint(session, target)).rejects.toThrow(/no longer in the document/);
  });

  it("rejects invisible elements (no content quads)", async () => {
    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => ({}),
      "DOM.getContentQuads": () => ({ quads: [] }),
    });

    await expect(resolveActionPoint(session, target)).rejects.toThrow(/not visible/);
  });

  it("names the covering element when the target would not receive the click", async () => {
    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => ({}),
      "DOM.getContentQuads": () => ({ quads: [SQUARE_QUAD] }),
      "DOM.getNodeForLocation": () => ({ backendNodeId: 999 }),
      "DOM.resolveNode": (params) => ({
        object: { objectId: params.backendNodeId === 999 ? "hit" : "target" },
      }),
      "Runtime.callFunctionOn": () => ({ result: { value: false } }),
      "DOM.describeNode": () => ({
        node: { nodeName: "DIV", attributes: ["class", "cookie-overlay backdrop"] },
      }),
    });

    await expect(resolveActionPoint(session, target)).rejects.toThrow(
      /obscured by <div class="cookie-overlay backdrop">/,
    );
  });

  it("accepts hits on descendants/hosts (shadow DOM) via the containment check", async () => {
    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => ({}),
      "DOM.getContentQuads": () => ({ quads: [SQUARE_QUAD] }),
      "DOM.getNodeForLocation": () => ({ backendNodeId: 999 }),
      "DOM.resolveNode": () => ({ object: { objectId: "obj" } }),
      "Runtime.callFunctionOn": () => ({ result: { value: true } }),
    });

    const point = await resolveActionPoint(session, target);
    expect(point).toEqual({ x: 60, y: 60 });
  });

  it("translates OOPIF coordinates by the owner iframe offset", async () => {
    const childSessionId = "child-session";
    const oopifTarget: SnapshotRefTarget = {
      backendNodeId: 7,
      sessionId: childSessionId,
      frameId: "FRAME1",
      role: "button",
      name: "Accept",
    };
    // Owner iframe sits at (200, 300) in the root viewport.
    const ownerQuad = [200, 300, 600, 300, 600, 700, 200, 700];

    const session = fakeSession({
      "DOM.scrollIntoViewIfNeeded": () => ({}),
      "DOM.getContentQuads": (params, sessionId) => {
        if (sessionId === childSessionId) {
          return { quads: [SQUARE_QUAD] };
        }
        expect(params.backendNodeId).toBe(77);
        return { quads: [ownerQuad] };
      },
      "DOM.getFrameOwner": (params) => {
        expect(params.frameId).toBe("FRAME1");
        return { backendNodeId: 77 };
      },
    });

    const point = await resolveActionPoint(session, oopifTarget);
    expect(point).toEqual({ x: 260, y: 360 });

    // Element-level commands must run on the child session.
    const scrollCall = callsOf(session).find(
      (call) => call.method === "DOM.scrollIntoViewIfNeeded",
    );
    expect(scrollCall?.sessionId).toBe(childSessionId);
  });
});
