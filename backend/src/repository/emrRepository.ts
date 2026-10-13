import { randomUUID } from "node:crypto";
import { getDatabase } from "../database";
import type { CashierEmrRemark, EmrRecord, EmrReviewStatus } from "../entity";

export interface EmrFilters { facilityIds: string[]; cashierId?: string; date?: string; remark?: CashierEmrRemark }
async function log(actorId: string, record: EmrRecord, action: string, createdAt: string): Promise<void> {
  await (await getDatabase()).collection("activityLogs").insertOne({ id: randomUUID(), actorId, facilityId: record.facilityId, action, entityType: "emr", entityId: record.id, createdAt });
}
export const emrRepository = {
  async list(filters: EmrFilters): Promise<EmrRecord[]> {
    if (!filters.facilityIds.length) return [];
    const query: Record<string, unknown> = { facilityId: { $in: filters.facilityIds } };
    if (filters.cashierId) query.cashierId = filters.cashierId;
    if (filters.date) query.date = filters.date;
    if (filters.remark === "Good") query.$expr = { $and: [{ $eq: ["$emr.numberOfTransactions", "$tap.numberOfTransactions"] }, { $eq: ["$emr.amountForDay", "$tap.amountForDay"] }] };
    if (filters.remark === "Check Record") query.$expr = { $or: [{ $ne: ["$emr.numberOfTransactions", "$tap.numberOfTransactions"] }, { $ne: ["$emr.amountForDay", "$tap.amountForDay"] }] };
    return (await (await getDatabase()).collection<EmrRecord>("emrRecords").find(query, { projection: { _id: 0 } }).sort({ date: -1, createdAt: -1 }).toArray());
  },
  async findById(id: string): Promise<EmrRecord | null> { return (await getDatabase()).collection<EmrRecord>("emrRecords").findOne({ id }, { projection: { _id: 0 } }); },
  async findByCashierAndDate(cashierId: string, date: string): Promise<EmrRecord | null> { return (await getDatabase()).collection<EmrRecord>("emrRecords").findOne({ cashierId, date }, { projection: { _id: 0 } }); },
  async insert(record: EmrRecord, actorId: string): Promise<void> { await (await getDatabase()).collection<EmrRecord>("emrRecords").insertOne(record); await log(actorId, record, "Submitted EMR record.", record.createdAt); },
  async updateFigures(record: EmrRecord, actorId: string): Promise<void> { await (await getDatabase()).collection<EmrRecord>("emrRecords").replaceOne({ id: record.id }, record); await log(actorId, record, "Corrected and resubmitted EMR record; reviews reset.", record.updatedAt); },
  async reviewAsManager(record: EmrRecord, actorId: string, status: Exclude<EmrReviewStatus, "Pending">, comment: string, now: string): Promise<void> {
    await (await getDatabase()).collection<EmrRecord>("emrRecords").updateOne({ id: record.id }, { $set: { "facilityManagerReview.status": status, "facilityManagerReview.reviewedBy": actorId, "facilityManagerReview.reviewedAt": now, "facilityManagerReview.comment": comment || undefined, updatedAt: now } });
    await log(actorId, record, `Facility Manager marked EMR record ${status}.`, now);
  },
  async reviewAsFinance(record: EmrRecord, actorId: string, status: Exclude<EmrReviewStatus, "Pending">, now: string): Promise<void> {
    await (await getDatabase()).collection<EmrRecord>("emrRecords").updateOne({ id: record.id }, { $set: { "financeReview.status": status, "financeReview.reviewedBy": actorId, "financeReview.reviewedAt": now, updatedAt: now } });
    await log(actorId, record, `Finance marked EMR record ${status}.`, now);
  },
  async saveResolution(record: EmrRecord, actorId: string, resolution: string, now: string): Promise<void> {
    await (await getDatabase()).collection<EmrRecord>("emrRecords").updateOne({ id: record.id }, { $set: { resolution, resolutionBy: actorId, resolutionAt: now, updatedAt: now } });
    await log(actorId, record, "Saved EMR resolution.", now);
  },
};
