import type { AccountStatus, User, UserRole } from "../types";

interface FacilityDto { id: string; name: string; createdAt?: string }
interface UserDto {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  facilityIds: string[];
  createdAt: string;
  updatedAt?: string;
}
interface LoginDto { accessToken: string; expiresAt: string; user: UserDto }

export interface IdentitySnapshot { user: User; users: User[]; facilities: FacilityDto[] }

export function mapIdentityUser(user: UserDto): User {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    status: user.status,
    hospitalIds: user.facilityIds,
    createdBy: null,
    createdAt: user.createdAt,
  };
}

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload.data as T;
}

export async function signIn(email: string, password: string): Promise<{ token: string; user: User }> {
  const result = await request<LoginDto>("/api/auth/login", undefined, {
    method: "POST", body: JSON.stringify({ email, password }),
  });
  return { token: result.accessToken, user: mapIdentityUser(result.user) };
}

export async function signOut(token: string): Promise<void> {
  await request<{ signedOut: boolean }>("/api/auth/logout", token, { method: "POST" });
}

export async function loadIdentity(token: string): Promise<IdentitySnapshot> {
  const [me, users, facilities] = await Promise.all([
    request<{ user: UserDto }>("/api/auth/me", token),
    request<UserDto[]>("/api/users", token),
    request<FacilityDto[]>("/api/facilities", token),
  ]);
  return {
    user: mapIdentityUser(me.user),
    users: users.map(mapIdentityUser),
    facilities,
  };
}

export async function createCashier(token: string, input: {
  name: string; phone: string; email: string; password: string; facilityIds: string[];
}): Promise<User> {
  return mapIdentityUser(await request<UserDto>("/api/cashiers", token, {
    method: "POST", body: JSON.stringify(input),
  }));
}

export async function setUserStatus(token: string, id: string, status: AccountStatus): Promise<User> {
  return mapIdentityUser(await request<UserDto>(`/api/users/${id}/status`, token, {
    method: "PATCH", body: JSON.stringify({ status }),
  }));
}

export async function setUserFacilities(token: string, id: string, facilityIds: string[]): Promise<User> {
  return mapIdentityUser(await request<UserDto>(`/api/users/${id}/facilities`, token, {
    method: "PUT", body: JSON.stringify({ facilityIds }),
  }));
}
