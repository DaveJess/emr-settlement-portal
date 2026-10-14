import type { AppData } from "../types";
import { createDemoData } from "../data/demoData";

const DATA_KEY = "lunar_accounting_data_v1";
const SESSION_KEY = "lunar_accounting_session_v1";

function isAppData(value: unknown): value is AppData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<AppData>;

  return (
    Array.isArray(data.hospitals) &&
    Array.isArray(data.users) &&
    Array.isArray(data.emrRecords) &&
    Array.isArray(data.topUps) &&
    Array.isArray(data.dailyAccounts) &&
    Array.isArray(data.activityLogs)
  );
}

export function loadAppData(): AppData {
  const saved = localStorage.getItem(DATA_KEY);

  if (saved !== null) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(saved);
    } catch {
      throw new Error(
        "Saved Lunar data could not be read. It has not been overwritten.",
      );
    }

    if (!isAppData(parsed)) {
      throw new Error(
        "Saved Lunar data has an unexpected format. It has not been overwritten.",
      );
    }

    // Older demo builds stored plaintext passwords. Strip them from the browser cache.
    for (const user of parsed.users) {
      delete (user as typeof user & { password?: string }).password;
    }
    saveAppData(parsed);
    return parsed;
  }

  const initialData = createDemoData();
  saveAppData(initialData);

  return initialData;
}

export function saveAppData(data: AppData): void {
  const safeData = structuredClone(data);
  for (const user of safeData.users) {
    delete (user as typeof user & { password?: string }).password;
  }
  localStorage.setItem(DATA_KEY, JSON.stringify(safeData));
}

export function loadSession(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

export function saveSession(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
