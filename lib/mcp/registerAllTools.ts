/**
 * @fileoverview Registro de TODAS as tools do servidor MCP (CRM + financeiro).
 *
 * Extraído de `app/api/[transport]/route.ts` para ser testável isoladamente:
 * `mcp-handler` cria uma instância NOVA de `McpServer` a cada requisição/sessão
 * e chama esta função dentro dela (ver `initializeMcpApiHandler` em
 * `mcp-handler`), o que por sua vez roda dentro do `mcpContextStorage.run(ctx,
 * ...)` estabelecido em `wrappedHandler` (route.ts) — por isso dá pra ler
 * `getMcpContext()` aqui, na hora do REGISTRO (não só na execução). É esse
 * timing que permite as tools financeiras nem aparecerem em `tools/list` para
 * quem não tem acesso, em vez de aparecerem e negarem no `tools/call`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExistingCrmTools } from '@/lib/mcp/registerTools';
import { registerMessagingTools } from '@/lib/mcp/tools/messaging';
import { registerAITools } from '@/lib/mcp/tools/ai';
import { registerAdminTools } from '@/lib/mcp/tools/admin';
import { registerContactsAdvancedTools } from '@/lib/mcp/tools/contacts-advanced';
import { registerSimulationTools } from '@/lib/mcp/tools/simulation';
import { registerFinanceTools } from '@/lib/mcp/tools/finance';
import { getMcpContext } from '@/lib/mcp/context';
import { keyGrantsFinance } from '@/lib/authz';

export function registerAllMcpTools(server: McpServer) {
  registerExistingCrmTools(server);
  registerMessagingTools(server);
  registerAITools(server);
  registerAdminTools(server);
  registerContactsAdvancedTools(server);
  registerSimulationTools(server);

  // Financeiro: gate explícito, falha fechado.
  //
  // - Sem contexto MCP disponível (não deveria acontecer numa requisição
  //   autenticada — só chegamos aqui dentro do `mcpContextStorage.run()`
  //   estabelecido após `resolveApiKey` ter sucesso — mas se acontecer, não
  //   registra financeiro em vez de derrubar o registro das outras tools).
  // - Com contexto, só registra quando `keyGrantsFinance` autoriza: escopo
  //   'finance' na chave E o criador dela ainda é admin com o módulo
  //   'finance' ligado na organização (ver `lib/authz.ts`).
  let ctx: ReturnType<typeof getMcpContext> | null = null;
  try {
    ctx = getMcpContext();
  } catch {
    ctx = null;
  }

  if (ctx && keyGrantsFinance(ctx)) {
    registerFinanceTools(server);
  }
}
