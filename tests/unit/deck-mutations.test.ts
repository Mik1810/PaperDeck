import assert from "node:assert/strict";
import test from "node:test";
import { MutationAlert } from "../../src/components/mutation-alert";
import {
  deckMutationErrorMessage,
  recordOpenDetail,
  submitDeckAction,
} from "../../src/lib/client/deck-mutations";

test("submitDeckAction posts deck mutations to the API", async () => {
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

test("submitDeckAction rejects failed API responses", async () => {
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

test("recordOpenDetail queues best-effort open tracking without awaiting navigation", () => {
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

test("MutationAlert renders accessible mutation error copy", () => {
  const alert = MutationAlert({
    message: deckMutationErrorMessage("dismiss"),
  });

  assert.notEqual(alert, null);
  assert.equal(alert?.props.role, "alert");
  assert.match(alert?.props.children, /We could not dismiss this paper/);
});
