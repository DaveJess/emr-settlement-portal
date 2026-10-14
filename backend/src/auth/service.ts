import { createHash, randomBytes } from "node:crypto";
import type { CreateUserInput, User } from "../entity";
import { hashPassword, verifyPassword } from "./password";
import { sessionRepository } from "../repository/sessionRepository";
import { userRepository } from "../repository/userRepository";
import { AppError } from "../errors";
import { createBootstrapFinanceUser } from "../users/service";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = hashPassword("not-a-real-user-password");

export interface AuthSession {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: User;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function signIn(emailInput: unknown, passwordInput: unknown): Promise<AuthSession> {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (!email || email.length > 254 || !password || password.length > 128) {
    // Still perform a password derivation for malformed or unknown accounts.
    await verifyPassword("invalid", await DUMMY_PASSWORD_HASH);
    throw new AppError(401, "Email or password is incorrect.");
  }

  const candidate = await userRepository.findForAuthentication(email);
  const passwordHash = candidate?.passwordHash ?? await DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(password, passwordHash);
  if (!candidate || !passwordMatches || candidate.status !== "active") {
    throw new AppError(401, "Email or password is incorrect.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
  const accessToken = randomBytes(32).toString("base64url");
  await sessionRepository.create({
    tokenHash: hashToken(accessToken),
    userId: candidate.id,
    createdAt: now.toISOString(),
    expiresAt,
    revokedAt: null,
  });
  const { passwordHash: _passwordHash, ...user } = candidate;
  return { accessToken, tokenType: "Bearer", expiresAt, user };
}

export async function authenticateToken(token: string): Promise<{ user: User; tokenHash: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const user = await sessionRepository.findActive(tokenHash, new Date().toISOString());
  return user ? { user, tokenHash } : null;
}

export async function signOut(tokenHash: string): Promise<void> {
  await sessionRepository.revoke(tokenHash, new Date().toISOString());
}

export async function bootstrapFinance(input: CreateUserInput): Promise<User> {
  if (input.role !== "finance") throw new AppError(400, "Bootstrap can only create the first Finance user.");
  if (await userRepository.countByRole("finance") > 0) throw new AppError(409, "Finance bootstrap is already complete.");
  // The repository rechecks bootstrap eligibility immediately before inserting.
  return await createBootstrapFinanceUser(input);
}

export async function bootstrapStatus(): Promise<{ financeAccountRequired: boolean }> {
  return { financeAccountRequired: (await userRepository.countByRole("finance")) === 0 };
}

