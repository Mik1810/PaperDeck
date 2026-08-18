import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { MutationAlert } from "../../src/components/mutation-alert";
import {
  deckMutationErrorMessage,
  recordOpenDetail,
  recordRecommendationImpression,
  submitDeckAction,
} from "../../src/lib/client/deck-mutations";
import { isDurableFeedExclusionAction } from "../../src/lib/ranking/feed-ranking";

describe("submitDeckAction", () => {
  test("posts deck mutations to the API", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({ action: "favorite", ok: true });
    };

    await submitDeckAction(
      "favorite",
      "paper-1",
      { selected: true },
      fetchImpl,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/deck");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "favorite",
      paperId: "paper-1",
      selected: true,
    });
  });

  test("posts recommendation impression ids when present", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({ action: "dismiss", ok: true });
    };

    await submitDeckAction(
      "dismiss",
      "paper-1",
      { recommendationImpressionId: "11111111-1111-4111-8111-111111111111" },
      fetchImpl,
    );

    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "dismiss",
      paperId: "paper-1",
      recommendationImpressionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("posts recommendation batch item ids when the impression is pending", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({ action: "dismiss", ok: true });
    };

    await submitDeckAction(
      "dismiss",
      "paper-1",
      { recommendationBatchItemId: "44444444-4444-4444-8444-444444444444" },
      fetchImpl,
    );

    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "dismiss",
      paperId: "paper-1",
      recommendationBatchItemId: "44444444-4444-4444-8444-444444444444",
    });
  });

  test("rejects failed API responses", async () => {
    await assert.rejects(
      () =>
        submitDeckAction("read_later", "paper-1", { selected: true }, async () =>
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
        submitDeckAction("dismiss", "paper-1", {}, async () =>
          Response.json({ ok: false }, { status: 500 }),
        ),
    );
  });

  test("rejects malformed successful API responses", async () => {
    for (const payload of [{}, { action: "favorite" }, { ok: true }]) {
      await assert.rejects(
        () =>
          submitDeckAction(
            "favorite",
            "paper-1",
            { selected: true },
            async () => Response.json(payload),
          ),
        /Deck action failed: favorite/,
      );
    }
  });

  test("rejects a successful payload for a different action", async () => {
    await assert.rejects(
      () =>
        submitDeckAction(
          "favorite",
          "paper-1",
          { selected: true },
          async () => Response.json({ action: "dismiss", ok: true }),
        ),
      /Deck action failed: favorite/,
    );
  });

  test("throws on network error", async () => {
    await assert.rejects(
      () =>
        submitDeckAction("favorite", "paper-1", { selected: true }, async () => {
          throw new TypeError("fetch failed");
        }),
      /fetch failed/,
    );
  });

  test("rejects collection mutations without an explicit target state", async () => {
    await assert.rejects(
      () => submitDeckAction("favorite", "paper-1"),
      /requires an explicit target state/,
    );
  });
});

describe("recordRecommendationImpression", () => {
  test("records one visible batch item and returns its impression id", async () => {
    const calls: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input });
      return Response.json({
        ok: true,
        recommendationImpressionId: "55555555-5555-4555-8555-555555555555",
      });
    };

    const impressionId = await recordRecommendationImpression(
      "paper-5",
      "44444444-4444-4444-8444-444444444444",
      fetchImpl,
    );

    assert.equal(impressionId, "55555555-5555-4555-8555-555555555555");
    assert.equal(calls[0].input, "/api/recommendation-impressions");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      paperId: "paper-5",
      recommendationBatchItemId: "44444444-4444-4444-8444-444444444444",
    });
  });

  test("rejects unsuccessful impression writes", async () => {
    await assert.rejects(
      () =>
        recordRecommendationImpression(
          "paper-5",
          "44444444-4444-4444-8444-444444444444",
          async () =>
            Response.json(
              { error: "Invalid recommendation batch item", ok: false },
              { status: 400 },
            ),
        ),
      /Invalid recommendation batch item/,
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
      recommendationBatchItemId: "44444444-4444-4444-8444-444444444444",
      recommendationImpressionId: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(mode, "fetch");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/deck");
    assert.equal(calls[0].init?.keepalive, true);
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      action: "open_detail",
      paperId: "paper-2",
      recommendationBatchItemId: "44444444-4444-4444-8444-444444444444",
      recommendationImpressionId: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("uses sendBeacon when available", async () => {
    const beaconCalls: Array<{ url: string; data: BodyInit | null }> = [];
    const mode = recordOpenDetail("paper-3", {
      fetchImpl: async () => Response.json({ ok: true }),
      navigatorImpl: {
        sendBeacon: (url: string, data?: BodyInit | null) => {
          beaconCalls.push({ url, data: data ?? null });
          return true;
        },
      } as Pick<Navigator, "sendBeacon">,
      recommendationImpressionId: "33333333-3333-4333-8333-333333333333",
    });

    assert.equal(mode, "beacon");
    assert.equal(beaconCalls.length, 1);
    assert.equal(beaconCalls[0].url, "/api/deck");
    assert.deepEqual(
      JSON.parse(await (beaconCalls[0].data as Blob).text()),
      {
        action: "open_detail",
        paperId: "paper-3",
        recommendationImpressionId: "33333333-3333-4333-8333-333333333333",
      },
    );
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

describe("isDurableFeedExclusionAction", () => {
  test("identifies consumed and rejected actions as durable", () => {
    assert.equal(isDurableFeedExclusionAction("open_detail"), true);
    assert.equal(isDurableFeedExclusionAction("dismiss"), true);
    assert.equal(isDurableFeedExclusionAction("not_interested"), true);
    assert.equal(isDurableFeedExclusionAction("read"), true);
    assert.equal(isDurableFeedExclusionAction("already_read"), true);
  });

  test("keeps collection events out of durable state", () => {
    assert.equal(isDurableFeedExclusionAction("favorite"), false);
    assert.equal(isDurableFeedExclusionAction("save_to_playlist"), false);
    assert.equal(isDurableFeedExclusionAction("seen"), false);
  });

  test("returns false for unknown action types", () => {
    assert.equal(isDurableFeedExclusionAction("unknown" as never), false);
  });
});
