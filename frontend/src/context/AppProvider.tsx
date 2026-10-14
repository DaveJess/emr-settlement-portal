import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, User } from "../types";
import { AppContext } from "./AppContext";
import { clearSession, loadAppData, loadSession, saveAppData, saveSession } from "../utils/storage";
import * as identityApi from "../api/identity";

interface AppProviderProps { children: ReactNode }

export function AppProvider({ children }: AppProviderProps) {
  const [data, setData] = useState<AppData>(loadAppData);
  const dataRef = useRef(data);
  const [token, setToken] = useState<string | null>(loadSession);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  function applyIdentity(snapshot: identityApi.IdentitySnapshot): void {
    const next = {
      ...dataRef.current,
      users: snapshot.users,
      hospitals: snapshot.facilities.map(({ id, name }) => ({ id, name })),
    };
    dataRef.current = next;
    setData(next);
    setCurrentUser(snapshot.user);
  }

  async function refreshIdentity(authToken = token): Promise<void> {
    if (!authToken) return;
    applyIdentity(await identityApi.loadIdentity(authToken));
  }

  useEffect(() => {
    let active = true;
    const storedToken = loadSession();
    if (!storedToken) {
      setIdentityLoading(false);
      return () => { active = false; };
    }
    void identityApi.loadIdentity(storedToken).then((snapshot) => {
      if (active) {
        setToken(storedToken);
        applyIdentity(snapshot);
      }
    }).catch(() => {
      if (active) {
        clearSession();
        setToken(null);
        setCurrentUser(null);
      }
    }).finally(() => {
      if (active) setIdentityLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function login(email: string, password: string): Promise<User> {
    const session = await identityApi.signIn(email, password);
    saveSession(session.token);
    setToken(session.token);
    try {
      const snapshot = await identityApi.loadIdentity(session.token);
      applyIdentity(snapshot);
      return snapshot.user;
    } catch (error) {
      clearSession();
      setToken(null);
      throw error;
    }
  }

  async function logout(): Promise<void> {
    const activeToken = token;
    clearSession();
    setToken(null);
    setCurrentUser(null);
    if (activeToken) {
      try { await identityApi.signOut(activeToken); } catch { /* local logout remains effective */ }
    }
  }

  async function createCashier(input: { name: string; phone: string; email: string; password: string; facilityIds: string[] }): Promise<User> {
    if (!token) throw new Error("Your session has expired. Sign in again.");
    const user = await identityApi.createCashier(token, input);
    await refreshIdentity();
    return user;
  }

  async function setUserStatus(id: string, status: User["status"]): Promise<User> {
    if (!token) throw new Error("Your session has expired. Sign in again.");
    const user = await identityApi.setUserStatus(token, id, status);
    await refreshIdentity();
    return user;
  }

  async function setUserFacilities(id: string, facilityIds: string[]): Promise<User> {
    if (!token) throw new Error("Your session has expired. Sign in again.");
    const user = await identityApi.setUserFacilities(token, id, facilityIds);
    await refreshIdentity();
    return user;
  }

  function updateData(updater: (current: AppData) => AppData): void {
    const editableCopy = structuredClone(dataRef.current);
    const nextData = updater(editableCopy);
    saveAppData(nextData);
    dataRef.current = nextData;
    setData(nextData);
  }

  return (
    <AppContext.Provider value={{ data, currentUser, identityLoading, login, logout, createCashier, setUserStatus, setUserFacilities, updateData }}>
      {children}
    </AppContext.Provider>
  );
}
