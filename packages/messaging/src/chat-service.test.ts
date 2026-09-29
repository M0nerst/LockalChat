import { describe, expect, it } from "vitest";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { deviceId, isoNow, organizationId, userId } from "@lockal/shared";
import { ChatService, directChatId } from "./chat-service.js";

async function createDb() {
  return new DatabaseContext(await SqliteConnection.open(true));
}

describe("ChatService.ensureChatFromDirectId", () => {
  it("recovers both participant ids from a dm_<userA>_<userB> chat id", async () => {
    // Regression test: user ids look like `usr_<body>` — a naive split("_")
    // on the combined chat id shatters into 4 parts instead of 2, silently
    // no-op'ing chat creation on the receiving device.
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const chatId = directChatId(alice, bob);

    expect(db.connection.get("SELECT id FROM chats WHERE id = ?", [chatId])).toBeNull();

    chat.ensureChatFromDirectId(orgId, chatId);

    expect(db.connection.get("SELECT id FROM chats WHERE id = ?", [chatId])).not.toBeNull();
    const members = db.connection.all<{ user_id: string }>(
      "SELECT user_id FROM chat_members WHERE chat_id = ?",
      [chatId],
    );
    expect(members.map((m) => m.user_id).sort()).toEqual([alice, bob].sort());
  });

  it("is a no-op if the chat already exists", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);

    // Should not throw or duplicate members when called again via the id path.
    chat.ensureChatFromDirectId(orgId, chatId);
    const members = db.connection.all("SELECT user_id FROM chat_members WHERE chat_id = ?", [chatId]);
    expect(members.length).toBe(2);
  });

  it("ignores malformed ids instead of throwing", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    expect(() => chat.ensureChatFromDirectId(organizationId(), "not-a-real-id" as never)).not.toThrow();
    const now = isoNow();
    void now;
  });
});

describe("ChatService unread / markChatRead", () => {
  it("counts incoming messages as unread until the viewer marks the chat read", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);

    chat.sendTextMessage({
      chatId,
      sender: { id: alice } as never,
      senderDeviceId: deviceId(),
      text: "привет",
    });

    const bobList = chat.listDirectChatsForUser(bob);
    expect(bobList[0]?.unreadCount).toBe(1);
    expect(chat.listDirectChatsForUser(alice)[0]?.unreadCount).toBe(0);

    const unread = chat.markChatRead(chatId, bob);
    expect(unread).toHaveLength(1);
    expect(unread[0]?.contentText).toBe("привет");
    expect(chat.listDirectChatsForUser(bob)[0]?.unreadCount).toBe(0);
    expect(chat.listDirectChatsForUser(alice)[0]?.lastMessageSenderUserId).toBe(alice);
    expect(chat.markChatRead(chatId, bob)).toHaveLength(0);
  });

  it("creates a group chat that lists for every member", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const cara = userId();
    const id = chat.createGroupChat({
      organizationId: orgId,
      creatorId: alice,
      title: "Отдел",
      memberUserIds: [bob, cara],
    });
    const listed = chat.listChatsForUser(bob);
    expect(listed.some((c) => c.chatId === id && c.kind === "group" && c.title === "Отдел")).toBe(true);
    expect(chat.listMemberIds(id).sort()).toEqual([alice, bob, cara].sort());
    expect(() =>
      chat.createGroupChat({ organizationId: orgId, creatorId: alice, title: "  ", memberUserIds: [bob] }),
    ).toThrow(/название/);
  });

  it("does not duplicate a direct chat when an extra member row exists", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const cara = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);
    const now = isoNow();
    db.connection.exec("INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)", [
      chatId,
      cara,
      now,
    ]);
    expect(chat.listDirectChatsForUser(alice)).toHaveLength(1);
    expect(chat.listChatsForUser(alice)).toHaveLength(1);
  });

  it("ignores a group roster aimed at a direct chat id", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const cara = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);
    chat.upsertGroupChat({
      organizationId: orgId,
      chatId,
      title: "Взломанное",
      memberUserIds: [alice, bob, cara],
    });
    expect(chat.listMemberIds(chatId).sort()).toEqual([alice, bob].sort());
    expect(chat.getChat(chatId)?.kind).toBe("direct");
  });

  it("clears unread for a message dated ahead of this device's clock", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);
    const msg = chat.sendTextMessage({
      chatId,
      sender: { id: alice } as never,
      senderDeviceId: deviceId(),
      text: "из будущего",
    });
    const future = new Date(Date.now() + 120_000).toISOString();
    db.connection.exec("UPDATE messages SET created_at = ? WHERE id = ?", [future, msg.id]);
    expect(chat.listDirectChatsForUser(bob)[0]?.unreadCount).toBe(1);
    chat.markChatRead(chatId, bob);
    expect(chat.listDirectChatsForUser(bob)[0]?.unreadCount).toBe(0);
  });

  it("reports messages older than the loaded page", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const chatId = chat.ensureDirectChat(orgId, alice, bob);
    for (let i = 0; i < 3; i++) {
      const msg = chat.sendTextMessage({
        chatId,
        sender: { id: alice } as never,
        senderDeviceId: deviceId(),
        text: `m${i}`,
      });
      db.connection.exec("UPDATE messages SET created_at = ? WHERE id = ?", [
        new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        msg.id,
      ]);
    }
    const page = chat.listMessages(chatId, 2);
    expect(page).toHaveLength(2);
    expect(chat.hasMessagesBefore(chatId, page[0]!.createdAt)).toBe(true);
    expect(chat.hasMessagesBefore(chatId, chat.listMessages(chatId, 3)[0]!.createdAt)).toBe(false);
  });

  it("replaces group members and ignores an older roster snapshot", async () => {
    const db = await createDb();
    const chat = new ChatService(db);
    const orgId = organizationId();
    const alice = userId();
    const bob = userId();
    const cara = userId();
    const id = chat.createGroupChat({
      organizationId: orgId,
      creatorId: alice,
      title: "Отдел",
      memberUserIds: [bob, cara],
    });
    expect(chat.rosterRevision(id)).toBe(1);
    const revision = chat.replaceGroupMembers(id, [alice, bob]);
    expect(revision).toBe(2);
    expect(chat.listMemberIds(id).sort()).toEqual([alice, bob].sort());
    chat.upsertGroupChat({
      organizationId: orgId,
      chatId: id,
      title: "Отдел",
      memberUserIds: [alice, bob, cara],
      rosterRevision: 1,
    });
    expect(chat.listMemberIds(id).sort()).toEqual([alice, bob].sort());
    chat.upsertGroupChat({
      organizationId: orgId,
      chatId: id,
      title: "Отдел",
      memberUserIds: [alice, cara],
      rosterRevision: 3,
    });
    expect(chat.listMemberIds(id).sort()).toEqual([alice, cara].sort());
    expect(() => chat.replaceGroupMembers(id, [alice])).toThrow(/два участника/);
  });
});
