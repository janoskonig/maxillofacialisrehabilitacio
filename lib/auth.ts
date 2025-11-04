// Auth utilities - szerver oldali cookie alapú hitelesítés

export type AuthUser = {
  email: string;
  role: 'admin' | 'editor' | 'viewer';
};

let cachedUser: AuthUser | null = null;

// Felhasználó adatok lekérdezése szerverről
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
    });
    
    if (!response.ok) {
      cachedUser = null;
      return null;
    }
    
    const data = await response.json();
    cachedUser = data.user;
    return data.user;
  } catch (error) {
    console.error('Auth check error:', error);
    cachedUser = null;
    return null;
  }
}

// Kliens oldali cache használata (gyors ellenőrzéshez)
export const isAuthenticated = async (): Promise<boolean> => {
  const user = await getCurrentUser();
  return user !== null;
};

export const getUserEmail = async (): Promise<string | null> => {
  const user = await getCurrentUser();
  return user?.email || null;
};

export const getUserRole = async (): Promise<'admin' | 'editor' | 'viewer' | null> => {
  const user = await getCurrentUser();
  return user?.role || null;
};

export const logout = async (): Promise<void> => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout error:', error);
  }
  cachedUser = null;
};

// Synchronous getter (kliens oldali cache-ből, ha van)
export const getCachedUser = (): AuthUser | null => {
  return cachedUser;
};

