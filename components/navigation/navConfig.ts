import type { ComponentType } from 'react';
import {
  Inbox,
  MessageSquare,
  KanbanSquare,
  Users,
  CheckSquare,
  MoreHorizontal,
  LayoutDashboard,
  BarChart3,
  Settings,
  User,
} from 'lucide-react';

export type ModuleId = 'crm' | 'finance' | 'projects';

/** Gate opcional de visibilidade de um item de navegação. */
export interface NavGate {
  /** Módulo que precisa estar em organization_settings.enabled_modules. */
  module?: ModuleId;
  /** Visível apenas para profiles.role === 'admin'. */
  adminOnly?: boolean;
}

export interface NavViewer {
  enabledModules: ModuleId[] | null | undefined;
  role: string | null | undefined;
}

/** Itens sem gate sempre passam; com gate, exigem módulo ligado e/ou papel admin. */
export function filterNav<T extends NavGate>(items: T[], viewer: NavViewer): T[] {
  const mods = viewer.enabledModules ?? [];
  return items.filter((item) => {
    if (item.module && !mods.includes(item.module)) return false;
    if (item.adminOnly && viewer.role !== 'admin') return false;
    return true;
  });
}

export type PrimaryNavId = 'inbox' | 'messaging' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem extends NavGate {
  id: PrimaryNavId;
  label: string;
  /** Route to navigate. For "more", this is omitted because it opens a menu/sheet. */
  href?: string;
  icon: ComponentType<{ className?: string }>;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox },
  { id: 'messaging', label: 'Mensagens', href: '/messaging', icon: MessageSquare },
  { id: 'boards', label: 'Boards', href: '/boards', icon: KanbanSquare },
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

export type SecondaryNavId = 'dashboard' | 'reports' | 'settings' | 'profile';

export interface SecondaryNavItem extends NavGate {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

/** Mirrors non-primary destinations available in the desktop sidebar/user menu. */
export const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visão Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'reports', label: 'Relatórios', href: '/reports', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', href: '/settings', icon: Settings },
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
];
