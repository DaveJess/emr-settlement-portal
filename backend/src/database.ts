import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI to connect to MongoDB.");

const client = new MongoClient(uri);
let connection: Promise<Db> | undefined;

export function getDatabase(): Promise<Db> {
  connection ??= client.connect().then(async () => {
    const db = client.db(process.env.MONGODB_DATABASE || undefined);
    await Promise.all([
      db.collection("facilities").createIndex({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } }),
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("users").createIndex({ facilityIds: 1 }),
      db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 }),
      db.collection("emrRecords").createIndex({ cashierId: 1, date: 1 }, { unique: true }),
      db.collection("emrRecords").createIndex({ facilityId: 1, date: -1 }),
      db.collection("activityLogs").createIndex({ entityId: 1, createdAt: -1 }),
    ]);
    return db;
  });
  return connection;
}

export async function closeDatabase(): Promise<void> {
  if (connection) await client.close();
  connection = undefined;
}
