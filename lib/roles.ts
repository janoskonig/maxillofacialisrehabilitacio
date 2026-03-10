'use client';

export type UserRole = 'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos';

const ROLES_STORAGE_KEY = 'userRoles';

function readRoles(): Record<string, UserRole> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROLES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeRoles(map: Record<string, UserRole>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(map));
}

export function getUserRole(email: string | null): UserRole {
  if (!email) return 'fogpótlástanász';
  const roles = readRoles();
  return roles[email] || 'fogpótlástanász';
}

export function setUserRole(email: string, role: UserRole): void {
  const roles = readRoles();
  roles[email] = role;
  writeRoles(roles);
}

export function listUserRoles(): Array<{ email: string; role: UserRole }> {
  const roles = readRoles();
  return Object.entries(roles).map(([email, role]) => ({ email, role }));
}
