import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair, signEnvelope, verifyEnvelope } from "./index.js";
import { createEnvelope } from "@lockal/shared";

describe("Envelope signing", () => {
  it("signs and verifies canonical envelope bytes", async () => {
    const keys = await generateIdentityKeyPair();
    const envelope = createEnvelope({
      messageType: "chat.message",
      messageId: "msg_test",
      senderDeviceId: "dev_test",
      nonce: "n1",
      payload: { text: "hi" },
    });
    envelope.signature = await signEnvelope(keys.privateKey, envelope);
    expect(await verifyEnvelope(keys.publicKey, envelope)).toBe(true);
    envelope.payload = { text: "tampered" };
    expect(await verifyEnvelope(keys.publicKey, envelope)).toBe(false);
  });

  it("verifies after payload key reorder (LAN relay)", async () => {
    const keys = await generateIdentityKeyPair();
    const envelope = createEnvelope({
      messageType: "chat.message",
      messageId: "msg_reorder",
      senderDeviceId: "dev_test",
      nonce: "n2",
      payload: {
        messageId: "m1",
        chatId: "dm_a_b",
        senderUserId: "usr_a",
        content: "hi",
        contentType: "text",
        clientNonce: "c1",
        sentAt: "2026-01-01T00:00:00.000Z",
      },
    });
    envelope.signature = await signEnvelope(keys.privateKey, envelope);
    const relayed = {
      ...envelope,
      payload: {
        sentAt: "2026-01-01T00:00:00.000Z",
        content: "hi",
        chatId: "dm_a_b",
        contentType: "text",
        clientNonce: "c1",
        messageId: "m1",
        senderUserId: "usr_a",
      },
    };
    expect(await verifyEnvelope(keys.publicKey, relayed)).toBe(true);
  });
});
