/**
 * useViewer Hook - Papel do usuário + módulos habilitados da organização
 *
 * Combina `profile.role` (já exposto por `AuthContext`) com
 * `organization_settings.enabled_modules` (buscado via TanStack Query, no
 * mesmo padrão de `useAIConfigQuery`) para alimentar `filterNav`/`canAccessFinance`.
 *
 * Enquanto a query de módulos está carregando (ou não há organização),
 * assume `['crm']` — nunca expõe módulos restritos antes da confirmação.
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { getClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ModuleId, NavViewer } from '@/components/navigation/navConfig';

const DEFAULT_MODULES: ModuleId[] = ['crm'];

export function useViewer(): NavViewer {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id ?? null;

  const { data: enabledModules } = useQuery({
    queryKey: queryKeys.orgSettings.enabledModules(organizationId ?? ''),
    queryFn: async (): Promise<ModuleId[] | null> => {
      if (!organizationId) return null;

      const supabase = getClient();
      const { data, error } = await supabase
        .from('organization_settings')
        .select('enabled_modules')
        .eq('organization_id', organizationId)
        .single();

      if (error) {
        console.error('[useViewer] Error:', error);
        throw error;
      }

      return (data?.enabled_modules as ModuleId[] | null) ?? DEFAULT_MODULES;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    role: profile?.role ?? null,
    enabledModules: enabledModules ?? DEFAULT_MODULES,
  };
}
