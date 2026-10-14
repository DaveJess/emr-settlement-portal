import type { AppData } from "../types";

/** Empty local accounting cache; identities and facilities load from the backend. */
export function createDemoData(): AppData {
  return {
    hospitals: [],
    users: [],
    emrRecords: [],
    topUps: [],
    dailyAccounts: [],
    activityLogs: [],
  };
}
