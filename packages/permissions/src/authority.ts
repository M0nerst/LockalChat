import { verifyPayload, signPayload } from "@lockal/crypto";
import type { PermissionAction } from "./actions.js";

export type AdminOperationType =
  | "user.create"
  | "user.delete"
  | "user.block"
  | "user.unblock"
  | "user.change_role"
  | "device.revoke"
  | "policy.update";

export interface SignedAdminOperation {
  type: AdminOperationType;
  organizationId: string;
  targetId: string;
  payload: Record<string, unknown>;
  issuedAt: string;
  nonce: string;
  signature: string;
}

export interface AdminAuthorityPublic {
  organizationId: string;
  publicKey: string;
}

export async function signAdminOperation(
  orgPrivateKey: string,
  op: Omit<SignedAdminOperation, "signature">,
): Promise<SignedAdminOperation> {
  const body = {
    type: op.type,
    organizationId: op.organizationId,
    targetId: op.targetId,
    payload: op.payload,
    issuedAt: op.issuedAt,
    nonce: op.nonce,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const signature = await signPayload(orgPrivateKey, bytes);
  return { ...op, signature };
}

export async function verifyAdminOperation(
  authority: AdminAuthorityPublic,
  op: SignedAdminOperation,
): Promise<boolean> {
  const body = {
    type: op.type,
    organizationId: op.organizationId,
    targetId: op.targetId,
    payload: op.payload,
    issuedAt: op.issuedAt,
    nonce: op.nonce,
  };
  if (body.organizationId !== authority.organizationId) return false;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return verifyPayload(authority.publicKey, bytes, op.signature);
}

/** Maps admin crypto operations to RBAC actions for local enforcement */
export function adminOperationToPermission(type: AdminOperationType): PermissionAction | null {
  const map: Record<AdminOperationType, PermissionAction> = {
    "user.create": "user:create" as PermissionAction,
    "user.delete": "user:delete" as PermissionAction,
    "user.block": "user:block" as PermissionAction,
    "user.unblock": "user:unblock" as PermissionAction,
    "user.change_role": "user:change_role" as PermissionAction,
    "device.revoke": "device:revoke" as PermissionAction,
    "policy.update": "policy:update" as PermissionAction,
  };
  return map[type] ?? null;
}
