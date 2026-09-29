export interface ChatMessagePayload {
  messageId: string;
  chatId: string;
  senderUserId: string;
  content: string;
  contentType: "text";
  clientNonce: string;
  sentAt: string;
  /** Present on group messages so a peer who missed `chat.group` can still create the chat. */
  group?: {
    title: string;
    memberUserIds: string[];
    rosterRevision?: number;
  };
}

export interface GroupChatPayload {
  chatId: string;
  title: string;
  memberUserIds: string[];
  createdAt: string;
  rosterRevision?: number;
}

export interface ChatAckPayload {
  messageId: string;
  chatId: string;
  status: "delivered" | "read";
  at: string;
}

export interface DirectoryUserSnapshot {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  passwordHash: string;
  avatarUrl?: string | null;
  updatedAt: string;
}

export interface DirectoryDeviceSnapshot {
  id: string;
  userId: string;
  name: string;
  platform: string;
  appVersion: string;
  publicKey: string;
  fingerprint: string;
  trustStatus: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DirectorySnapshotPayload {
  organizationId: string;
  users: DirectoryUserSnapshot[];
  devices?: DirectoryDeviceSnapshot[];
  issuedAt: string;
}
