import { getDatabase } from "../database";
import { userRepository } from "./userRepository";
import type { User } from "../entity";

export interface SessionRecord { tokenHash: string; userId: string; createdAt: string; expiresAt: string; revokedAt: string | null }
export const sessionRepository = {
  async create(session: SessionRecord): Promise<void> {
    await (await getDatabase()).collection("sessions").insertOne({ ...session, expiresAtDate: new Date(session.expiresAt) });
  },
  async findActive(tokenHash: string, now: string): Promise<User | null> {
    const session = await (await getDatabase()).collection<SessionRecord>("sessions").findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: now } });
    if (!session) return null;
    const user = await userRepository.findById(session.userId);
    return user?.status === "active" ? user : null;
  },
  async revoke(tokenHash: string, now: string): Promise<void> { await (await getDatabase()).collection("sessions").updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: now } }); },
};
