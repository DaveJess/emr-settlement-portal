export const USER_ROLES = ["cashier", "facility_manager", "finance"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["active", "inactive"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Facility {
  id: string;
  name: string;
  createdAt: string;
}

/** Public representation. Password hashes are deliberately never exposed. */
export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  facilityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFacilityInput {
  name: string;
}

export interface CreateUserInput {
  name: string;
  phone: string;
  email: string;
  password: string;
  role: UserRole;
  facilityIds: string[];
}

export type CreateCashierInput = Omit<CreateUserInput, "role">;

export type EmrReviewStatus = "Pending" | "Confirmed" | "Not Confirmed";
export type CashierEmrRemark = "Good" | "Check Record";

export interface EmrReview {
  status: EmrReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment?: string;
}

export interface EmrValues {
  numberOfTransactions: number;
  amountForDay: number;
}

export interface EmrRecord {
  id: string;
  facilityId: string;
  cashierId: string;
  date: string;
  emr: EmrValues;
  tap: EmrValues;
  cashierRemark: CashierEmrRemark;
  facilityManagerReview: EmrReview;
  financeReview: EmrReview;
  resolution: string;
  resolutionBy: string | null;
  resolutionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmrSubmissionInput {
  date: string;
  facilityId?: string;
  emrTransactions: number;
  emrAmount: number;
  tapTransactions: number;
  tapAmount: number;
}

export interface ActivityLog {
  id: string;
  actorId: string;
  facilityId: string;
  action: string;
  entityType: "emr";
  entityId: string;
  createdAt: string;
}
