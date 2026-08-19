import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import {
  deriveClerkIdentityEmailLookupHash,
  handleUpdatedClerkUser,
} from "@/lib/clerk/user-identity-sync";
import { verifyWebhook } from "@/lib/clerk/webhook-verification";
import { emailLookupHash } from "@/lib/collaboration/email-lookup";

process.env.PAPERDECK_EMAIL_LOOKUP_PEPPER ??=
  "unit-test-clerk-identity-pepper-32-characters";

const verifiedUser = {
  primary_email_address_id: "email-primary",
  email_addresses: [
    {
      id: "email-primary",
      email_address: "Current@Example.com",
      verification: { status: "verified" },
    },
  ],
};

describe("Clerk collaboration identity synchronization", () => {
  it("keeps Clerk's upstream updated_at on a signed user update", async () => {
    const secret = `whsec_${randomBytes(32).toString("base64")}`;
    const sourceUpdatedAt = 1_787_164_800_123;
    const body = JSON.stringify({
      data: {
        id: "owner-a",
        object: "user",
        updated_at: sourceUpdatedAt,
        primary_email_address_id: "email-primary",
        email_addresses: verifiedUser.email_addresses,
      },
      object: "event",
      type: "user.updated",
    });
    const messageId = `msg_${randomUUID()}`;
    const timestamp = new Date();
    const signer = new Webhook(secret);
    const request = new Request("http://localhost/api/webhooks/clerk", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "svix-id": messageId,
        "svix-signature": signer.sign(messageId, timestamp, body),
        "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      },
    });

    const event = await verifyWebhook(request, { signingSecret: secret });
    assert.equal(event.type, "user.updated");
    assert.equal(event.data.updated_at, sourceUpdatedAt);
  });

  it("derives a hash only from a verified primary email and safe public name", () => {
    assert.equal(
      deriveClerkIdentityEmailLookupHash(verifiedUser, "Public Name"),
      emailLookupHash("Current@Example.com"),
    );

    assert.equal(
      deriveClerkIdentityEmailLookupHash(
        { ...verifiedUser, primary_email_address_id: null },
        "Public Name",
      ),
      null,
    );
    assert.equal(
      deriveClerkIdentityEmailLookupHash(
        {
          ...verifiedUser,
          email_addresses: [
            {
              ...verifiedUser.email_addresses[0],
              verification: { status: "unverified" },
            },
          ],
        },
        "Public Name",
      ),
      null,
    );

    for (const invalidName of [null, "A", "name@example.com", "x".repeat(51)]) {
      assert.equal(
        deriveClerkIdentityEmailLookupHash(verifiedUser, invalidName),
        null,
      );
    }
  });

  it("passes the upstream version and optional preferences to the atomic RPC", async () => {
    const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
    const response = await handleUpdatedClerkUser(
      {
        ownerId: "owner-a",
        sourceUpdatedAt: 200,
        emailLookupHash: "a".repeat(64),
      },
      {
        rpc(functionName, args) {
          calls.push({ functionName, args });
          return Promise.resolve({ error: null });
        },
      },
    );

    assert.equal(response.status, 204);
    assert.deepEqual(calls, [
      {
        functionName: "sync_clerk_collaboration_identity",
        args: {
          p_owner_id: "owner-a",
          p_source_updated_at: 200,
          p_email_lookup_hash: "a".repeat(64),
          p_email_hash_version: 1,
          p_discoverable_by_email: null,
          p_group_invite_policy: null,
          p_allow_same_source_version: false,
        },
      },
    ]);
  });

  it("returns a generic retryable error for RPC failures", async () => {
    const rpcError = await handleUpdatedClerkUser(
      {
        ownerId: "owner-a",
        sourceUpdatedAt: 200,
        emailLookupHash: null,
      },
      { rpc: () => Promise.resolve({ error: new Error("conflict") }) },
    );
    const thrownError = await handleUpdatedClerkUser(
      {
        ownerId: "owner-a",
        sourceUpdatedAt: 200,
        emailLookupHash: null,
      },
      { rpc: () => Promise.reject(new Error("offline")) },
    );

    for (const response of [rpcError, thrownError]) {
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "Identity sync failed");
    }
  });
});
