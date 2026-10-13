import type { User, UserRole } from "../entity";
import { AppError } from "../errors";

export interface RecordScope {
  cashierId: string;
  facilityId: string;
}

export function requireRole(actor: User, allowedRoles: readonly UserRole[]): void {
  if (!allowedRoles.includes(actor.role)) throw new AppError(403, "Your role cannot perform this action.");
}

export function assertFacilityAccess(actor: User, facilityId: string): void {
  if (!actor.facilityIds.includes(facilityId)) throw new AppError(403, "You are not assigned to this facility.");
}

/** Use on every route/service that reads or mutates a cashier-owned record. */
export function assertRecordAccess(actor: User, scope: RecordScope): void {
  if (actor.role === "cashier" && actor.id !== scope.cashierId) {
    throw new AppError(403, "You can only access your own records.");
  }
  assertFacilityAccess(actor, scope.facilityId);
}

export function assertUserAccess(actor: User, target: User): void {
  if (actor.role === "cashier") {
    if (actor.id !== target.id) throw new AppError(403, "You can only access your own account.");
    return;
  }
  if (!target.facilityIds.some((facilityId) => actor.facilityIds.includes(facilityId))) {
    throw new AppError(403, "The user is outside your assigned facilities.");
  }
}

/** Avoid revealing facility assignments outside the requesting actor's scope. */
export function scopeUserToActor(actor: User, target: User): User {
  assertUserAccess(actor, target);
  return { ...target, facilityIds: target.facilityIds.filter((id) => actor.facilityIds.includes(id)) };
}


export function assertUserManagementScope(actor: User, target: User): void {
  requireRole(actor, ["finance"]);
  if (target.facilityIds.length === 0 || target.facilityIds.some((id) => !actor.facilityIds.includes(id))) {
    throw new AppError(403, "The user has facility assignments outside your management scope.");
  }
}
