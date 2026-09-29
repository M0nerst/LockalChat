import type { DatabaseContext } from "@lockal/database";
import { MessageDeliveryStatus } from "@lockal/domain";
import type { User } from "@lockal/domain";
import type { ChatId, DeviceId, OrganizationId, UserId } from "@lockal/shared";
import { isoNow, messageId, randomBytes, generateId } from "@lockal/shared";
import { bytesToBase64Url } from "@lockal/crypto";
import { MessageRepository, type StoredMessage } from "./message-repository.js";

export function directChatId(userA: UserId, userB: UserId): ChatId {
  const [a, b] = [userA, userB].sort();
  return `dm_${a}_${b}` as ChatId;
}

export class ChatService {
  private readonly messages: MessageRepository;

  constructor(private readonly db: DatabaseContext) {
    this.messages = new MessageRepository(db);
  }

  ensureDirectChat(organizationId: OrganizationId, userA: UserId, userB: UserId): ChatId {
    const id = directChatId(userA, userB);
    const existing = this.db.connection.get<{ id: string }>("SELECT id FROM chats WHERE id = ?", [id]);
    if (existing) return id;
    const now = isoNow();
    this.db.connection.exec(
      "INSERT INTO chats (id, organization_id, kind, title, created_at, updated_at) VALUES (?, ?, 'direct', NULL, ?, ?)",
      [id, organizationId, now, now],
    );
    for (const uid of [userA, userB]) {
      this.db.connection.exec(
        "INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        [id, uid, now],
      );
    }
    return id;
  }

  createGroupChat(input: {
    organizationId: OrganizationId;
    creatorId: UserId;
    title: string;
    memberUserIds: UserId[];
  }): ChatId {
    const title = input.title.trim();
    if (!title) throw new Error("Укажите название группы");
    const members = [...new Set([input.creatorId, ...input.memberUserIds])];
    if (members.length < 2) throw new Error("Добавьте хотя бы одного участника");
    const id = generateId("grp") as ChatId;
    const now = isoNow();
    this.db.connection.exec(
      "INSERT INTO chats (id, organization_id, kind, title, created_at, updated_at) VALUES (?, ?, 'group', ?, ?, ?)",
      [id, input.organizationId, title, now, now],
    );
    for (const uid of members) {
      this.db.connection.exec(
        "INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        [id, uid, now],
      );
    }
    this.db.connection.exec("UPDATE chats SET roster_revision = 1 WHERE id = ?", [id]);
    return id;
  }

  /** Replaces the member list of an existing group and bumps its roster revision. */
  replaceGroupMembers(chatId: ChatId, memberUserIds: UserId[]): number {
    const chat = this.getChat(chatId);
    if (!chat || chat.kind !== "group") throw new Error("Это не группа");
    const members = [...new Set(memberUserIds)];
    if (members.length < 2) throw new Error("В группе должно остаться хотя бы два участника");
    const now = isoNow();
    const revision = this.rosterRevision(chatId) + 1;
    const placeholders = members.map(() => "?").join(", ");
    this.db.connection.exec(
      `DELETE FROM chat_members WHERE chat_id = ? AND user_id NOT IN (${placeholders})`,
      [chatId, ...members],
    );
    for (const uid of members) {
      this.db.connection.exec(
        "INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        [chatId, uid, now],
      );
    }
    this.db.connection.exec("UPDATE chats SET roster_revision = ?, updated_at = ? WHERE id = ?", [
      revision,
      now,
      chatId,
    ]);
    return revision;
  }

  rosterRevision(chatId: ChatId): number {
    const row = this.db.connection.get<{ roster_revision: number | null }>(
      "SELECT roster_revision FROM chats WHERE id = ?",
      [chatId],
    );
    return Number(row?.roster_revision) || 0;
  }

  /** Creates or refreshes a group that arrived from another device. */
  upsertGroupChat(input: {
    organizationId: OrganizationId;
    chatId: ChatId;
    title: string;
    memberUserIds: UserId[];
    createdAt?: string;
    /** When false, an existing group's title is left alone (message retries must not rename it). */
    updateTitle?: boolean;
    /** Newer snapshots replace the member list. Older ones are ignored. */
    rosterRevision?: number;
  }): void {
    if (!input.chatId.startsWith("grp_")) return;
    const title = input.title.trim();
    const now = input.createdAt ?? isoNow();
    const existing = this.db.connection.get<{ id: string; kind: string }>(
      "SELECT id, kind FROM chats WHERE id = ?",
      [input.chatId],
    );
    if (existing && existing.kind !== "group") return;
    if (!existing) {
      this.db.connection.exec(
        "INSERT INTO chats (id, organization_id, kind, title, created_at, updated_at) VALUES (?, ?, 'group', ?, ?, ?)",
        [input.chatId, input.organizationId, title || "Группа", now, now],
      );
    } else if (input.updateTitle !== false && title) {
      this.db.connection.exec("UPDATE chats SET title = ? WHERE id = ? AND kind = 'group'", [
        title,
        input.chatId,
      ]);
    }
    const incomingRevision = input.rosterRevision ?? 0;
    const storedRevision = existing ? this.rosterRevision(input.chatId) : 0;
    const applyMembers = !existing || (incomingRevision > 0 && incomingRevision > storedRevision);
    if (applyMembers && input.memberUserIds.length > 0) {
      if (existing) {
        const placeholders = input.memberUserIds.map(() => "?").join(", ");
        this.db.connection.exec(
          `DELETE FROM chat_members WHERE chat_id = ? AND user_id NOT IN (${placeholders})`,
          [input.chatId, ...input.memberUserIds],
        );
      }
      for (const uid of input.memberUserIds) {
        this.db.connection.exec(
          "INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
          [input.chatId, uid, now],
        );
      }
      if (incomingRevision > storedRevision) {
        this.db.connection.exec("UPDATE chats SET roster_revision = ? WHERE id = ?", [
          incomingRevision,
          input.chatId,
        ]);
      }
    }
  }

  listMemberIds(chatId: ChatId): UserId[] {
    return this.db.connection
      .all<{ user_id: string }>("SELECT user_id FROM chat_members WHERE chat_id = ?", [chatId])
      .map((r) => r.user_id as UserId);
  }

  getChat(chatId: ChatId): { id: ChatId; kind: string; title: string | null } | null {
    const row = this.db.connection.get<{ id: string; kind: string; title: string | null }>(
      "SELECT id, kind, title FROM chats WHERE id = ?",
      [chatId],
    );
    if (!row) return null;
    return { id: row.id as ChatId, kind: row.kind, title: row.title };
  }

  sendTextMessage(input: {
    chatId: ChatId;
    sender: User;
    senderDeviceId: DeviceId;
    text: string;
  }): StoredMessage {
    const nonce = bytesToBase64Url(randomBytes(16));
    if (this.messages.existsByNonce(input.chatId, nonce)) {
      throw new Error("Duplicate client nonce");
    }
    const msg: StoredMessage = {
      id: messageId(),
      chatId: input.chatId,
      senderUserId: input.sender.id,
      senderDeviceId: input.senderDeviceId,
      contentType: "text",
      contentText: input.text,
      status: MessageDeliveryStatus.Sending,
      clientNonce: nonce,
      createdAt: isoNow(),
    };
    this.messages.insert(msg);
    const now = isoNow();
    this.db.connection.exec("UPDATE chats SET updated_at = ? WHERE id = ?", [now, input.chatId]);
    return msg;
  }

  /** Bumps a chat's `updated_at` to now — used whenever a message lands in it
   * through a path that doesn't already do so (e.g. inbound sync/file
   * messages inserted directly via a repository). Without this, chats that
   * only ever *receive* messages on a given device never rise to the top of
   * that device's chat list, even though the sender's device correctly
   * reorders theirs via `sendTextMessage`. */
  touchChat(chatId: ChatId, at: string = isoNow()): void {
    this.db.connection.exec("UPDATE chats SET updated_at = ? WHERE id = ?", [at, chatId]);
  }

  /** Recovers the two participant user ids from a `dm_<userA>_<userB>` chat id.
   * IDs themselves look like `usr_<body>` — a naive `split("_")` would shatter
   * on the prefix's own underscore, so we anchor on the `usr_` prefix instead. */
  ensureChatFromDirectId(organizationId: OrganizationId, id: ChatId): void {
    if (this.db.connection.get("SELECT id FROM chats WHERE id = ?", [id])) return;
    const match = /^dm_(usr_[0-9a-z]+)_(usr_[0-9a-z]+)$/.exec(id);
    if (!match) return;
    this.ensureDirectChat(organizationId, match[1] as UserId, match[2] as UserId);
  }

  listMessages(chatId: ChatId, limit = 50): StoredMessage[] {
    return this.messages.listByChat(chatId, limit).reverse();
  }

  hasMessagesBefore(chatId: ChatId, createdAt: string): boolean {
    return this.messages.hasMessagesBefore(chatId, createdAt);
  }

  countMessages(chatId: ChatId): number {
    return this.messages.countByChat(chatId);
  }

  listDirectChatsForUser(userId: UserId): Array<{
    chatId: ChatId;
    otherUserId: UserId;
    updatedAt: string;
    lastMessageText: string | null;
    lastMessageType: string | null;
    lastMessageSenderUserId: UserId | null;
    unreadCount: number;
  }> {
    const rows = this.db.connection.all<{
      chat_id: string;
      other_user_id: string;
      updated_at: string;
      last_text: string | null;
      last_type: string | null;
      last_sender: string | null;
      unread_count: number;
    }>(
      `SELECT c.id AS chat_id,
              (SELECT cm2.user_id FROM chat_members cm2
                WHERE cm2.chat_id = c.id AND cm2.user_id != ? LIMIT 1) AS other_user_id,
              c.updated_at AS updated_at,
              (SELECT content_text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_text,
              (SELECT content_type FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_type,
              (SELECT sender_user_id FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_sender,
              (SELECT COUNT(*) FROM messages m
                WHERE m.chat_id = c.id AND m.sender_user_id != ?
                  AND m.created_at > COALESCE(cm.last_read_at, '')) AS unread_count
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
       WHERE c.kind = 'direct'
         AND EXISTS (
           SELECT 1 FROM chat_members cm3 WHERE cm3.chat_id = c.id AND cm3.user_id != ?
         )
       ORDER BY c.updated_at DESC`,
      [userId, userId, userId, userId],
    );
    return rows.map((r) => ({
      chatId: r.chat_id as ChatId,
      otherUserId: r.other_user_id as UserId,
      updatedAt: r.updated_at,
      lastMessageText: r.last_text,
      lastMessageType: r.last_type,
      lastMessageSenderUserId: (r.last_sender as UserId) ?? null,
      unreadCount: Number(r.unread_count) || 0,
    }));
  }

  listChatsForUser(userId: UserId): Array<{
    chatId: ChatId;
    kind: "direct" | "group";
    title: string | null;
    otherUserId: UserId | null;
    updatedAt: string;
    lastMessageText: string | null;
    lastMessageType: string | null;
    lastMessageSenderUserId: UserId | null;
    unreadCount: number;
  }> {
    const direct = this.listDirectChatsForUser(userId).map((c) => ({
      ...c,
      kind: "direct" as const,
      title: null,
    }));
    const groups = this.db.connection
      .all<{
        chat_id: string;
        title: string | null;
        updated_at: string;
        last_text: string | null;
        last_type: string | null;
        last_sender: string | null;
        unread_count: number;
      }>(
        `SELECT c.id AS chat_id, c.title AS title, c.updated_at AS updated_at,
                (SELECT content_text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_text,
                (SELECT content_type FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_type,
                (SELECT sender_user_id FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*) FROM messages m
                  WHERE m.chat_id = c.id AND m.sender_user_id != ?
                    AND m.created_at > COALESCE(cm.last_read_at, '')) AS unread_count
         FROM chats c
         JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
         WHERE c.kind = 'group'
         ORDER BY c.updated_at DESC`,
        [userId, userId],
      )
      .map((r) => ({
        chatId: r.chat_id as ChatId,
        kind: "group" as const,
        title: r.title,
        otherUserId: null,
        updatedAt: r.updated_at,
        lastMessageText: r.last_text,
        lastMessageType: r.last_type,
        lastMessageSenderUserId: (r.last_sender as UserId) ?? null,
        unreadCount: Number(r.unread_count) || 0,
      }));
    return [...direct, ...groups].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Returns incoming messages that the viewer has not yet marked as read,
   * then stamps `chat_members.last_read_at`. Empty when there's nothing new
   * — callers use the returned rows to send `chat.ack` read receipts. */
  markChatRead(chatId: ChatId, viewerUserId: UserId): StoredMessage[] {
    const row = this.db.connection.get<{ last_read_at: string | null }>(
      "SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?",
      [chatId, viewerUserId],
    );
    const unread = this.messages.listIncomingSince(chatId, viewerUserId, row?.last_read_at ?? null);
    if (unread.length === 0) return [];
    // Stamp at least as far as the newest message. A sender clock that is ahead
    // of ours would otherwise leave created_at > last_read_at forever, so the
    // badge never clears.
    let readAt = isoNow();
    for (const message of unread) {
      if (message.createdAt > readAt) readAt = message.createdAt;
    }
    this.db.connection.exec(
      "UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ?",
      [readAt, chatId, viewerUserId],
    );
    return unread;
  }

  getMessageRepository(): MessageRepository {
    return this.messages;
  }
}
