import { randomBytes } from "./random.js";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export type OrganizationId = string & { readonly __brand: "OrganizationId" };
export type UserId = string & { readonly __brand: "UserId" };
export type DeviceId = string & { readonly __brand: "DeviceId" };
export type ChatId = string & { readonly __brand: "ChatId" };
export type MessageId = string & { readonly __brand: "MessageId" };

export function generateId(prefix: string): string {
  const bytes = randomBytes(16);
  let body = "";
  for (let i = 0; i < bytes.length; i++) {
    body += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return `${prefix}_${body}`;
}

export function organizationId(): OrganizationId {
  return generateId("org") as OrganizationId;
}

export function userId(): UserId {
  return generateId("usr") as UserId;
}

export function deviceId(): DeviceId {
  return generateId("dev") as DeviceId;
}

export function chatId(): ChatId {
  return generateId("cht") as ChatId;
}

export function messageId(): MessageId {
  return generateId("msg") as MessageId;
}
