import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair } from "@lockal/crypto";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import { ChatService } from "@lockal/messaging";
import { InMemoryTransport } from "@lockal/networking";
import { deviceId, isoNow, organizationId, userId } from "@lockal/shared";
import { MemoryBlobStore } from "./blob-store.js";
import { DEFAULT_CHUNK_SIZE } from "./hash-stream.js";
import { FileTransferEngine } from "./file-transfer-engine.js";

/** Each simulated device gets its own local-first database — mirroring production,
 * where sender and receiver never share storage — but both are seeded with the same
 * org/user/device rows so envelope signature verification succeeds on both ends. */
async function createPair() {
  const now = isoNow();
  const orgId = organizationId();
  const orgKeys = await generateIdentityKeyPair();

  const userA = userId();
  const userB = userId();
  const keysA = await generateIdentityKeyPair();
  const keysB = await generateIdentityKeyPair();
  const devA = deviceId();
  const devB = deviceId();

  async function seed(): Promise<DatabaseContext> {
    const db = new DatabaseContext(await SqliteConnection.open(true));
    db.organizations.create(
      { id: orgId, name: "Org", publicKey: orgKeys.publicKey, fingerprint: orgKeys.fingerprint, createdAt: now },
      orgKeys.privateKey,
    );
    db.users.create({
      id: userA,
      organizationId: orgId,
      username: "a",
      displayName: "A",
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
    db.users.create({
      id: userB,
      organizationId: orgId,
      username: "b",
      displayName: "B",
      passwordHash: "x",
      role: UserRole.User,
      status: UserStatus.Active,
      departmentId: null,
      avatarUrl: null,
      presence: PresenceStatus.Online,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    db.devices.create({
      id: devA,
      userId: userA,
      organizationId: orgId,
      name: "a-pc",
      platform: "test",
      appVersion: "0.1.0",
      publicKey: keysA.publicKey,
      fingerprint: keysA.fingerprint,
      trustStatus: DeviceTrustStatus.Trusted,
      lastSeenAt: now,
      lastIp: null,
      createdAt: now,
    });
    db.devices.create({
      id: devB,
      userId: userB,
      organizationId: orgId,
      name: "b-pc",
      platform: "test",
      appVersion: "0.1.0",
      publicKey: keysB.publicKey,
      fingerprint: keysB.fingerprint,
      trustStatus: DeviceTrustStatus.Trusted,
      lastSeenAt: now,
      lastIp: null,
      createdAt: now,
    });
    new ChatService(db).ensureDirectChat(orgId, userA, userB);
    return db;
  }

  const dbA = await seed();
  const dbB = await seed();
  const chatId = new ChatService(dbA).ensureDirectChat(orgId, userA, userB);

  const transportA = new InMemoryTransport(devA, {
    deviceId: devA,
    userId: userA,
    publicKey: keysA.publicKey,
    addresses: [],
    lastSeenAt: now,
    trusted: true,
  });
  const transportB = new InMemoryTransport(devB, {
    deviceId: devB,
    userId: userB,
    publicKey: keysB.publicKey,
    addresses: [],
    lastSeenAt: now,
    trusted: true,
  });
  InMemoryTransport.link(transportA, transportB);

  const engineA = new FileTransferEngine(dbA, transportA, new MemoryBlobStore(), {
    deviceId: devA,
    devicePrivateKey: keysA.privateKey,
    userId: userA,
  });
  const engineB = new FileTransferEngine(dbB, transportB, new MemoryBlobStore(), {
    deviceId: devB,
    devicePrivateKey: keysB.privateKey,
    userId: userB,
  });

  transportA.onReceive((_peer, env) => void engineA.handleEnvelope(env));
  transportB.onReceive((_peer, env) => void engineB.handleEnvelope(env));

  return { dbA, dbB, chatId, userA, userB, transportA, transportB, engineA, engineB };
}

function fileOfSize(bytes: number): Blob {
  const data = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) data[i] = i % 251;
  return new Blob([data]);
}

describe("FileTransferEngine", () => {
  it("delivers a multi-chunk file end to end", async () => {
    const { dbA, dbB, chatId, userA, userB, engineA } = await createPair();
    const file = fileOfSize(DEFAULT_CHUNK_SIZE * 2 + 100);

    const admin = dbA.users.findById(userA)!;
    await engineA.sendFile({
      file,
      fileName: "photo.png",
      mimeType: "image/png",
      chatId,
      sender: admin,
      recipientUserId: userB,
    });

    await new Promise((r) => setTimeout(r, 20));

    const senderRow = dbA.connection.get<{ status: string }>(
      "SELECT status FROM file_transfers WHERE chat_id = ?",
      [chatId],
    );
    const receiverRow = dbB.connection.get<{ status: string }>(
      "SELECT status FROM file_transfers WHERE chat_id = ?",
      [chatId],
    );
    expect(senderRow?.status).toBe("completed");
    expect(receiverRow?.status).toBe("completed");

    // Regression: sending/receiving a file message used to leave chats.updated_at
    // untouched on both sides (only ChatService.sendTextMessage bumped it), so a
    // chat where the latest activity was a file transfer never rose to the top
    // of either side's chat list.
    const senderChat = dbA.connection.get<{ updated_at: string }>(
      "SELECT updated_at FROM chats WHERE id = ?",
      [chatId],
    );
    const receiverChat = dbB.connection.get<{ updated_at: string }>(
      "SELECT updated_at FROM chats WHERE id = ?",
      [chatId],
    );
    const chatCreatedAt = dbA.connection.get<{ created_at: string }>(
      "SELECT created_at FROM chats WHERE id = ?",
      [chatId],
    )?.created_at;
    expect(senderChat?.updated_at).not.toBe(chatCreatedAt);
    expect(receiverChat?.updated_at).not.toBe(chatCreatedAt);
  });

  it("pauses an outgoing transfer so retries stop, and resume delivers it", async () => {
    const { dbA, dbB, chatId, userA, userB, transportA, engineA } = await createPair();
    const file = fileOfSize(64 * 1024 + 500); // 2 chunks

    transportA.setOnline(false); // force every direct send to fail → chunks land in outbox
    const admin = dbA.users.findById(userA)!;
    const { transferId } = await engineA.sendFile({
      file,
      fileName: "doc.bin",
      mimeType: "application/octet-stream",
      chatId,
      sender: admin,
      recipientUserId: userB,
    });

    engineA.pauseTransfer(transferId);

    transportA.setOnline(true);
    await engineA.flushOutbox();
    await new Promise((r) => setTimeout(r, 10));

    // Paused transfer must not have reached the peer yet.
    let receiverRow = dbB.connection.get<{ id: string }>(
      "SELECT id FROM file_transfers WHERE chat_id = ?",
      [chatId],
    );
    expect(receiverRow).toBeNull();

    await engineA.resumeTransfer(transferId);
    await new Promise((r) => setTimeout(r, 20));

    receiverRow = dbB.connection.get<{ id: string }>("SELECT id FROM file_transfers WHERE chat_id = ?", [
      chatId,
    ]);
    expect(receiverRow).not.toBeNull();
    const senderRow = dbA.connection.get<{ status: string }>(
      "SELECT status FROM file_transfers WHERE id = ?",
      [transferId],
    );
    expect(senderRow?.status).toBe("completed");
  });

  it("cancels a transfer and drops queued chunks", async () => {
    const { dbA, chatId, userA, userB, transportA, engineA } = await createPair();
    const file = fileOfSize(64 * 1024 + 500);

    transportA.setOnline(false);
    const admin = dbA.users.findById(userA)!;
    const { transferId } = await engineA.sendFile({
      file,
      fileName: "cancel-me.bin",
      mimeType: "application/octet-stream",
      chatId,
      sender: admin,
      recipientUserId: userB,
    });

    engineA.cancelTransfer(transferId);
    transportA.setOnline(true);
    await engineA.flushOutbox();
    await new Promise((r) => setTimeout(r, 10));

    const row = dbA.connection.get<{ status: string }>("SELECT status FROM file_transfers WHERE id = ?", [
      transferId,
    ]);
    expect(row?.status).toBe("cancelled");
    const pending = dbA.connection.get<{ n: number }>(
      "SELECT COUNT(*) as n FROM file_chunk_outbox WHERE transfer_id = ? AND status = 'pending'",
      [transferId],
    );
    expect(pending?.n ?? 0).toBe(0);
  });

  it("records a failed outgoing file message when the recipient has no device", async () => {
    const { dbA, userA, engineA } = await createPair();
    const ghost = userId();
    const now = isoNow();
    const org = dbA.organizations.getFirst()!;
    dbA.users.create({
      id: ghost,
      organizationId: org.id,
      username: "ghost",
      displayName: "Ghost",
      passwordHash: "x",
      role: UserRole.User,
      status: UserStatus.Active,
      departmentId: null,
      avatarUrl: null,
      presence: PresenceStatus.Offline,
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const chatId = new ChatService(dbA).ensureDirectChat(org.id, userA, ghost);
    const admin = dbA.users.findById(userA)!;
    await expect(
      engineA.sendFile({
        file: fileOfSize(100),
        fileName: "lost.bin",
        mimeType: "application/octet-stream",
        chatId,
        sender: admin,
        recipientUserId: ghost,
      }),
    ).rejects.toThrow(/не найдено/);

    const transfer = dbA.connection.get<{ status: string }>(
      "SELECT status FROM file_transfers WHERE chat_id = ?",
      [chatId],
    );
    expect(transfer?.status).toBe("failed");
    const msg = dbA.connection.get<{ status: string }>(
      "SELECT status FROM messages WHERE chat_id = ? AND content_type = 'file'",
      [chatId],
    );
    expect(msg?.status).toBe("failed");
  });

  it("stores a stub outbox row instead of chunk bytes when the peer is offline", async () => {
    const { dbA, chatId, userA, userB, transportA, engineA } = await createPair();
    transportA.setOnline(false);
    const admin = dbA.users.findById(userA)!;
    await engineA.sendFile({
      file: fileOfSize(400),
      fileName: "brief.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      chatId,
      sender: admin,
      recipientUserId: userB,
    });

    const rows = dbA.connection.all<{ chunk_index: number; envelope_json: string }>(
      "SELECT chunk_index, envelope_json FROM file_chunk_outbox WHERE chunk_index >= 0",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.envelope_json === "{}")).toBe(true);

    const sender = dbA.connection.get<{ status: string }>(
      "SELECT status FROM file_transfers WHERE chat_id = ?",
      [chatId],
    );
    expect(sender?.status).toBe("sending");
  });
});
