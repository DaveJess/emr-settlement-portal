import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { CreateCashierInput, CreateFacilityInput, CreateUserInput, EmrSubmissionInput } from "../entity";
import { AppError, isConflictError } from "../errors";
import {
  authorizeFacilityAssignments,
  authorizeUserCreation,
  authorizeUserManagement,
  authorizeUserRead,
  createCashier,
  createFacility,
  createUser,
  listFacilitiesForActor,
  listUsersForActor,
  updateUserFacilities,
  updateUserStatus,
} from "../users/service";
import { authenticateToken, bootstrapFinance, bootstrapStatus, signIn, signOut } from "../auth/service";
import { requireRole } from "../auth/authorization";
import { getEmrRecord, listEmrRecords, reviewEmrRecord, saveEmrResolution, submitEmrRecord } from "../emr/service";

const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new AppError(415, "Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "Request body must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new AppError(400, "Request contains unsupported fields.");
}

function bearerToken(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  return token.length > 0 && !token.includes(" ") ? token : null;
}

function isAdminRequest(request: http.IncomingMessage, expected: string): boolean {
  const token = bearerToken(request);
  if (!token) return false;
  const provided = Buffer.from(token);
  const secret = Buffer.from(expected);
  return provided.length === secret.length && timingSafeEqual(provided, secret);
}

function enforceLoginRateLimit(key: string): void {
  const now = Date.now();
  const current = failedLoginAttempts.get(key);
  if (current && current.resetAt > now && current.count >= MAX_FAILED_LOGINS) {
    throw new AppError(429, "Too many sign-in attempts. Try again later.");
  }
  if (!current || current.resetAt <= now) failedLoginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
}

function recordFailedLogin(key: string): void {
  const now = Date.now();
  const current = failedLoginAttempts.get(key);
  if (!current || current.resetAt <= now) failedLoginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else current.count += 1;
  if (failedLoginAttempts.size > 10_000) {
    for (const [address, entry] of failedLoginAttempts) if (entry.resetAt <= now) failedLoginAttempts.delete(address);
  }
}

function clearFailedLogins(key: string): void { failedLoginAttempts.delete(key); }

export function createServer(): http.Server {
  const adminToken = process.env.API_ADMIN_TOKEN;
  if (!adminToken || Buffer.byteLength(adminToken) < 32) {
    throw new Error("Set API_ADMIN_TOKEN to a random secret of at least 32 bytes for bootstrap and facility provisioning.");
  }

  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(request); exactKeys(body, ["email", "password"]);
        const remoteAddress = request.socket.remoteAddress ?? "unknown";
        enforceLoginRateLimit(remoteAddress);
        try {
          const session = await signIn(body.email, body.password);
          clearFailedLogins(remoteAddress);
          sendJson(response, 200, { data: session });
        } catch (error) {
          if (error instanceof AppError && error.statusCode === 401) recordFailedLogin(remoteAddress);
          throw error;
        }
        return;
      }

      // The bootstrap credential is limited to initial Finance setup and facility provisioning.
      if (request.method === "GET" && url.pathname === "/api/bootstrap/status") {
        if (!isAdminRequest(request, adminToken)) throw new AppError(401, "Unauthorized.");
        sendJson(response, 200, { data: await bootstrapStatus() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/bootstrap/finance") {
        if (!isAdminRequest(request, adminToken)) throw new AppError(401, "Unauthorized.");
        const body = await readJson(request);
        exactKeys(body, ["name", "phone", "email", "password", "role", "facilityIds"]);
        sendJson(response, 201, { data: await bootstrapFinance(body as unknown as CreateUserInput) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/facilities") {
        if (!isAdminRequest(request, adminToken)) throw new AppError(401, "Unauthorized.");
        const body = await readJson(request); exactKeys(body, ["name"]);
        sendJson(response, 201, { data: await createFacility(body as unknown as CreateFacilityInput) });
        return;
      }

      const token = bearerToken(request);
      const session = token ? await authenticateToken(token) : null;
      if (!session) throw new AppError(401, "A valid sign-in session is required.");
      const actor = session.user;

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        sendJson(response, 200, { data: { user: actor } });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        await signOut(session.tokenHash);
        sendJson(response, 200, { data: { signedOut: true } });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/facilities") {
        sendJson(response, 200, { data: await listFacilitiesForActor(actor) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/emr") {
        const allowedParams = new Set(["facilityId", "cashierId", "date", "remark"]);
        for (const key of allowedParams) if (url.searchParams.getAll(key).length > 1) throw new AppError(400, `Use only one ${key} filter.`);
        for (const key of url.searchParams.keys()) if (!allowedParams.has(key)) throw new AppError(400, "Unsupported query parameter.");
        sendJson(response, 200, { data: await listEmrRecords(actor, {
          facilityId: url.searchParams.get("facilityId") ?? undefined,
          cashierId: url.searchParams.get("cashierId") ?? undefined,
          date: url.searchParams.get("date") ?? undefined,
          remark: url.searchParams.get("remark") ?? undefined,
        }) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/emr") {
        const body = await readJson(request);
        exactKeys(body, ["date", "facilityId", "emrTransactions", "emrAmount", "tapTransactions", "tapAmount"]);
        sendJson(response, 201, { data: await submitEmrRecord(actor, body as unknown as EmrSubmissionInput) });
        return;
      }
      const emrResolutionMatch = url.pathname.match(/^\/api\/emr\/([0-9a-f-]{36})\/resolution$/i);
      if (request.method === "PUT" && emrResolutionMatch) {
        const body = await readJson(request); exactKeys(body, ["resolution"]);
        sendJson(response, 200, { data: await saveEmrResolution(actor, emrResolutionMatch[1], body.resolution) });
        return;
      }
      const emrReviewMatch = url.pathname.match(/^\/api\/emr\/([0-9a-f-]{36})\/reviews$/i);
      if (request.method === "POST" && emrReviewMatch) {
        const body = await readJson(request); exactKeys(body, ["status", "comment"]);
        sendJson(response, 200, { data: await reviewEmrRecord(actor, emrReviewMatch[1], body.status, body.comment) });
        return;
      }
      const emrMatch = url.pathname.match(/^\/api\/emr\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && emrMatch) {
        sendJson(response, 200, { data: await getEmrRecord(actor, emrMatch[1]) });
        return;
      }
      if (request.method === "PUT" && emrMatch) {
        const body = await readJson(request);
        exactKeys(body, ["date", "facilityId", "emrTransactions", "emrAmount", "tapTransactions", "tapAmount"]);
        sendJson(response, 200, { data: await submitEmrRecord(actor, body as unknown as EmrSubmissionInput, emrMatch[1]) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/users") {
        const allowedParams = new Set(["role", "status", "facilityId"]);
        for (const key of allowedParams) if (url.searchParams.getAll(key).length > 1) throw new AppError(400, `Use only one ${key} filter.`);
        for (const key of url.searchParams.keys()) if (!allowedParams.has(key)) throw new AppError(400, "Unsupported query parameter.");
        const data = await listUsersForActor(actor, {
          role: url.searchParams.get("role") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          facilityId: url.searchParams.get("facilityId") ?? undefined,
        });
        sendJson(response, 200, { data });
        return;
      }
      const userMatch = url.pathname.match(/^\/api\/users\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && userMatch) {
        sendJson(response, 200, { data: await authorizeUserRead(actor, userMatch[1]) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/users") {
        requireRole(actor, ["finance"]);
        const body = await readJson(request); exactKeys(body, ["name", "phone", "email", "password", "role", "facilityIds"]);
        const input = body as unknown as CreateUserInput;
        authorizeUserCreation(actor, input);
        sendJson(response, 201, { data: await createUser(input) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/cashiers") {
        const body = await readJson(request);
        exactKeys(body, ["name", "phone", "email", "password", "facilityIds"]);
        sendJson(response, 201, { data: await createCashier(actor, body as unknown as CreateCashierInput) });
        return;
      }

      const statusMatch = url.pathname.match(/^\/api\/users\/([0-9a-f-]{36})\/status$/i);
      const facilitiesMatch = url.pathname.match(/^\/api\/users\/([0-9a-f-]{36})\/facilities$/i);
      if (request.method === "PATCH" && statusMatch) {
        await authorizeUserManagement(actor, statusMatch[1]);
        const body = await readJson(request); exactKeys(body, ["status"]);
        sendJson(response, 200, { data: await updateUserStatus(statusMatch[1], body.status) });
        return;
      }
      if (request.method === "PUT" && facilitiesMatch) {
        await authorizeUserManagement(actor, facilitiesMatch[1]);
        const body = await readJson(request); exactKeys(body, ["facilityIds"]);
        await authorizeFacilityAssignments(actor, body.facilityIds);
        sendJson(response, 200, { data: await updateUserFacilities(facilitiesMatch[1], body.facilityIds) });
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof AppError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (isConflictError(error)) {
        sendJson(response, 409, { error: "The requested record conflicts with an existing record." });
        return;
      }
      sendJson(response, 500, { error: "Internal server error." });
    }
  });
}
