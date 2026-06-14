// Központi navigációs registry — egyetlen forrás a staff felület menüjéhez.
// A Sidebar (desktop) és a MobileBottomNav (mobil) is innen építkezik, így a
// szerep-szűrés és a csoportosítás egy helyen él, nem szétszórt inline gate-ekben.

import type { LucideIcon } from 'lucide-react';
import {
  Home,
  ClipboardList,
  MessageCircle,
  Activity,
  CalendarDays,
  CalendarClock,
  Hourglass,
  Gauge,
  Users,
  Shield,
  BarChart3,
  Settings,
  BookOpen,
} from 'lucide-react';

export type Role = 'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** 'all' = minden bejelentkezett szerep látja; különben a felsorolt szerepek. */
  roles: Role[] | 'all';
  /** Aktív állapot meghatározása az aktuális pathname alapján. */
  match: (pathname: string) => boolean;
  /** true → a mobil alsó sávban önálló fülként jelenik meg (max 3 + „Egyéb"). */
  mobilePrimary?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const startsWith = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

// A szerep-hozzárendelések az oldalankénti, már meglévő gate-ekből származnak
// (lib/auth, getCurrentUser + router.push('/') redirectek), lásd a megfelelő page.tsx-eket.
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'attekintes',
    label: 'Áttekintés',
    items: [
      { id: 'home', label: 'Főoldal', path: '/', icon: Home, roles: 'all', match: (p) => p === '/', mobilePrimary: true },
    ],
  },
  {
    id: 'betegellatas',
    label: 'Betegellátás',
    items: [
      { id: 'tasks', label: 'Feladataim', path: '/tasks', icon: ClipboardList, roles: 'all', match: startsWith('/tasks') },
      { id: 'messages', label: 'Üzenetek', path: '/messages', icon: MessageCircle, roles: 'all', match: startsWith('/messages'), mobilePrimary: true },
      { id: 'treatment-plans', label: 'Kezelési tervek', path: '/treatment-plans', icon: Activity, roles: ['admin', 'fogpótlástanász', 'beutalo_orvos'], match: startsWith('/treatment-plans') },
    ],
  },
  {
    id: 'utemezes',
    label: 'Ütemezés',
    items: [
      { id: 'calendar', label: 'Naptár', path: '/calendar', icon: CalendarDays, roles: 'all', match: startsWith('/calendar'), mobilePrimary: true },
      { id: 'time-slots', label: 'Időpontok kezelése', path: '/time-slots', icon: CalendarClock, roles: ['admin', 'fogpótlástanász'], match: startsWith('/time-slots') },
      { id: 'waiting-times', label: 'Várakozás', path: '/waiting-times', icon: Hourglass, roles: 'all', match: startsWith('/waiting-times') },
      { id: 'workload', label: 'Leterheltség', path: '/workload', icon: Gauge, roles: ['admin', 'fogpótlástanász', 'beutalo_orvos'], match: startsWith('/workload') },
    ],
  },
  {
    id: 'konzilium',
    label: 'Konzílium',
    items: [
      { id: 'consilium', label: 'Konzílium', path: '/consilium', icon: Users, roles: ['admin', 'fogpótlástanász', 'beutalo_orvos'], match: startsWith('/consilium') },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'admin', label: 'Adminisztráció', path: '/admin', icon: Shield, roles: ['admin', 'fogpótlástanász'], match: (p) => p === '/admin' },
      { id: 'admin-stats', label: 'Statisztika', path: '/admin/stats', icon: BarChart3, roles: ['admin'], match: startsWith('/admin/stats') },
    ],
  },
];

// Lábléc-elemek (route-alapúak). A nem-route műveletek (Visszajelzés, Kijelentkezés)
// a komponensekben élnek, mert nincs hozzájuk útvonal.
export const FOOTER_NAV: NavItem[] = [
  { id: 'settings', label: 'Beállítások', path: '/settings', icon: Settings, roles: 'all', match: startsWith('/settings') },
  { id: 'guide', label: 'Használati útmutató', path: '/docs/kezelesi-ut-utmutato', icon: BookOpen, roles: 'all', match: startsWith('/docs/kezelesi-ut-utmutato') },
];

export function canSee(item: NavItem, role: Role): boolean {
  return item.roles === 'all' || item.roles.includes(role);
}

/** A szerep számára látható csoportok, üres csoportok kiszűrve. */
export function visibleGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(item, role)),
  })).filter((group) => group.items.length > 0);
}

/** A szerep számára látható lábléc-elemek. */
export function visibleFooter(role: Role): NavItem[] {
  return FOOTER_NAV.filter((item) => canSee(item, role));
}

// A mobil alsó sáv füljeinek rögzített sorrendje (a korábbi MobileBottomNav-et követve).
const MOBILE_TAB_ORDER = ['home', 'calendar', 'messages'];

/** A mobil alsó sáv elsődleges füljei (Főoldal / Naptár / Üzenetek), szerep szerint. */
export function mobileTabs(role: Role): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => item.mobilePrimary && canSee(item, role))
    .sort((a, b) => MOBILE_TAB_ORDER.indexOf(a.id) - MOBILE_TAB_ORDER.indexOf(b.id));
}
