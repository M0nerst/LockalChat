export interface ChatMessagePayload {
  messageId: string;
  chatId: string;
  senderUserId: string;
  content: string;
  contentType: "text";
  clientNonce: string;
  sentAt: string;
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
