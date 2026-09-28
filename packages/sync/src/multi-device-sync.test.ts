import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair } from "@lockal/crypto";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import { MessageDeliveryStatus } from "@lockal/domain";
import { ChatService, directChatId } from "@lockal/messaging";
import { InMemoryTransport } from "@lockal/networking";
import { deviceId, isoNow, organizationId, userId } from "@lockal/shared";
import { SyncEngine } from "./sync-engine.js";

/** Three separate local-first databases: Alice has two devices (A1, A2), Bob has one (B1). */
async function createThreeDevicePair() {
  const now = isoNow();
  const orgId = organizationId();
  const orgKeys = await generateIdentityKeyPair();

  const alice = userId();
  const bob = userId();
  const devA1 = deviceId();
  const devA2 = deviceId();
  const devB1 = deviceId();
  const keysA1 = await generateIdentityKeyPair();
  const keysA2 = await generateIdentityKeyPair();
  const keysB1 = await generateIdentityKeyPair();

  async function seed(): Promise<DatabaseContext> {
    const db = new DatabaseContext(await SqliteConnection.open(true));
    db.organizations.create(
      { id: orgId, name: "Org", publicKey: orgKeys.publicKey, fingerprint: orgKeys.fingerprint, createdAt: now },
      orgKeys.privateKey,
    );
    for (const [id, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
    ] as const) {
      db.users.create({
        id,
        organizationId: orgId,
        username: name.toLowerCase(),
        displayName: name,
        passwordHash: "x",
        role: UserRole.Admin,
        status: UserStatus.Active,
        departmentId: null,
        avatarUrl: null,
        presence: PresenceStatus.Online,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const [id, uid, keys, name] of [
      [devA1, alice, keysA1, "alice-pc"],
      [devA2, alice, keysA2, "alice-laptop"],
      [devB1, bob, keysB1, "bob-pc"],
    ] as const) {
      db.devices.create({
        id,
        userId: uid,
        organizationId: orgId,
        name,
        platform: "test",
        appVersion: "0.1.0",
        publicKey: keys.publicKey,
        fingerprint: keys.fingerprint,
        trustStatus: DeviceTrustStatus.Trusted,
        lastSeenAt: now,
        lastIp: null,
        createdAt: now,
      });
    }
    return db;
  }

  const dbA1 = await seed();
  const dbA2 = await seed();
  const dbB1 = await seed();

  function makeTransport(devId: string, uid: string, keys: { publicKey: string }) {
    return new InMemoryTransport(devId, {
      deviceId: devId,
      userId: uid,
      publicKey: keys.publicKey,
      addresses: [],
      lastSeenAt: now,
      trusted: true,
    });
  }

  const transportA1 = makeTransport(devA1, alice, keysA1);
  const transportA2 = makeTransport(devA2, alice, keysA2);
  const transportB1 = makeTransport(devB1, bob, keysB1);
  InMemoryTransport.link(transportA1, transportA2);
  InMemoryTransport.link(transportA1, transportB1);
  InMemoryTransport.link(transportA2, transportB1);

  const engineA1 = new SyncEngine(dbA1, transportA1, {
    organizationId: orgId,
    deviceId: devA1,
    userId: alice,
    devicePrivateKey: keysA1.privateKey,
  });
  const engineA2 = new SyncEngine(dbA2, transportA2, {
    organizationId: orgId,
    deviceId: devA2,
    userId: alice,
    devicePrivateKey: keysA2.privateKey,
  });
  const engineB1 = new SyncEngine(dbB1, transportB1, {
    organizationId: orgId,
    deviceId: devB1,
    userId: bob,
    devicePrivateKey: keysB1.privateKey,
  });
  engineA1.start();
  engineA2.start();
  engineB1.start();

  return { dbA1, dbA2, dbB1, orgId, alice, bob, devA1, engineA1, engineA2, engineB1 };
}

describe("Multi-device sync", () => {
  it("replicates a message sent from one of Alice's devices to her other device, and to Bob", async () => {
    const { dbA1, dbA2, dbB1, orgId, alice, bob, devA1, engineA1 } = await createThreeDevicePair();

    const chatId = new ChatService(dbA1).ensureDirectChat(orgId, alice, bob);
    const aliceUser = dbA1.users.findById(alice)!;
    const msg = new ChatService(dbA1).sendTextMessage({
      chatId,
      sender: aliceUser,
      senderDeviceId: devA1,
      text: "Привет, это Алиса с ПК",
    });

    await engineA1.publishChatMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderUserId: msg.senderUserId,
      content: msg.contentText,
      clientNonce: msg.clientNonce,
      createdAt: msg.createdAt,
      recipientUserId: bob,
    });

    await new Promise((r) => setTimeout(r, 30));

    // Bob receives it on his device.
    const bobMessages = new ChatService(dbB1).listMessages(chatId);
    expect(bobMessages.some((m) => m.contentText === "Привет, это Алиса с ПК")).toBe(true);

    // Alice's *other* device also receives a copy — multi-device sync.
    const aliceOtherDeviceMessages = new ChatService(dbA2).listMessages(chatId);
    expect(aliceOtherDeviceMessages.some((m) => m.contentText === "Привет, это Алиса с ПК")).toBe(true);

    // And the chat is properly registered there too (regression: previously
    // ensureChatFromDirectId silently no-op'd, so the message existed but was
    // invisible from the chat list).
    const aliceOtherDeviceChats = new ChatService(dbA2).listDirectChatsForUser(alice);
    expect(aliceOtherDeviceChats.some((c) => c.chatId === directChatId(alice, bob))).toBe(true);
  });

  it("bumps chats.updated_at on the *receiving* device too (regression: only the sender's own device reordered its chat list — a chat that only ever received messages never rose to the top of that device's list)", async () => {
    const { dbA1, dbB1, orgId, alice, bob, devA1, engineA1 } = await createThreeDevicePair();

    const chatId = new ChatService(dbA1).ensureDirectChat(orgId, alice, bob);
    const aliceUser = dbA1.users.findById(alice)!;
    const msg = new ChatService(dbA1).sendTextMessage({
      chatId,
      sender: aliceUser,
      senderDeviceId: devA1,
      text: "Проверка порядка чатов",
    });

    await engineA1.publishChatMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderUserId: msg.senderUserId,
      content: msg.contentText,
      clientNonce: msg.clientNonce,
      createdAt: msg.createdAt,
      recipientUserId: bob,
    });

    await new Promise((r) => setTimeout(r, 30));

    // Bob's local chat row must be stamped with the message's own timestamp
    // (not just whatever `ensureChatFromDirectId` happened to set when the
    // row was first created), proving the inbound-message path itself
    // refreshes `updated_at` — the same thing `sendTextMessage` already did
    // for the sender.
    const bobChatRow = dbB1.connection.get<{ updated_at: string }>(
      "SELECT updated_at FROM chats WHERE id = ?",
      [chatId],
    );
    expect(bobChatRow?.updated_at).toBe(msg.createdAt);
  });

  it("sends a read receipt so the sender's copy is marked Read, and clears unread on the receiver", async () => {
    const { dbA1, dbB1, orgId, alice, bob, devA1, engineA1, engineB1 } = await createThreeDevicePair();

    const chatId = new ChatService(dbA1).ensureDirectChat(orgId, alice, bob);
    const aliceUser = dbA1.users.findById(alice)!;
    const msg = new ChatService(dbA1).sendTextMessage({
      chatId,
      sender: aliceUser,
      senderDeviceId: devA1,
      text: "Прочитай это",
    });

    await engineA1.publishChatMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderUserId: msg.senderUserId,
      content: msg.contentText,
      clientNonce: msg.clientNonce,
      createdAt: msg.createdAt,
      recipientUserId: bob,
    });
    await new Promise((r) => setTimeout(r, 30));

    const bobChats = new ChatService(dbB1).listDirectChatsForUser(bob);
    expect(bobChats.find((c) => c.chatId === chatId)?.unreadCount).toBe(1);

    const unread = new ChatService(dbB1).markChatRead(chatId, bob);
    expect(unread).toHaveLength(1);
    await engineB1.publishReadReceipts(unread);
    await new Promise((r) => setTimeout(r, 30));

    expect(new ChatService(dbB1).listDirectChatsForUser(bob).find((c) => c.chatId === chatId)?.unreadCount).toBe(0);
    const aliceCopy = new ChatService(dbA1).listMessages(chatId).find((m) => m.id === msg.id);
    expect(aliceCopy?.status).toBe(MessageDeliveryStatus.Read);
  });
});
