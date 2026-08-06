// lib/authz.ts
import type { ModuleId } from '@/components/navigation/navConfig';

export interface ViewerAccess {
  role?: string | null;
  enabledModules?: ModuleId[] | null;
}

/** Financeiro é módulo restrito: exige org com 'finance' ligado E papel admin. */
export function canAccessFinance(viewer: ViewerAccess): boolean {
  return viewer.role === 'admin' && (viewer.enabledModules ?? []).includes('finance');
}
