import { describe, expect, it } from "vitest";
import { MemorySecureStorage, generateIdentityKeyPair } from "@lockal/crypto";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import { ChatService, directChatId } from "@lockal/messaging";
import { InMemoryTransport } from "@lockal/networking";
import { deviceId, isoNow, userId } from "@lockal/shared";
import { SetupService } from "@lockal/application";
import { SyncEngine } from "./sync-engine.js";

async function createLanPair() {
  const db = new DatabaseContext(await SqliteConnection.open(true));
  const storage = new MemorySecureStorage();
  const setup = new SetupService(db, storage);
  const org = await setup.createOrganization({
    organizationName: "LAN Org",
    adminUsername: "admin",
    adminDisplayName: "Admin",
    adminPassword: "pass",
    deviceName: "admin-pc",
    platform: "test",
    appVersion: "0.1.0",
  });

  const employee = userId();
  const now = isoNow();
  db.users.create({
    id: employee,
    organizationId: org.organizationId,
    username: "ivan",
    displayName: "Ivan",
    passwordHash: db.users.findByUsername(org.organizationId, "admin")!.passwordHash,
    role: UserRole.User,
    status: UserStatus.Active,
    departmentId: null,
    avatarUrl: null,
    presence: PresenceStatus.Offline,
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const dev2 = deviceId();
  const keys2 = await generateIdentityKeyPair();
  db.devices.create({
    id: dev2,
    userId: employee,
    organizationId: org.organizationId,
    name: "ivan-phone",
    platform: "test",
    appVersion: "0.1.0",
    publicKey: keys2.publicKey,
    fingerprint: keys2.fingerprint,
    trustStatus: DeviceTrustStatus.Trusted,
    lastSeenAt: now,
    lastIp: null,
    createdAt: now,
  });
  await storage.set(`device:${dev2}:privateKey`, keys2.privateKey);

  const adminPrivateKey = (await storage.get(`device:${org.deviceId}:privateKey`))!;
  const transportA = new InMemoryTransport(org.deviceId, {
    deviceId: org.deviceId,
    userId: org.userId,
    publicKey: "pk-a",
    addresses: ["127.0.0.1:39200"],
    lastSeenAt: now,
    trusted: true,
  });
  const transportB = new InMemoryTransport(dev2, {
    deviceId: dev2,
    userId: employee,
    publicKey: "pk-b",
    addresses: ["127.0.0.1:39201"],
    lastSeenAt: now,
    trusted: true,
  });
  InMemoryTransport.link(transportA, transportB);

  const engineA = new SyncEngine(db, transportA, {
    organizationId: org.organizationId,
    deviceId: org.deviceId,
    userId: org.userId,
    devicePrivateKey: adminPrivateKey,
  });
  const engineB = new SyncEngine(db, transportB, {
    organizationId: org.organizationId,
    deviceId: dev2,
    userId: employee,
    devicePrivateKey: keys2.privateKey,
  });
  engineA.start();
  engineB.start();

  return { db, org, employee, dev2, engineA, engineB };
}

describe("Messaging over transport", () => {
  it("delivers chat.message between two devices", async () => {
    const { db, org, employee, engineA, engineB } = await createLanPair();
    const chat = new ChatService(db);
    const chatId = chat.ensureDirectChat(org.organizationId, org.userId, employee);
    const admin = db.users.findById(org.userId)!;

    const msg = chat.sendTextMessage({
      chatId,
      sender: admin,
      senderDeviceId: org.deviceId,
      text: "Привет из LAN",
    });

    await engineA.publishChatMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderUserId: msg.senderUserId,
      content: msg.contentText,
      clientNonce: msg.clientNonce,
      createdAt: msg.createdAt,
    });

    await new Promise((r) => setTimeout(r, 30));

    const received = chat.listMessages(directChatId(org.userId, employee));
    expect(received.some((m) => m.contentText === "Привет из LAN")).toBe(true);

    engineA.stop();
    engineB.stop();
  });

  it("marks the local message Failed when no recipient device exists", async () => {
    const db = new DatabaseContext(await SqliteConnection.open(true));
    const storage = new MemorySecureStorage();
    const setup = new SetupService(db, storage);
    const org = await setup.createOrganization({
      organizationName: "Solo Org",
      adminUsername: "admin",
      adminDisplayName: "Admin",
      adminPassword: "pass",
      deviceName: "admin-pc",
      platform: "test",
      appVersion: "0.1.0",
    });
    const ghost = userId();
    const now = isoNow();
    db.users.create({
      id: ghost,
      organizationId: org.organizationId,
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
    const chat = new ChatService(db);
    const chatId = chat.ensureDirectChat(org.organizationId, org.userId, ghost);
    const admin = db.users.findById(org.userId)!;
    const msg = chat.sendTextMessage({
      chatId,
      sender: admin,
      senderDeviceId: org.deviceId,
      text: "это никуда не уйдёт",
    });
    const adminPrivateKey = (await storage.get(`device:${org.deviceId}:privateKey`))!;
    const transport = new InMemoryTransport(org.deviceId, {
      deviceId: org.deviceId,
      userId: org.userId,
      publicKey: "pk-solo",
      addresses: [],
      lastSeenAt: now,
      trusted: true,
    });
    const engine = new SyncEngine(db, transport, {
      organizationId: org.organizationId,
      deviceId: org.deviceId,
      userId: org.userId,
      devicePrivateKey: adminPrivateKey,
    });
    await expect(
      engine.publishChatMessage({
        id: msg.id,
        chatId: msg.chatId,
        senderUserId: msg.senderUserId,
        content: msg.contentText,
        clientNonce: msg.clientNonce,
        createdAt: msg.createdAt,
        recipientUserId: ghost,
      }),
    ).rejects.toThrow(/не найдено/);
    expect(chat.getMessageRepository().findById(msg.id)?.status).toBe("failed");
  });
});
