/**
 * @fileoverview Composição pura das tools do chat da IA (Fase 1B, Task 11).
 *
 * As tools do CRM sempre entram; as tools financeiras (`lib/ai/financeTools.ts`)
 * SÓ entram quando `canAccessFinance` autoriza o viewer — `financeFactory`
 * (que de fato instancia `createFinanceTools`, tocando o client service-role)
 * nunca é chamada fora desse caso, então um `vendedor` (ou uma org sem o
 * módulo `finance` ligado) nem chega a ter as tools financeiras
 * instanciadas, muito menos expostas ao modelo.
 *
 * Extraída de `app/api/ai/chat/route.ts` para ser testável sem subir a rota
 * inteira (Supabase, auth, streaming) — só objetos e uma função pura. Ver
 * `test/financeToolsGate.test.ts`.
 */

import { canAccessFinance, type ViewerAccess } from '@/lib/authz';

export function composeChatTools<TCrm extends Record<string, unknown>, TFinance extends Record<string, unknown>>(
  crmTools: TCrm,
  viewer: ViewerAccess,
  financeFactory: () => TFinance
): TCrm & Partial<TFinance> {
  if (!canAccessFinance(viewer)) {
    return { ...crmTools } as TCrm & Partial<TFinance>;
  }
  return { ...crmTools, ...financeFactory() };
}
