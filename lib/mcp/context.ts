import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModuleId } from '@/components/navigation/navConfig';

/**
 * Contexto por-requisição do servidor MCP, resolvido em
 * `app/api/[transport]/route.ts#resolveApiKey` e disponibilizado via
 * AsyncLocalStorage tanto para o REGISTRO de tools (decide o que aparece em
 * `tools/list`) quanto para a EXECUÇÃO (`getMcpContext()` dentro de cada
 * handler).
 *
 * `scopes`/`creatorRole`/`enabledModules` existem só para a decisão de gate
 * do financeiro (`keyGrantsFinance`, `lib/authz.ts`, usada em
 * `lib/mcp/registerAllTools.ts`) — nenhuma tool de CRM depende deles hoje.
 */
export type McpRequestContext = {
  organizationId: string;
  userId: string;
  /** Escopos da chave usada nesta requisição (api_keys.scopes). Vazio/ausente = só CRM. */
  scopes: string[];
  /**
   * Papel ATUAL de quem criou a chave (profiles.role), lido a cada
   * requisição — não o papel no momento da criação. `null` quando
   * `created_by` é nulo (perfil removido) ou o profile não existe mais:
   * falha fechado, `keyGrantsFinance` nunca concede financeiro nesse caso.
   */
  creatorRole: string | null;
  /** Módulos habilitados da organização (organization_settings.enabled_modules) no momento desta requisição. */
  enabledModules: ModuleId[];
};

export const mcpContextStorage = new AsyncLocalStorage<McpRequestContext>();

export function getMcpContext(): McpRequestContext {
  const ctx = mcpContextStorage.getStore();
  if (!ctx) {
    throw new Error('MCP context not available — called outside of request handler');
  }
  return ctx;
}
