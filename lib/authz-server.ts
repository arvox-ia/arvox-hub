import type { SupabaseClient } from '@supabase/supabase-js';
import { canAccessFinance } from '@/lib/authz';
import type { ModuleId } from '@/components/navigation/navConfig';

export type FinanceAuth =
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; status: 401 | 403 };

/** Guard das rotas/actions do módulo financeiro: exige usuário admin com módulo 'finance' ligado. */
export async function requireFinanceAdmin(supabase: SupabaseClient): Promise<FinanceAuth> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };
  const { data: me } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single();
  if (!me?.organization_id) return { ok: false, status: 401 };
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('enabled_modules')
    .eq('organization_id', me.organization_id)
    .single();
  const viewer = { role: me.role, enabledModules: (settings?.enabled_modules ?? []) as ModuleId[] };
  if (!canAccessFinance(viewer)) return { ok: false, status: 403 };
  return { ok: true, userId: user.id, organizationId: me.organization_id };
}
