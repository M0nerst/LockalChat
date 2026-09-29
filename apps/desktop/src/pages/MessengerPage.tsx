import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { MessageDeliveryStatus } from "@lockal/domain";
import type { UserId } from "@lockal/shared";
import { directChatId } from "@lockal/messaging";
import { useApp } from "../context/AppContext.js";
import { FileAttachment } from "../components/FileAttachment.js";
import { Avatar } from "../components/Avatar.js";
import { AppSidebar } from "../components/AppSidebar.js";
import { formatPresence } from "../utils/presence.js";

function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function formatBubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MIME_BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
};

/** Windows often leaves File.type empty for Word, PowerPoint and Excel. */
function mimeTypeForFile(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

/** Telegram-style status marks for the sender's own messages: a clock while
 * still sending, a single check once it's left the device, a double check
 * once the peer's device has it, and a highlighted double check once read.
 * Failed messages are clickable so the user can retry. */
function DeliveryMark({
  status,
  onRetry,
}: {
  status: MessageDeliveryStatus;
  onRetry?: () => void;
}) {
  let mark: string;
  let title: string;
  switch (status) {
    case MessageDeliveryStatus.Sending:
      mark = "🕐";
      title = "Отправляется";
      break;
    case MessageDeliveryStatus.Failed:
      mark = "⚠";
      title = "Не доставлено — нажмите, чтобы повторить";
      break;
    case MessageDeliveryStatus.Read:
      mark = "✓✓";
      title = "Прочитано";
      break;
    case MessageDeliveryStatus.Delivered:
      mark = "✓✓";
      title = "Доставлено";
      break;
    case MessageDeliveryStatus.Sent:
    default:
      mark = "✓";
      title = "Отправлено";
  }
  const className =
    status === MessageDeliveryStatus.Read
      ? "msg-status msg-status-read"
      : status === MessageDeliveryStatus.Failed
        ? "msg-status msg-status-failed"
        : "msg-status";
  if (status === MessageDeliveryStatus.Failed && onRetry) {
    return (
      <button type="button" className={`msg-retry ${className}`} onClick={onRetry} title={title}>
        {mark}
      </button>
    );
  }
  return (
    <span className={className} title={title}>
      {mark}
    </span>
  );
}

/** Renders both the chat-list ("/app") and an open conversation
 * ("/chat/:userId") in one Telegram-style three-column layout: global nav on
 * the left, the chat list in the middle, the open conversation on the
 * right. Using a single component for both routes means the chat list never
 * disappears while you're inside a conversation. */
export function MessengerPage() {
  const { t } = useTranslation();
  const { userId, groupId } = useParams();
  const navigate = useNavigate();
  const { auth, chatService, networkService, userAdminService, persist } = useApp();

  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [historyLimits, setHistoryLimits] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  // `tick` deliberately forces periodic re-reads without being read itself
  // inside the callbacks — see the eslint-disable comments below.
  const orgUsers = useMemo(
    () => (auth ? userAdminService.listUsers(auth.user, auth.organization.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, userAdminService, tick],
  );
  const chats = useMemo(
    () => (auth ? chatService.listChatsForUser(auth.user.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, chatService, tick],
  );

  const peer = userId ? orgUsers.find((u) => u.id === userId) ?? null : null;
  const group = useMemo(() => {
    if (!groupId || !auth) return null;
    const chat = chatService.getChat(groupId as never);
    if (!chat || chat.kind !== "group") return null;
    if (!chatService.listMemberIds(chat.id).includes(auth.user.id)) return null;
    return chat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, chatService, groupId, tick]);

  const chatId = useMemo(() => {
    if (groupId) return groupId as ReturnType<typeof directChatId>;
    if (!auth || !userId) return null;
    return directChatId(auth.user.id, userId as UserId);
  }, [auth, userId, groupId]);

  const text = chatId ? (drafts[chatId] ?? "") : "";
  const historyLimit = chatId ? (historyLimits[chatId] ?? 50) : 50;

  // Auto-grow the composer up to its CSS max-height (see .composer-input),
  // then let it scroll internally — matches Telegram's multi-line input.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, chatId]);

  useEffect(() => {
    if (!auth || !chatId || !userId || groupId) return;
    chatService.ensureDirectChat(auth.organization.id, auth.user.id, userId as UserId);
    persist();
  }, [auth, chatId, userId, groupId, chatService, persist]);

  const messages = useMemo(
    () => (chatId ? chatService.listMessages(chatId, historyLimit) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatService, chatId, tick, historyLimit],
  );
  const transfers = useMemo(
    () => (chatId ? networkService.getFileDownloadService().listTransferProgress(chatId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [networkService, chatId, tick],
  );

  useEffect(() => {
    setSendError(null);
  }, [chatId]);

  useEffect(() => {
    stickToBottomRef.current = true;
    scrollAnchorRef.current = null;
  }, [chatId]);

  useEffect(() => {
    const el = messagesAreaRef.current;
    const anchor = scrollAnchorRef.current;
    if (anchor != null && el) {
      el.scrollTop = el.scrollHeight - anchor;
      scrollAnchorRef.current = null;
      return;
    }
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, chatId, historyLimit]);

  useEffect(() => {
    if (!auth || !chatId) return;
    const unread = chatService.markChatRead(chatId, auth.user.id);
    if (unread.length === 0) return;
    persist();
    setTick((v) => v + 1);
    void networkService.getSyncEngine()?.publishReadReceipts(unread);
  }, [auth, chatId, messages.length, chatService, networkService, persist]);

  if (!auth) return <Navigate to="/login" replace />;
  if (userId && !peer) return <Navigate to="/app" replace />;
  if (groupId && !group) return <Navigate to="/app" replace />;

  const userName = (id: string) => orgUsers.find((u) => u.id === id)?.displayName ?? id;
  const groupMemberLine = group
    ? chatService
        .listMemberIds(group.id)
        .map((id) => (id === auth.user.id ? "вы" : userName(id)))
        .join(", ")
    : "";
  const filteredChats = chats.filter((c) => {
    const label = c.kind === "group" ? (c.title ?? "Группа") : userName(c.otherUserId ?? "");
    return label.toLowerCase().includes(search.trim().toLowerCase());
  });

  async function downloadFile(messageId: string) {
    const file = await networkService.getFileDownloadService().getBlobForMessage(messageId as never);
    if (!file) return;
    // WebView2 drops or mangles Office MIME types (docx, pptx, xlsx) and a short-lived
    // object URL cancels a large download before it starts. A generic type plus the
    // original file name keeps the extension, and the URL stays alive long enough.
    const blob =
      file.blob.type === "application/octet-stream"
        ? file.blob
        : new Blob([file.blob], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }

  function loadOlder() {
    if (!chatId) return;
    const el = messagesAreaRef.current;
    scrollAnchorRef.current = el ? el.scrollHeight - el.scrollTop : 0;
    stickToBottomRef.current = false;
    setHistoryLimits((prev) => ({ ...prev, [chatId]: (prev[chatId] ?? 50) + 50 }));
  }

  function onMessagesScroll() {
    const el = messagesAreaRef.current;
    if (!el || scrollAnchorRef.current != null) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadPreviewUrl(messageId: string): Promise<string | null> {
    const file = await networkService.getFileDownloadService().getBlobForMessage(messageId as never);
    if (!file) return null;
    return URL.createObjectURL(file.blob);
  }

  function pauseTransfer(transferId: string) {
    networkService.getFileTransferEngine()?.pauseTransfer(transferId);
    setTick((v) => v + 1);
  }

  function resumeTransfer(transferId: string) {
    void networkService.getFileTransferEngine()?.resumeTransfer(transferId);
    setTick((v) => v + 1);
  }

  function cancelTransfer(transferId: string) {
    networkService.getFileTransferEngine()?.cancelTransfer(transferId);
    setTick((v) => v + 1);
  }

  async function onSend(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!text.trim() || !auth || !chatId || (!userId && !groupId)) return;
    if (peer?.status === "blocked") {
      setSendError("Пользователь заблокирован");
      return;
    }
    setSendError(null);
    const msg = chatService.sendTextMessage({
      chatId,
      sender: auth.user,
      senderDeviceId: auth.device.id,
      text: text.trim(),
    });
    setDrafts((prev) => ({ ...prev, [chatId]: "" }));
    const engine = networkService.getSyncEngine();
    try {
      if (engine) {
        await engine.publishChatMessage({
          id: msg.id,
          chatId: msg.chatId,
          senderUserId: msg.senderUserId,
          content: msg.contentText,
          clientNonce: msg.clientNonce,
          createdAt: msg.createdAt,
          recipientUserId: groupId ? undefined : userId,
        });
      } else {
        chatService.getMessageRepository().updateStatus(msg.id, MessageDeliveryStatus.Failed);
        setSendError("Нет связи с сетью. Повторите отправку, когда сервис LAN заработает.");
      }
      persist();
    } catch (err) {
      const current = chatService.getMessageRepository().findById(msg.id);
      if (!current || current.status === MessageDeliveryStatus.Sending) {
        chatService.getMessageRepository().updateStatus(msg.id, MessageDeliveryStatus.Failed);
      }
      setSendError((err as Error).message);
      persist();
    }
  }

  async function retryMessage(messageId: string) {
    if (!userId && !groupId) return;
    setSendError(null);
    try {
      await networkService.getSyncEngine()?.retryChatMessage(messageId as never, groupId ? undefined : userId);
      persist();
      setTick((v) => v + 1);
    } catch (err) {
      setSendError((err as Error).message);
      persist();
      setTick((v) => v + 1);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file || !auth || !chatId || (!userId && !groupId)) return;
    if (peer?.status === "blocked") {
      setSendError("Пользователь заблокирован");
      return;
    }
    const recipient = (
      groupId ? chatService.listMemberIds(chatId).find((id) => id !== auth.user.id) : userId
    ) as UserId | undefined;
    if (!recipient) {
      setSendError("Некому отправить файл");
      return;
    }
    const engine = networkService.getFileTransferEngine();
    if (!engine) {
      setSendError("Нет связи с сетью. Повторите отправку, когда сервис LAN заработает.");
      return;
    }
    setUploading(true);
    try {
      await engine.sendFile({
        file,
        fileName: file.name,
        mimeType: mimeTypeForFile(file),
        chatId,
        sender: auth.user,
        recipientUserId: recipient,
      });
      persist();
      setTick((v) => v + 1);
    } catch (err) {
      setSendError((err as Error).message);
      persist();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function retryFile(transferId: string) {
    setSendError(null);
    try {
      await networkService.getFileTransferEngine()?.retryFailedTransfer(transferId);
      persist();
      setTick((v) => v + 1);
    } catch (err) {
      setSendError((err as Error).message);
      persist();
      setTick((v) => v + 1);
    }
  }

  async function createGroup() {
    if (!auth) return;
    setGroupError(null);
    try {
      const id = chatService.createGroupChat({
        organizationId: auth.organization.id,
        creatorId: auth.user.id,
        title: groupTitle,
        memberUserIds: groupMembers as UserId[],
      });
      await networkService.getSyncEngine()?.publishGroupChat(id);
      persist();
      setGroupOpen(false);
      setGroupTitle("");
      setGroupMembers([]);
      navigate(`/group/${id}`);
    } catch (err) {
      setGroupError((err as Error).message);
    }
  }

  async function saveGroupMembers() {
    if (!auth || !group) return;
    setMembersError(null);
    try {
      const previous = chatService.listMemberIds(group.id);
      const next = [auth.user.id, ...editMembers.filter((id) => id !== auth.user.id)];
      chatService.replaceGroupMembers(group.id, next as UserId[]);
      await networkService.getSyncEngine()?.publishGroupChat(group.id, previous);
      persist();
      setMembersOpen(false);
      setTick((v) => v + 1);
    } catch (err) {
      setMembersError((err as Error).message);
    }
  }

  return (
    <div className="messenger-shell">
      <AppSidebar />

      <div className="chat-list-panel">
        <div className="chat-list-header">
          <h2>{t("nav.chats")}</h2>
          <button
            type="button"
            className="secondary chat-new-group"
            onClick={() => {
              setGroupError(null);
              setGroupOpen(true);
            }}
          >
            Группа
          </button>
        </div>
        <div className="chat-search-wrap">
          <input
            className="chat-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск…"
          />
        </div>
        {filteredChats.length === 0 ? (
          <div className="chat-list-empty">
            {chats.length === 0 ? (
              <>
                Пока нет переписок.
                <br />
                <Link to="/contacts">Откройте контакты</Link> и начните личный чат.
              </>
            ) : (
              "Ничего не найдено"
            )}
          </div>
        ) : (
          <ul className="chat-list">
            {filteredChats.map((c) => {
              const isGroup = c.kind === "group";
              const other = !isGroup ? orgUsers.find((u) => u.id === c.otherUserId) : undefined;
              const title = isGroup ? (c.title ?? "Группа") : (other?.displayName ?? c.otherUserId ?? "");
              const isFile = c.lastMessageType === "file";
              const body = c.lastMessageText
                ? isFile
                  ? `📎 ${c.lastMessageText}`
                  : c.lastMessageText
                : isGroup
                  ? "Группа"
                  : "Нет сообщений";
              const previewBody = body.replace(/\s+/g, " ").trim();
              const preview =
                c.lastMessageText && c.lastMessageSenderUserId === auth.user.id
                  ? `Вы: ${previewBody}`
                  : previewBody;
              const active = isGroup ? c.chatId === groupId : c.otherUserId === userId;
              return (
                <li
                  key={c.chatId}
                  className={`chat-list-item${active ? " active" : ""}`}
                  onClick={() => navigate(isGroup ? `/group/${c.chatId}` : `/chat/${c.otherUserId}`)}
                >
                  <Avatar
                    id={isGroup ? c.chatId : (c.otherUserId ?? c.chatId)}
                    name={title}
                    avatarUrl={other?.avatarUrl}
                    online={isGroup ? undefined : other?.presence === "online"}
                  />
                  <div className="chat-list-item-body">
                    <div className="chat-list-item-top">
                      <span className="chat-list-name">{title}</span>
                      <span className="chat-list-time">{formatListTime(c.updatedAt)}</span>
                    </div>
                    <div className="chat-list-preview-row">
                      <div className="chat-list-preview">{preview}</div>
                      {!active && c.unreadCount > 0 && (
                        <span className="unread-badge">{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="conversation-panel">
        {!chatId || (!peer && !group) ? (
          <div className="conversation-empty">
            <img src="/logo.png" alt="" className="conversation-empty-logo" />
            <div>
              Выберите чат слева
              <br />
              или создайте группу
            </div>
          </div>
        ) : (
          <>
            <div className="conversation-header">
              {group ? (
                <>
                  <Avatar id={group.id} name={group.title ?? "Группа"} />
                  <div>
                    <div className="conversation-header-name">{group.title ?? "Группа"}</div>
                    <div className="conversation-header-status" title={groupMemberLine}>
                      {groupMemberLine}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary chat-new-group"
                    onClick={() => {
                      setMembersError(null);
                      setEditMembers(
                        chatService.listMemberIds(group.id).filter((id) => id !== auth.user.id),
                      );
                      setMembersOpen(true);
                    }}
                  >
                    Участники
                  </button>
                </>
              ) : peer ? (
                <>
                  <Avatar
                    id={peer.id}
                    name={peer.displayName}
                    avatarUrl={peer.avatarUrl}
                    online={peer.presence === "online"}
                  />
                  <div>
                    <div className="conversation-header-name">{peer.displayName}</div>
                    <div className="conversation-header-status">{formatPresence(peer)}</div>
                  </div>
                </>
              ) : null}
            </div>
            <div className="messages-area" ref={messagesAreaRef} onScroll={onMessagesScroll}>
              {chatId && chatService.countMessages(chatId) > messages.length && (
                  <button type="button" className="secondary load-earlier" onClick={loadOlder}>
                    Более ранние сообщения
                  </button>
                )}
              {messages.map((m) => {
                const own = m.senderUserId === auth.user.id;
                const transfer =
                  m.contentType === "file" ? transfers.find((tr) => tr.messageId === m.id) ?? null : null;
                return (
                  <div key={m.id} className={`msg-row${own ? " own" : ""}`}>
                    <div className="msg-bubble">
                      {group && !own && (
                        <div className="msg-sender">{userName(m.senderUserId)}</div>
                      )}
                      {m.contentType === "file" ? (
                        transfer ? (
                          <FileAttachment
                            info={{
                              fileName: transfer.fileName,
                              mimeType: transfer.mimeType,
                              sizeBytes: transfer.sizeBytes,
                              status: transfer.status,
                              nextChunkIndex: transfer.nextChunkIndex,
                              totalChunks: transfer.totalChunks,
                              isOutgoing: transfer.senderDeviceId === auth.device.id,
                            }}
                            onDownload={() => void downloadFile(m.id)}
                            onLoadPreview={() => loadPreviewUrl(m.id)}
                            onPause={() => pauseTransfer(transfer.id)}
                            onResume={() => resumeTransfer(transfer.id)}
                            onCancel={() => cancelTransfer(transfer.id)}
                            onRetry={() => void retryFile(transfer.id)}
                          />
                        ) : (
                          <>
                            📎 {m.contentText}{" "}
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => void downloadFile(m.id)}
                            >
                              Скачать
                            </button>
                          </>
                        )
                      ) : (
                        m.contentText
                      )}
                      <span className="msg-time">
                        {formatBubbleTime(m.createdAt)}
                        {own && (
                          <span className="msg-status-wrap">
                            {" "}
                            <DeliveryMark
                              status={m.status}
                              onRetry={
                                m.status === MessageDeliveryStatus.Failed && m.contentType !== "file"
                                  ? () => void retryMessage(m.id)
                                  : undefined
                              }
                            />
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <form className="composer" onSubmit={onSend}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
                disabled={uploading || peer?.status === "blocked"}
              />
              <button
                type="button"
                className="secondary composer-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || peer?.status === "blocked"}
                title="Прикрепить файл"
              >
                📎
              </button>
              <textarea
                ref={composerRef}
                className="composer-input"
                rows={1}
                value={text}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!chatId) return;
                  setDrafts((prev) => ({ ...prev, [chatId]: value }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void onSend(e);
                  }
                }}
                placeholder={
                  peer?.status === "blocked"
                    ? "Пользователь заблокирован"
                    : uploading
                      ? "Отправка файла…"
                      : "Сообщение…"
                }
                disabled={uploading || peer?.status === "blocked"}
              />
              <button
                type="submit"
                className="composer-send"
                disabled={!text.trim() || uploading || peer?.status === "blocked"}
              >
                ➤
              </button>
            </form>
            {sendError && (
              <p className="error" style={{ padding: "0 16px 8px" }}>
                {sendError}
              </p>
            )}
          </>
        )}
      </div>
      {groupOpen && (
        <div className="modal-backdrop" onClick={() => { setGroupOpen(false); setGroupError(null); }}>
          <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Новая группа</h3>
            <label htmlFor="group-title">Название</label>
            <input
              id="group-title"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Например, Отдел"
            />
            <p className="auth-subtitle" style={{ textAlign: "left" }}>
              Участники
            </p>
            <ul className="group-member-list">
              {orgUsers
                .filter((u) => u.id !== auth.user.id && u.status !== "blocked")
                .map((u) => (
                  <li key={u.id}>
                    <label className="group-member-row">
                      <input
                        type="checkbox"
                        checked={groupMembers.includes(u.id)}
                        onChange={(e) => {
                          setGroupMembers((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                          );
                        }}
                      />
                      <Avatar id={u.id} name={u.displayName} size={32} avatarUrl={u.avatarUrl} />
                      <span>{u.displayName}</span>
                    </label>
                  </li>
                ))}
            </ul>
            {groupError && <p className="error">{groupError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setGroupOpen(false);
                  setGroupError(null);
                }}
              >
                Отмена
              </button>
              <button type="button" onClick={() => void createGroup()}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
      {membersOpen && group && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setMembersOpen(false);
            setMembersError(null);
          }}
        >
          <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Участники</h3>
            <p className="auth-subtitle" style={{ textAlign: "left" }}>
              {group.title ?? "Группа"}
            </p>
            <ul className="group-member-list">
              <li>
                <label className="group-member-row">
                  <input type="checkbox" checked disabled />
                  <Avatar id={auth.user.id} name={auth.user.displayName} size={32} avatarUrl={auth.user.avatarUrl} />
                  <span>{auth.user.displayName} (вы)</span>
                </label>
              </li>
              {orgUsers
                .filter(
                  (u) =>
                    u.id !== auth.user.id &&
                    (u.status !== "blocked" || editMembers.includes(u.id) || chatService.listMemberIds(group.id).includes(u.id)),
                )
                .map((u) => (
                  <li key={u.id}>
                    <label className="group-member-row">
                      <input
                        type="checkbox"
                        checked={editMembers.includes(u.id)}
                        onChange={(e) => {
                          setEditMembers((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                          );
                        }}
                      />
                      <Avatar id={u.id} name={u.displayName} size={32} avatarUrl={u.avatarUrl} />
                      <span>{u.displayName}</span>
                    </label>
                  </li>
                ))}
            </ul>
            {membersError && <p className="error">{membersError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMembersOpen(false);
                  setMembersError(null);
                }}
              >
                Отмена
              </button>
              <button type="button" onClick={() => void saveGroupMembers()}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
