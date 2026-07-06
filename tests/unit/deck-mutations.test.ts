import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { MutationAlert } from "../../src/components/mutation-alert";
import {
  deckMutationErrorMessage,
  recordOpenDetail,
  submitDeckAction,
} from "../../src/lib/client/deck-mutations";
import { isFeedHiddenAction } from "../../src/lib/ranking/feed-ranking";

describe("submitDeckAction", () => {
  test("posts deck mutations to the API", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({ action: "favorite", ok: true });
    };

    await submitDeckAction("favorite", "paper-1", fetchImpl);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/deck");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "favorite",
      paperId: "paper-1",
    });
  });

  test("rejects failed API responses", async () => {
    await assert.rejects(
      () =>
        submitDeckAction("read_later", "paper-1", async () =>
          Response.json(
            { error: "Persistence failed", ok: false },
            { status: 500 },
          ),
        ),
      /Persistence failed/,
    );
  });

  test("rejects non-ok API responses without error field", async () => {
    await assert.rejects(
      () =>
        submitDeckAction("dismiss", "paper-1", async () =>
          Response.json({ ok: false }, { status: 500 }),
        ),
    );
  });

  test("throws on network error", async () => {
    await assert.rejects(
      () =>
        submitDeckAction("favorite", "paper-1", async () => {
          throw new TypeError("fetch failed");
        }),
      /fetch failed/,
    );
  });
});

describe("recordOpenDetail", () => {
  test("queues best-effort open tracking without awaiting navigation", () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({ action: "open_detail", ok: true });
    };

    const mode = recordOpenDetail("paper-2", {
      fetchImpl,
      navigatorImpl: { sendBeacon: () => false },
    });

    assert.equal(mode, "fetch");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/deck");
    assert.equal(calls[0].init?.keepalive, true);
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "open_detail",
      paperId: "paper-2",
    });
  });

  test("uses sendBeacon when available", () => {
    const beaconCalls: Array<{ url: string; data: string }> = [];
    const mode = recordOpenDetail("paper-3", {
      fetchImpl: async () => Response.json({ ok: true }),
      navigatorImpl: {
        sendBeacon: (url: string, data: string) => {
          beaconCalls.push({ url, data });
          return true;
        },
      } as Pick<Navigator, "sendBeacon">,
    });

    assert.equal(mode, "beacon");
    assert.equal(beaconCalls.length, 1);
    assert.equal(beaconCalls[0].url, "/api/deck");
  });
});

describe("deckMutationErrorMessage", () => {
  test("returns copy for each mutation action type", () => {
    const actions = ["favorite", "read_later", "dismiss"] as const;

    for (const action of actions) {
      const message = deckMutationErrorMessage(action);
      assert.ok(typeof message === "string");
      assert.ok(message.length > 0);
    }
  });
});

describe("MutationAlert", () => {
  test("renders accessible mutation error copy", () => {
    const alert = MutationAlert({
      message: deckMutationErrorMessage("dismiss"),
    });

    assert.notEqual(alert, null);
    assert.equal(alert?.props.role, "alert");
    assert.match(alert?.props.children, /We could not dismiss this paper/);
  });

  test("renders message for favorite error", () => {
    const alert = MutationAlert({
      message: deckMutationErrorMessage("favorite"),
    });

    assert.notEqual(alert, null);
    assert.equal(alert?.props.role, "alert");
  });

  test("renders message for read_later error", () => {
    const alert = MutationAlert({
      message: deckMutationErrorMessage("read_later"),
    });

    assert.notEqual(alert, null);
    assert.equal(alert?.props.role, "alert");
  });

  test("returns null when message is null", () => {
    const alert = MutationAlert({ message: null });
    assert.equal(alert, null);
  });
});

describe("isFeedHiddenAction", () => {
  test("identifies dismiss, not_interested, and already_read as hidden", () => {
    assert.equal(isFeedHiddenAction("dismiss"), true);
    assert.equal(isFeedHiddenAction("not_interested"), true);
    assert.equal(isFeedHiddenAction("already_read"), true);
  });

  test("does not hide favorite and save_to_playlist", () => {
    assert.equal(isFeedHiddenAction("favorite"), false);
    assert.equal(isFeedHiddenAction("save_to_playlist"), false);
  });

  test("hides open_detail (feed advances after opening)", () => {
    assert.equal(isFeedHiddenAction("open_detail"), true);
  });

  test("returns false for unknown action types", () => {
    assert.equal(isFeedHiddenAction("unknown" as never), false);
  });
});
