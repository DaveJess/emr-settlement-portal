export class AppError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

export function isConflictError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === 11000) return true;
  return error instanceof Error && /constraint|unique/i.test(error.message);
}
