import { randomUUID } from "node:crypto";
import type { EmrRecord, EmrReviewStatus, EmrSubmissionInput, User } from "../entity";
import { assertFacilityAccess, assertRecordAccess, requireRole } from "../auth/authorization";
import { AppError } from "../errors";
import { emrRepository } from "../repository/emrRepository";

export interface EmrListFilters {
  facilityId?: string;
  cashierId?: string;
  date?: string;
  remark?: string;
}

function todayInLagos(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateSubmission(input: EmrSubmissionInput): void {
  if (!isValidDate(input.date) || input.date > todayInLagos()) throw new AppError(400, "Select a valid date that is not in the future.");
  const counts = [input.emrTransactions, input.tapTransactions];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new AppError(400, "Transaction counts must be whole numbers of zero or more.");
  }
  const amounts = [input.emrAmount, input.tapAmount];
  if (amounts.some((value) => !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) {
    throw new AppError(400, "Amounts must be non-negative with no more than two decimal places.");
  }
}

function createRecord(actor: User, input: EmrSubmissionInput, facilityId: string, existing?: EmrRecord): EmrRecord {
  const now = new Date().toISOString();
  const match = input.emrTransactions === input.tapTransactions && Math.round(input.emrAmount * 100) === Math.round(input.tapAmount * 100);
  return {
    id: existing?.id ?? randomUUID(),
    facilityId,
    cashierId: actor.id,
    date: input.date,
    emr: { numberOfTransactions: input.emrTransactions, amountForDay: input.emrAmount },
    tap: { numberOfTransactions: input.tapTransactions, amountForDay: input.tapAmount },
    cashierRemark: match ? "Good" : "Check Record",
    facilityManagerReview: { status: "Pending", reviewedBy: null, reviewedAt: null },
    financeReview: { status: "Pending", reviewedBy: null, reviewedAt: null },
    resolution: existing?.resolution ?? "",
    resolutionBy: existing?.resolutionBy ?? null,
    resolutionAt: existing?.resolutionAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function canCashierEdit(record: EmrRecord): boolean {
  if (record.financeReview.status === "Not Confirmed") return true;
  return record.facilityManagerReview.status !== "Confirmed";
}

function tally(record: EmrRecord): boolean {
  return record.emr.numberOfTransactions === record.tap.numberOfTransactions &&
    Math.round(record.emr.amountForDay * 100) === Math.round(record.tap.amountForDay * 100);
}

export async function listEmrRecords(actor: User, filters: EmrListFilters = {}): Promise<EmrRecord[]> {
  let facilityIds = actor.facilityIds;
  if (filters.facilityId) {
    assertFacilityAccess(actor, filters.facilityId);
    facilityIds = [filters.facilityId];
  }
  if (actor.role === "cashier" && filters.cashierId && filters.cashierId !== actor.id) {
    throw new AppError(403, "You can only access your own EMR records.");
  }
  if (filters.date && !isValidDate(filters.date)) throw new AppError(400, "Enter a valid date filter.");
  if (filters.remark && filters.remark !== "Good" && filters.remark !== "Check Record") throw new AppError(400, "Invalid EMR remark filter.");
  return await emrRepository.list({
    facilityIds,
    cashierId: actor.role === "cashier" ? actor.id : filters.cashierId,
    date: filters.date,
    remark: filters.remark as EmrRecord["cashierRemark"] | undefined,
  });
}

export async function getEmrRecord(actor: User, id: string): Promise<EmrRecord> {
  const record = await emrRepository.findById(id);
  if (!record) throw new AppError(404, "EMR record not found.");
  assertRecordAccess(actor, { cashierId: record.cashierId, facilityId: record.facilityId });
  return record;
}

export async function submitEmrRecord(actor: User, input: EmrSubmissionInput, recordId?: string): Promise<EmrRecord> {
  requireRole(actor, ["cashier"]);
  validateSubmission(input);
  if (input.facilityId) assertFacilityAccess(actor, input.facilityId);

    const existing = recordId ? await emrRepository.findById(recordId) : null;
    if (recordId && !existing) throw new AppError(404, "EMR record not found.");
    if (existing) {
      assertRecordAccess(actor, { cashierId: existing.cashierId, facilityId: existing.facilityId });
      if (!canCashierEdit(existing)) throw new AppError(409, "This EMR record is locked after Facility Manager confirmation.");
      if (existing.date !== input.date) throw new AppError(400, "An existing record's date cannot be changed.");
    } else if (await emrRepository.findByCashierAndDate(actor.id, input.date)) {
      throw new AppError(409, "An EMR record already exists for this cashier and date.");
    }

    const facilityId = input.facilityId ?? existing?.facilityId ?? (actor.facilityIds.length === 1 ? actor.facilityIds[0] : undefined);
    if (!facilityId) throw new AppError(400, "Select one of your assigned facilities.");
    assertFacilityAccess(actor, facilityId);
    if (existing && existing.facilityId !== facilityId) throw new AppError(400, "An existing record's facility cannot be changed.");
    const record = createRecord(actor, input, existing?.facilityId ?? facilityId, existing ?? undefined);
    if (existing) await emrRepository.updateFigures(record, actor.id);
    else await emrRepository.insert(record, actor.id);
    const saved = await emrRepository.findById(record.id);
    if (!saved) throw new Error("EMR record could not be read after saving.");
    return saved;
}

export async function reviewEmrRecord(actor: User, id: string, status: unknown, commentValue?: unknown): Promise<EmrRecord> {
  if (status !== "Confirmed" && status !== "Not Confirmed") throw new AppError(400, "Select a valid review decision.");
  if (commentValue !== undefined && typeof commentValue !== "string") throw new AppError(400, "Review comment must be text.");
  const comment = typeof commentValue === "string" ? commentValue.trim() : "";
  if (comment.length > 2000) throw new AppError(400, "Review comment cannot exceed 2000 characters.");

    const record = await emrRepository.findById(id);
    if (!record) throw new AppError(404, "EMR record not found.");
    assertRecordAccess(actor, { cashierId: record.cashierId, facilityId: record.facilityId });
    if (actor.role === "cashier") throw new AppError(403, "Cashiers cannot review EMR records.");
    if (status === "Confirmed" && !tally(record)) throw new AppError(409, "EMR and TAP totals must tally before confirmation.");

    const now = new Date().toISOString();
    if (actor.role === "facility_manager") {
      if (record.financeReview.status !== "Pending") throw new AppError(409, "Finance has reviewed this record; it must be resubmitted before another Manager review.");
      await emrRepository.reviewAsManager(record, actor.id, status, comment, now);
    } else {
      if (actor.role !== "finance") throw new AppError(403, "Your role cannot review EMR records.");
      if (comment) throw new AppError(400, "Only a Facility Manager may add a review comment.");
      if (record.facilityManagerReview.status === "Pending") throw new AppError(409, "The Facility Manager must review this record first.");
      if (status === "Confirmed" && record.facilityManagerReview.status !== "Confirmed") throw new AppError(409, "Facility Manager confirmation is required first.");
      await emrRepository.reviewAsFinance(record, actor.id, status, now);
    }
    const saved = await emrRepository.findById(id);
    if (!saved) throw new Error("EMR record could not be read after review.");
    return saved;
}

export async function saveEmrResolution(actor: User, id: string, value: unknown): Promise<EmrRecord> {
  requireRole(actor, ["finance"]);
  if (typeof value !== "string") throw new AppError(400, "Resolution text is required.");
  const resolution = value.trim();
  if (!resolution || resolution.length > 4000) throw new AppError(400, "Resolution must contain 1 to 4000 characters.");
    const record = await emrRepository.findById(id);
    if (!record) throw new AppError(404, "EMR record not found.");
    assertRecordAccess(actor, { cashierId: record.cashierId, facilityId: record.facilityId });
    const now = new Date().toISOString();
    await emrRepository.saveResolution(record, actor.id, resolution, now);
    const saved = await emrRepository.findById(id);
    if (!saved) throw new Error("EMR record could not be read after resolution.");
    return saved;
}
