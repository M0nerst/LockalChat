export class LockalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = "LockalError";
  }
}

export class AuthError extends LockalError {
  constructor(code: string, userMessage: string) {
    super(`Auth: ${code}`, code, userMessage);
    this.name = "AuthError";
  }
}

export class PermissionError extends LockalError {
  constructor(action: string) {
    super(`Permission denied: ${action}`, "PERMISSION_DENIED", "Недостаточно прав для этого действия");
    this.name = "PermissionError";
  }
}
