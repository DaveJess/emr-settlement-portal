import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, {
      N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY,
    }, (error, derived) => error ? reject(error) : resolve(derived as Buffer));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, keyText, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || extra !== undefined || !saltText || !keyText) return false;
  const parameters = [Number(n), Number(r), Number(p)];
  // Bound parameters before computing to prevent a database value from causing resource exhaustion.
  if (parameters[0] !== COST || parameters[1] !== BLOCK_SIZE || parameters[2] !== PARALLELIZATION) return false;

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must be between 12 and 128 characters.");
  }
}
