import { getDatabase } from "../database";
import type { AccountStatus, User, UserRole } from "../entity";

export interface UserFilters { role?: UserRole; status?: AccountStatus; facilityId?: string }
type StoredUser = User & { passwordHash: string };
const users = async () => (await getDatabase()).collection<StoredUser>("users");
const publicUser = ({ passwordHash: _secret, ...user }: StoredUser): User => user;

export const userRepository = {
  async list(filters: UserFilters = {}): Promise<User[]> {
    const query: Record<string, unknown> = {};
    if (filters.role) query.role = filters.role;
    if (filters.status) query.status = filters.status;
    if (filters.facilityId) query.facilityIds = filters.facilityId;
    return (await (await users()).find(query, { projection: { _id: 0, passwordHash: 0 } }).sort({ createdAt: 1, id: 1 }).toArray()) as User[];
  },
  async findById(id: string): Promise<User | null> { const u = await (await users()).findOne({ id }, { projection: { _id: 0, passwordHash: 0 } }); return u as User | null; },
  async findForAuthentication(email: string): Promise<(User & { passwordHash: string }) | null> { return await (await users()).findOne({ email }, { projection: { _id: 0 } }); },
  async countByRole(role: UserRole): Promise<number> { return (await users()).countDocuments({ role }); },
  async countActiveByRole(role: UserRole): Promise<number> { return (await users()).countDocuments({ role, status: "active" }); },
  async createBootstrapFinance(user: User, passwordHash: string): Promise<User> {
    const collection = await users();
    if (await collection.countDocuments({ role: "finance" })) throw new Error("Bootstrap finance account already exists.");
    await collection.insertOne({ ...user, passwordHash }); return user;
  },
  async create(user: User, passwordHash: string): Promise<User> { await (await users()).insertOne({ ...user, passwordHash }); return user; },
  async setStatus(id: string, status: AccountStatus, updatedAt: string): Promise<User | null> {
    const db = await getDatabase();
    const result = await db.collection<StoredUser>("users").findOneAndUpdate({ id }, { $set: { status, updatedAt } }, { returnDocument: "after", projection: { _id: 0, passwordHash: 0 } });
    if (!result) return null;
    if (status === "inactive") await db.collection("sessions").updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: updatedAt } });
    return result as User;
  },
  async setFacilities(id: string, facilityIds: string[], updatedAt: string): Promise<User | null> {
    const result = await (await users()).findOneAndUpdate({ id }, { $set: { facilityIds, updatedAt } }, { returnDocument: "after", projection: { _id: 0, passwordHash: 0 } });
    return result as User | null;
  },
};
