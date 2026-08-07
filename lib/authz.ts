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

export interface KeyGrantsFinanceInput {
  /** Escopos gravados na chave (api_keys.scopes). */
  scopes?: string[] | null;
  /** Papel ATUAL de quem criou a chave (não o papel no momento da criação —
   *  se o criador for rebaixado depois, o acesso cai junto). */
  creatorRole?: string | null;
  /** Módulos habilitados da organização no momento do uso. */
  enabledModules?: ModuleId[] | null;
}

/**
 * Uma chave de API só pode operar no financeiro se, ao mesmo tempo:
 * (1) o escopo 'finance' está explicitamente na chave, e
 * (2) o criador da chave AINDA satisfaz canAccessFinance hoje (admin + módulo ligado).
 *
 * Isso evita dois riscos: chave sem escopo nenhum ganhar financeiro por
 * herança (a chave da LP nunca teve — e nunca terá — 'finance' em scopes);
 * e uma chave que tinha 'finance' continuar valendo depois que o criador
 * deixou de ser admin ou o módulo foi desligado.
 *
 * Falha fechado: qualquer entrada ausente/nula/vazia resulta em false.
 */
export function keyGrantsFinance({ scopes, creatorRole, enabledModules }: KeyGrantsFinanceInput): boolean {
  if (!Array.isArray(scopes) || !scopes.includes('finance')) return false;
  return canAccessFinance({ role: creatorRole, enabledModules });
}
