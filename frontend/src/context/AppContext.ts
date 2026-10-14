import { createContext } from "react";
import type { AppData, User } from "../types";

export interface AppContextValue {
  data: AppData;
  currentUser: User | null;
  identityLoading: boolean;

  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  createCashier: (input: { name: string; phone: string; email: string; password: string; facilityIds: string[] }) => Promise<User>;
  setUserStatus: (id: string, status: User["status"]) => Promise<User>;
  setUserFacilities: (id: string, facilityIds: string[]) => Promise<User>;

  updateData: (updater: (current: AppData) => AppData) => void;
}

export const AppContext = createContext<AppContextValue | undefined>(
  undefined,
);
