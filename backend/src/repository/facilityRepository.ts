import { getDatabase } from "../database";
import type { Facility } from "../entity";

export const facilityRepository = {
  async list(): Promise<Facility[]> { return (await getDatabase()).collection<Facility>("facilities").find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray(); },
  async findByIds(ids: string[]): Promise<Facility[]> { if (!ids.length) return []; return (await getDatabase()).collection<Facility>("facilities").find({ id: { $in: ids } }, { projection: { _id: 0 } }).toArray(); },
  async create(facility: Facility): Promise<Facility> { await (await getDatabase()).collection<Facility>("facilities").insertOne(facility); return facility; },
};
