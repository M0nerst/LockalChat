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
  const { userId } = useParams();
  const navigate = useNavigate();
  const { auth, chatService, networkService, userAdminService, persist } = useApp();

  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer up to its CSS max-height (see .composer-input),
  // then let it scroll internally — matches Telegram's multi-line input.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

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
    () => (auth ? chatService.listDirectChatsForUser(auth.user.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, chatService, tick],
  );

  const peer = userId ? orgUsers.find((u) => u.id === userId) ?? null : null;

  const chatId = useMemo(() => {
    if (!auth || !userId) return null;
    return directChatId(auth.user.id, userId as UserId);
  }, [auth, userId]);

  useEffect(() => {
    if (!auth || !chatId || !userId) return;
    chatService.ensureDirectChat(auth.organization.id, auth.user.id, userId as UserId);
    persist();
  }, [auth, chatId, userId, chatService, persist]);

  const messages = useMemo(
    () => (chatId ? chatService.listMessages(chatId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatService, chatId, tick],
  );
  const transfers = useMemo(
    () => (chatId ? networkService.getFileDownloadService().listTransferProgress(chatId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [networkService, chatId, tick],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, chatId]);

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

  const userName = (id: string) => orgUsers.find((u) => u.id === id)?.displayName ?? id;
  const filteredChats = chats.filter((c) =>
    userName(c.otherUserId).toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function downloadFile(messageId: string) {
    const file = await networkService.getFileDownloadService().getBlobForMessage(messageId as never);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
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
    if (!text.trim() || !auth || !chatId || !userId) return;
    setSendError(null);
    const msg = chatService.sendTextMessage({
      chatId,
      sender: auth.user,
      senderDeviceId: auth.device.id,
      text: text.trim(),
    });
    setText("");
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
          recipientUserId: userId,
        });
      } else {
        chatService.getMessageRepository().updateStatus(msg.id, MessageDeliveryStatus.Failed);
        setSendError("Нет связи с сетью. Повторите отправку, когда сервис LAN заработает.");
      }
      persist();
    } catch (err) {
      chatService.getMessageRepository().updateStatus(msg.id, MessageDeliveryStatus.Failed);
      setSendError((err as Error).message);
      persist();
    }
  }

  async function retryMessage(messageId: string) {
    if (!userId) return;
    setSendError(null);
    try {
      await networkService.getSyncEngine()?.retryChatMessage(messageId as never, userId);
      persist();
      setTick((v) => v + 1);
    } catch (err) {
      setSendError((err as Error).message);
      persist();
      setTick((v) => v + 1);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file || !auth || !chatId || !userId) return;
    const engine = networkService.getFileTransferEngine();
    if (!engine) return;
    setUploading(true);
    try {
      await engine.sendFile({
        file,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        chatId,
        sender: auth.user,
        recipientUserId: userId as UserId,
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

  return (
    <div className="messenger-shell">
      <AppSidebar />

      <div className="chat-list-panel">
        <div className="chat-list-header">
          <h2 style={{ margin: 0 }}>{t("nav.chats")}</h2>
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
              const other = orgUsers.find((u) => u.id === c.otherUserId);
              const isFile = c.lastMessageType === "file";
              const body = c.lastMessageText
                ? isFile
                  ? `📎 ${c.lastMessageText}`
                  : c.lastMessageText
                : "Нет сообщений";
              const preview =
                c.lastMessageText && c.lastMessageSenderUserId === auth.user.id ? `Вы: ${body}` : body;
              return (
                <li
                  key={c.chatId}
                  className={`chat-list-item${c.otherUserId === userId ? " active" : ""}`}
                  onClick={() => navigate(`/chat/${c.otherUserId}`)}
                >
                  <Avatar
                    id={c.otherUserId}
                    name={other?.displayName ?? c.otherUserId}
                    online={other?.presence === "online"}
                  />
                  <div className="chat-list-item-body">
                    <div className="chat-list-item-top">
                      <span className="chat-list-name">{other?.displayName ?? c.otherUserId}</span>
                      <span className="chat-list-time">{formatListTime(c.updatedAt)}</span>
                    </div>
                    <div className="chat-list-preview-row">
                      <div className="chat-list-preview">{preview}</div>
                      {c.otherUserId !== userId && c.unreadCount > 0 && (
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
        {!peer || !chatId ? (
          <div className="conversation-empty">
            Выберите чат слева, чтобы начать общение,
            <br />
            либо откройте «Контакты», чтобы написать новому человеку.
          </div>
        ) : (
          <>
            <div className="conversation-header">
              <Avatar id={peer.id} name={peer.displayName} online={peer.presence === "online"} />
              <div>
                <div className="conversation-header-name">{peer.displayName}</div>
                <div className="conversation-header-status">{formatPresence(peer)}</div>
              </div>
            </div>
            <div className="messages-area">
              {messages.map((m) => {
                const own = m.senderUserId === auth.user.id;
                const transfer =
                  m.contentType === "file" ? transfers.find((tr) => tr.messageId === m.id) ?? null : null;
                return (
                  <div key={m.id} className={`msg-row${own ? " own" : ""}`}>
                    <div className="msg-bubble">
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
                disabled={uploading}
              />
              <button
                type="button"
                className="secondary composer-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Прикрепить файл"
              >
                📎
              </button>
              <textarea
                ref={composerRef}
                className="composer-input"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends the message; Shift+Enter inserts a newline —
                  // same convention as Telegram/Slack/etc.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend(e);
                  }
                }}
                placeholder={uploading ? "Отправка файла…" : "Сообщение…"}
                disabled={uploading}
              />
              <button type="submit" className="composer-send" disabled={!text.trim() || uploading}>
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
    </div>
  );
}
