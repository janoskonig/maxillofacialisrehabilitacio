'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff, Mail, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

type RegistrationRole = 'sebész' | 'fogpótos' | 'technikus';

export default function Register() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<RegistrationRole | ''>('');
  const [institution, setInstitution] = useState('');
  const [institutionOptions, setInstitutionOptions] = useState<string[]>([]);
  const [filteredInstitutions, setFilteredInstitutions] = useState<string[]>([]);
  const [showInstitutionDropdown, setShowInstitutionDropdown] = useState(false);
  const [accessReason, setAccessReason] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const institutionInputRef = useRef<HTMLInputElement>(null);
  const institutionDropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Betöltjük az intézményeket az API-ból
  useEffect(() => {
    const fetchInstitutions = async () => {
      try {
        const response = await fetch('/api/institutions');
        if (response.ok) {
          const data = await response.json();
          setInstitutionOptions(data.institutions || []);
          setFilteredInstitutions(data.institutions || []);
        }
      } catch (error) {
        console.error('Error fetching institutions:', error);
      }
    };
    fetchInstitutions();
  }, []);

  // Szűrés az intézmények között
  const handleInstitutionChange = (value: string) => {
    setInstitution(value);
    if (value.trim() === '') {
      setFilteredInstitutions(institutionOptions);
      setShowInstitutionDropdown(false);
    } else {
      const filtered = institutionOptions.filter(inst =>
        inst.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredInstitutions(filtered);
      setShowInstitutionDropdown(filtered.length > 0);
    }
  };

  // Fókusz esetén mutatjuk az összes intézményt, ha üres a mező
  const handleInstitutionFocus = () => {
    if (institution.trim() === '') {
      setFilteredInstitutions(institutionOptions);
    }
    if (institutionOptions.length > 0) {
      setShowInstitutionDropdown(true);
    }
  };

  // Intézmény kiválasztása a dropdown-ból
  const selectInstitution = (value: string) => {
    setInstitution(value);
    setShowInstitutionDropdown(false);
    if (institutionInputRef.current) {
      institutionInputRef.current.blur();
    }
  };

  // Kattintás kezelése a dropdown-on kívül
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        institutionDropdownRef.current &&
        !institutionDropdownRef.current.contains(event.target as Node) &&
        institutionInputRef.current &&
        !institutionInputRef.current.contains(event.target as Node)
      ) {
        setShowInstitutionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Kliens oldali validáció
    if (!fullName || !fullName.trim()) {
      setError('Kérjük, adja meg a teljes nevét');
      setIsLoading(false);
      return;
    }

    if (!role) {
      setError('Kérjük, válasszon szerepkört');
      setIsLoading(false);
      return;
    }

    if (!institution) {
      setError('Kérjük, válassza ki az intézményt');
      setIsLoading(false);
      return;
    }

    if (!accessReason || !accessReason.trim()) {
      setError('Kérjük, adja meg az indokolást');
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('A jelszavak nem egyeznek meg');
      setIsLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('A jelszónak legalább 6 karakter hosszúnak kell lennie');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ 
          email, 
          fullName: fullName.trim(), 
          password, 
          confirmPassword, 
          role,
          institution,
          accessReason: accessReason.trim()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Regisztrációs hiba történt');
        setIsLoading(false);
        return;
      }

      // Sikeres regisztráció - jóváhagyásra vár
      if (data.pendingApproval) {
        // Megjelenítjük a siker üzenetet és átirányítjuk a login oldalra
        setError('');
        alert('Regisztráció sikeres! A fiók jóváhagyásra vár. Az admin jóváhagyása után be tud jelentkezni.');
        router.push('/login');
      } else {
        // Ha valamiért nincs pendingApproval, akkor is átirányítjuk
        router.push('/login');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('Regisztrációs hiba történt');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Logo width={100} height={115} />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Maxillofaciális Rehabilitáció
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          REGISZTRÁCIÓ
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
                Teljes név
              </label>
              <div className="mt-1 relative">
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="form-input pl-10"
                  placeholder="Kovács János dr."
                />
                <UserCircle className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>
              <p className="mt-1 text-xs text-gray-500">Adja meg a teljes nevét (pl. Kovács János dr.)</p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email cím
              </label>
              <div className="mt-1 relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input pl-10"
                  placeholder="vezeteknev.keresztnev@example.com"
                />
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Jelszó
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input pl-10 pr-10"
                  placeholder="••••••••"
                />
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Legalább 6 karakter</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Jelszó megerősítése
              </label>
              <div className="mt-1 relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="form-input pl-10 pr-10"
                  placeholder="••••••••"
                />
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                Szerepkör
              </label>
              <div className="mt-1">
                <select
                  id="role"
                  name="role"
                  required
                  value={role}
                  onChange={(e) => setRole(e.target.value as RegistrationRole)}
                  className="form-input w-full"
                >
                  <option value="">-- Válasszon szerepkört --</option>
                  <option value="sebész">Sebész</option>
                  <option value="fogpótos">Fogpótos</option>
                  <option value="technikus">Technikus</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-gray-500">Kérjük, válassza ki, milyen szerepkörben szeretne regisztrálni</p>
            </div>

            <div>
              <label htmlFor="institution" className="block text-sm font-medium text-gray-700">
                Intézmény
              </label>
              <div className="mt-1 relative">
                <input
                  id="institution"
                  name="institution"
                  type="text"
                  required
                  value={institution}
                  onChange={(e) => handleInstitutionChange(e.target.value)}
                  onFocus={handleInstitutionFocus}
                  ref={institutionInputRef}
                  className="form-input w-full"
                  placeholder="Kezdjen el gépelni vagy válasszon az intézmények közül..."
                  autoComplete="off"
                />
                {showInstitutionDropdown && filteredInstitutions.length > 0 && (
                  <div
                    ref={institutionDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
                  >
                    {filteredInstitutions.map((inst, index) => (
                      <div
                        key={index}
                        onClick={() => selectInstitution(inst)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700 border-b border-gray-100 last:border-b-0"
                      >
                        {inst}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Kezdjen el gépelni vagy válasszon az eddig regisztrált intézmények közül
              </p>
            </div>

            <div>
              <label htmlFor="accessReason" className="block text-sm font-medium text-gray-700">
                Hozzáférés indokolása
              </label>
              <div className="mt-1">
                <textarea
                  id="accessReason"
                  name="accessReason"
                  required
                  rows={4}
                  value={accessReason}
                  onChange={(e) => setAccessReason(e.target.value)}
                  className="form-input w-full"
                  placeholder="Rövid indokolás, miért kér hozzáférést a rendszerhez..."
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Kérjük, röviden indokolja, miért kér hozzáférést</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full flex justify-center items-center"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Regisztráció...
                  </>
                ) : (
                  'Regisztráció'
                )}
              </button>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-600">
                Már van fiókja?{' '}
                <Link href="/login" className="font-medium text-medical-primary hover:text-medical-primary-dark">
                  Bejelentkezés
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

