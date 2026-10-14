import { randomUUID } from "node:crypto";
import type { AccountStatus, CreateCashierInput, CreateFacilityInput, CreateUserInput, Facility, User } from "../entity";
import { USER_ROLES } from "../entity";
import { hashPassword, validatePassword } from "../auth/password";
import { facilityRepository } from "../repository/facilityRepository";
import { userRepository } from "../repository/userRepository";
import { assertFacilityAccess, assertUserAccess, assertUserManagementScope, requireRole, scopeUserToActor } from "../auth/authorization";
import { AppError, isConflictError } from "../errors";

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new AppError(400, `${label} is required.`);
  const result = value.trim();
  if (!result || result.length > max) throw new AppError(400, `${label} must be between 1 and ${max} characters.`);
  return result;
}

async function validateFacilityIds(value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 || value.some((id) => typeof id !== "string" || id.length > 64)) {
    throw new AppError(400, "Assign the user to between 1 and 100 facilities.");
  }
  const ids = [...new Set(value as string[])];
  if (ids.length !== value.length) throw new AppError(400, "Facility assignments must not contain duplicates.");
  if ((await facilityRepository.findByIds(ids)).length !== ids.length) throw new AppError(400, "One or more assigned facilities do not exist.");
  return ids;
}

export async function listFacilities(): Promise<Facility[]> { return facilityRepository.list(); }

export async function listFacilitiesForActor(actor: User): Promise<Facility[]> {
  return facilityRepository.findByIds(actor.facilityIds);
}

export async function createFacility(input: CreateFacilityInput): Promise<Facility> {
  const name = requiredText(input.name, "Facility name", 120);
  try {
    return await facilityRepository.create({ id: randomUUID(), name, createdAt: new Date().toISOString() });
  } catch (error) {
    if (isConstraintError(error)) throw new AppError(409, "A facility with that name already exists.");
    throw error;
  }
}

async function prepareUser(input: CreateUserInput): Promise<{ user: User; passwordHash: string }> {
  const name = requiredText(input.name, "Name", 120);
  const phone = requiredText(input.phone, "Phone", 32);
  const email = requiredText(input.email, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "Enter a valid email address.");
  if (typeof input.role !== "string" || !USER_ROLES.includes(input.role)) throw new AppError(400, "Select a valid role.");
  if (typeof input.password !== "string") throw new AppError(400, "Password is required.");
  try { validatePassword(input.password); } catch (error) { throw new AppError(400, (error as Error).message); }
  const facilityIds = await validateFacilityIds(input.facilityIds);
  const now = new Date().toISOString();
  const user: User = {
    id: randomUUID(), name, phone, email, role: input.role, status: "active",
    facilityIds, createdAt: now, updatedAt: now,
  };
  return { user, passwordHash: await hashPassword(input.password) };
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const prepared = await prepareUser(input);
  try {
    return await userRepository.create(prepared.user, prepared.passwordHash);
  } catch (error) {
    if (isConstraintError(error)) throw new AppError(409, "A user with that email address already exists.");
    throw error;
  }
}

export async function createCashier(actor: User, input: CreateCashierInput): Promise<User> {
  const cashierInput: CreateUserInput = { ...input, role: "cashier" };
  authorizeUserCreation(actor, cashierInput);
  return createUser(cashierInput);
}

export async function createBootstrapFinanceUser(input: CreateUserInput): Promise<User> {
  if (input.role !== "finance") throw new AppError(400, "Bootstrap can only create a Finance user.");
  const prepared = await prepareUser(input);
  try {
    return await userRepository.createBootstrapFinance(prepared.user, prepared.passwordHash);
  } catch (error) {
    if (error instanceof Error && error.message === "Bootstrap finance account already exists.") throw new AppError(409, error.message);
    if (isConstraintError(error)) throw new AppError(409, "A user with that email address already exists.");
    throw error;
  }
}

export async function listUsers(filters: { role?: string; status?: string; facilityId?: string }): Promise<User[]> {
  if (filters.role && !USER_ROLES.includes(filters.role as (typeof USER_ROLES)[number])) throw new AppError(400, "Invalid role filter.");
  if (filters.status && filters.status !== "active" && filters.status !== "inactive") throw new AppError(400, "Invalid status filter.");
  if (filters.facilityId && !(await facilityRepository.findByIds([filters.facilityId])).length) throw new AppError(404, "Facility not found.");
  return userRepository.list({ role: filters.role as User["role"] | undefined, status: filters.status as AccountStatus | undefined, facilityId: filters.facilityId });
}

export async function listUsersForActor(actor: User, filters: { role?: string; status?: string; facilityId?: string }): Promise<User[]> {
  validateUserFilters(filters);
  if (filters.facilityId) assertFacilityAccess(actor, filters.facilityId);
  if (actor.role === "cashier") {
    const self = await userRepository.findById(actor.id);
    return self && (!filters.role || self.role === filters.role) && (!filters.status || self.status === filters.status)
      ? [scopeUserToActor(actor, self)] : [];
  }
  const facilityIds = filters.facilityId ? [filters.facilityId] : actor.facilityIds;
  const usersById = new Map<string, User>();
  for (const facilityId of facilityIds) {
    for (const user of await userRepository.list({ facilityId })) usersById.set(user.id, user);
  }
  return [...usersById.values()]
    .filter((user) => (!filters.role || user.role === filters.role) && (!filters.status || user.status === filters.status))
    .map((user) => scopeUserToActor(actor, user));
}

function validateUserFilters(filters: { role?: string; status?: string }): void {
  if (filters.role && !USER_ROLES.includes(filters.role as (typeof USER_ROLES)[number])) throw new AppError(400, "Invalid role filter.");
  if (filters.status && filters.status !== "active" && filters.status !== "inactive") throw new AppError(400, "Invalid status filter.");
}

export async function authorizeUserRead(actor: User, targetId: string): Promise<User> {
  const target = await userRepository.findById(targetId);
  if (!target) throw new AppError(404, "User not found.");
  assertUserAccess(actor, target);
  return scopeUserToActor(actor, target);
}

export function authorizeUserCreation(actor: User, input: CreateUserInput): void {
  requireRole(actor, ["finance"]);
  if (!Array.isArray(input.facilityIds)) throw new AppError(400, "Facility assignments are required.");
  for (const facilityId of input.facilityIds) {
    if (typeof facilityId !== "string") throw new AppError(400, "Invalid facility assignment.");
    assertFacilityAccess(actor, facilityId);
  }
}

export async function updateUserStatus(id: string, status: unknown): Promise<User> {
  if (status !== "active" && status !== "inactive") throw new AppError(400, "Status must be active or inactive.");
  const existing = await userRepository.findById(id);
  if (!existing) throw new AppError(404, "User not found.");
  if (existing.role === "finance" && existing.status === "active" && status === "inactive" && await userRepository.countActiveByRole("finance") <= 1) {
    throw new AppError(409, "The last active Finance account cannot be deactivated.");
  }
  const user = await userRepository.setStatus(id, status, new Date().toISOString());
  if (!user) throw new AppError(404, "User not found.");
  return user;
}

export async function authorizeUserManagement(actor: User, targetId: string): Promise<void> {
  const target = await userRepository.findById(targetId);
  if (!target) throw new AppError(404, "User not found.");
  assertUserManagementScope(actor, target);
}

export async function authorizeFacilityAssignments(actor: User, value: unknown): Promise<void> {
  requireRole(actor, ["finance"]);
  if (!Array.isArray(value)) throw new AppError(400, "Facility assignments must be an array.");
  for (const facilityId of value) {
    if (typeof facilityId !== "string") throw new AppError(400, "Invalid facility assignment.");
    assertFacilityAccess(actor, facilityId);
  }
}

export async function updateUserFacilities(id: string, value: unknown): Promise<User> {
  const facilityIds = await validateFacilityIds(value);
  const user = await userRepository.setFacilities(id, facilityIds, new Date().toISOString());
  if (!user) throw new AppError(404, "User not found.");
  return user;
}

function isConstraintError(error: unknown): boolean {
  return isConflictError(error);
}
