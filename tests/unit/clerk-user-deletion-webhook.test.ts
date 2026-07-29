import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { handleDeletedClerkUser } from "@/lib/clerk/user-deletion";
import { verifyWebhook } from "@/lib/clerk/webhook-verification";

function signedDeletionRequest({
  ownerId,
  secret,
}: {
  ownerId: string;
  secret: string;
}) {
  const body = JSON.stringify({
    data: {
      deleted: true,
      id: ownerId,
      object: "user",
    },
    object: "event",
    timestamp: Date.now(),
    type: "user.deleted",
  });
  const messageId = `msg_${randomUUID()}`;
  const timestamp = new Date();
  const signer = new Webhook(secret);

  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-signature": signer.sign(messageId, timestamp, body),
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    },
  });
}

describe("Clerk user.deleted webhook", () => {
  it("verifies an authentically signed synthetic deletion event", async () => {
    const secret = `whsec_${randomBytes(32).toString("base64")}`;
    const ownerId = `synthetic-owner-${randomUUID()}`;
    const event = await verifyWebhook(
      signedDeletionRequest({ ownerId, secret }),
      { signingSecret: secret },
    );

    assert.equal(event.type, "user.deleted");
    assert.equal(event.data.id, ownerId);
  });

  it("rejects a request whose signed body was changed", async () => {
    const secret = `whsec_${randomBytes(32).toString("base64")}`;
    const request = signedDeletionRequest({
      ownerId: `synthetic-owner-${randomUUID()}`,
      secret,
    });
    const tampered = new Request(request, {
      body: `${await request.text()} `,
    });

    await assert.rejects(
      verifyWebhook(tampered, { signingSecret: secret }),
    );
  });

  it("calls only the atomic service-role RPC", async () => {
    const calls: Array<{ functionName: string; ownerId: string }> = [];
    const response = await handleDeletedClerkUser("synthetic-owner", {
      rpc(functionName, args) {
        calls.push({ functionName, ownerId: args.p_owner_id });
        return Promise.resolve({ error: null });
      },
    });

    assert.equal(response.status, 204);
    assert.deepEqual(calls, [
      {
        functionName: "handle_clerk_user_deleted",
        ownerId: "synthetic-owner",
      },
    ]);
  });

  it("returns a retryable generic error for RPC errors and exceptions", async () => {
    const rpcError = await handleDeletedClerkUser("synthetic-owner", {
      rpc: () => Promise.resolve({ error: new Error("database unavailable") }),
    });
    const thrownError = await handleDeletedClerkUser("synthetic-owner", {
      rpc: () => Promise.reject(new Error("network unavailable")),
    });

    for (const response of [rpcError, thrownError]) {
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "Identity sync failed");
    }
  });
});
