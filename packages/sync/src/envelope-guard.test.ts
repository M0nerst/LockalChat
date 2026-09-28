import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair, signEnvelope } from "@lockal/crypto";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { DeviceTrustStatus, UserRole, UserStatus } from "@lockal/domain";
import { createEnvelope, deviceId, isoNow, organizationId, userId } from "@lockal/shared";
import { EnvelopeGuard } from "./envelope-guard.js";

async function setup() {
  const db = new DatabaseContext(await SqliteConnection.open(true));
  const now = isoNow();
  const orgId = organizationId();
  const orgKeys = await generateIdentityKeyPair();
  db.organizations.create(
    { id: orgId, name: "Org", publicKey: orgKeys.publicKey, fingerprint: orgKeys.fingerprint, createdAt: now },
    orgKeys.privateKey,
  );
  const uid = userId();
  db.users.create({
    id: uid,
    organizationId: orgId,
    username: "a",
    displayName: "A",
    passwordHash: "x",
    role: UserRole.Admin,
    status: UserStatus.Active,
    departmentId: null,
    avatarUrl: null,
    presence: "online" as never,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const devId = deviceId();
  const keys = await generateIdentityKeyPair();
  db.devices.create({
    id: devId,
    userId: uid,
    organizationId: orgId,
    name: "pc",
    platform: "test",
    appVersion: "0.1.0",
    publicKey: keys.publicKey,
    fingerprint: keys.fingerprint,
    trustStatus: DeviceTrustStatus.Trusted,
    lastSeenAt: now,
    lastIp: null,
    createdAt: now,
  });
  return { db, devId, privateKey: keys.privateKey };
}

async function signedEnvelope(devId: string, privateKey: string, nonce: string) {
  const envelope = createEnvelope({
    messageType: "chat.message",
    messageId: `msg_${nonce}`,
    senderDeviceId: devId,
    nonce,
    payload: { hello: "world" },
  });
  envelope.signature = await signEnvelope(privateKey, envelope);
  return envelope;
}

describe("EnvelopeGuard replay protection", () => {
  it("accepts a valid envelope once", async () => {
    const { db, devId, privateKey } = await setup();
    const guard = new EnvelopeGuard(db);
    const envelope = await signedEnvelope(devId, privateKey, "nonce-1");
    expect(await guard.accept(envelope)).toBe(true);
  });

  it("rejects an exact replay of the same (device, nonce) pair", async () => {
    const { db, devId, privateKey } = await setup();
    const guard = new EnvelopeGuard(db);
    const envelope = await signedEnvelope(devId, privateKey, "nonce-2");
    expect(await guard.accept(envelope)).toBe(true);
    // Simulate an attacker (or a buggy peer) re-sending the exact same bytes later.
    expect(await guard.accept({ ...envelope })).toBe(false);
  });

  it("still accepts a fresh nonce from the same device after a prior message", async () => {
    const { db, devId, privateKey } = await setup();
    const guard = new EnvelopeGuard(db);
    const first = await signedEnvelope(devId, privateKey, "nonce-3");
    const second = await signedEnvelope(devId, privateKey, "nonce-4");
    expect(await guard.accept(first)).toBe(true);
    expect(await guard.accept(second)).toBe(true);
  });

  it("rejects envelopes with an invalid signature before even checking the nonce", async () => {
    const { db, devId, privateKey } = await setup();
    const guard = new EnvelopeGuard(db);
    const envelope = await signedEnvelope(devId, privateKey, "nonce-5");
    envelope.payload = { hello: "tampered" };
    expect(await guard.accept(envelope)).toBe(false);
  });
});
