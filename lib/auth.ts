// Auth utilities
export const isAuthenticated = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('isAuthenticated') === 'true';
};

export const getUserEmail = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('userEmail');
};

export const logout = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('isAuthenticated');
  localStorage.removeItem('userEmail');
};

export const login = (email: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('isAuthenticated', 'true');
  localStorage.setItem('userEmail', email);
};

