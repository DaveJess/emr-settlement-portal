export type UserRole =
  | "finance"
  | "facility_manager"
  | "cashier";

export type AccountStatus = "active" | "inactive";

export interface Hospital {
  id: string;
  name: string;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  hospitalIds: string[];
  supervisedByFinanceIds?: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type ReviewStatus =
  | "Pending"
  | "Confirmed"
  | "Not Confirmed";

export interface Review {
  status: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment?: string;
}

export type CashierEmrRemark = "Good" | "Check Record";

export interface EmrValues {
  numberOfTransactions: number;
  amountForDay: number;
}

export interface EmrRecord {
  id: string;
  hospitalId: string;
  cashierId: string;
  date: string;
  emr: EmrValues;
  tap: EmrValues;

  // Automatically calculated; not selected by the cashier.
  cashierRemark: CashierEmrRemark;

  facilityManagerReview: Review;
  financeReview: Review;

  resolution: string;
  resolutionBy: string | null;
  resolutionAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface TopUp {
  id: string;
  hospitalId: string;
  cashierId: string;
  date: string;
  amount: number;
  issuedBy: string;
  issuedAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export type DailyAccountStatus = "Draft" | "Submitted";

export type WalletReviewRemark =
  | "Pending"
  | "Okay"
  | "Check Record";

export interface WalletReview {
  remark: WalletReviewRemark;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment?: string;
}

export interface CashReceipt {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface DailyAccount {
  id: string;
  hospitalId: string;
  cashierId: string;
  date: string;
  openingBalance: number;
  bankTransfers: number;
  cashCollected: number;
  cardPayments: number;
  actualClosingBalance: number | null;
  status: DailyAccountStatus;
  submittedAt: string | null;
  facilityManagerReview: WalletReview;
  financeReview: WalletReview;
  cashReceipt: CashReceipt;
  createdAt: string;
  updatedAt: string;
}

export interface WalletSummary {
  openingBalance: number;
  totalTopUps: number;
  totalAvailable: number;
  bankTransfers: number;
  cashCollected: number;
  cardPayments: number;
  totalSpent: number;
  expectedClosingBalance: number;
  actualClosingBalance: number | null;
  variance: number | null;
  tallies: boolean | null;
}

export interface ActivityLog {
  id: string;
  actorId: string;
  hospitalId: string;
  action: string;
  entityType: "user" | "emr" | "top_up" | "daily_account";
  entityId: string;
  createdAt: string;
}

export interface AppData {
  hospitals: Hospital[];
  users: User[];
  emrRecords: EmrRecord[];
  topUps: TopUp[];
  dailyAccounts: DailyAccount[];
  activityLogs: ActivityLog[];
}
