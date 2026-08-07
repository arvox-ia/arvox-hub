import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { mcpContextStorage, type McpRequestContext } from '@/lib/mcp/context';
import { registerAllMcpTools } from '@/lib/mcp/registerAllTools';
import type { ModuleId } from '@/components/navigation/navConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveApiKey(token: string): Promise<McpRequestContext | null> {
  const fakeRequest = new Request('http://localhost/api/mcp', {
    headers: { 'x-api-key': token },
  });

  const result = await authPublicApi(fakeRequest);
  if (!result.ok) return null;

  const sb = createStaticAdminClient();

  // Fonte de verdade é a própria tabela (não só o retorno do RPC de
  // validação) — mesma checagem defensiva de antes (garante que a chave
  // pertence de fato a esta org); agora também traz `scopes`, usado pelo
  // gate do financeiro (keyGrantsFinance, em lib/mcp/registerAllTools.ts).
  const { data: keyRow } = await sb
    .from('api_keys')
    .select('created_by, scopes')
    .eq('id', result.apiKeyId)
    .eq('organization_id', result.organizationId)
    .maybeSingle();

  if (!keyRow) return null;

  const createdBy = (keyRow.created_by as string | null) ?? null;
  const scopes = Array.isArray(keyRow.scopes)
    ? keyRow.scopes.filter((s): s is string => typeof s === 'string')
    : [];

  // Papel ATUAL do criador da chave — falha fechado (creatorRole = null) se
  // `created_by` for NULL (perfil removido) ou o profile não existir mais.
  // `keyGrantsFinance` nunca concede financeiro com creatorRole null.
  let creatorRole: string | null = null;
  if (createdBy) {
    const { data: creatorProfile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', createdBy)
      .maybeSingle();
    creatorRole = (creatorProfile?.role as string | undefined) ?? null;
  }

  const { data: orgSettings } = await sb
    .from('organization_settings')
    .select('enabled_modules')
    .eq('organization_id', result.organizationId)
    .maybeSingle();
  const enabledModules = Array.isArray(orgSettings?.enabled_modules)
    ? (orgSettings.enabled_modules as ModuleId[])
    : [];

  return {
    organizationId: result.organizationId,
    // Mantido como string (comportamento anterior) mesmo quando created_by é
    // null — nenhuma tool de CRM hoje falha com userId vazio; o financeiro é
    // protegido separadamente por `creatorRole: null` acima.
    userId: createdBy ?? '',
    scopes,
    creatorRole,
    enabledModules,
  };
}

function extractBearerToken(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  const fromBearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (fromBearer) return fromBearer;
  return request.headers.get('x-api-key')?.trim() ?? '';
}

const mcpHandler = createMcpHandler(
  registerAllMcpTools,
  undefined,
  {
    basePath: '/api',
    maxDuration: 120,
    verboseLogs: process.env.NODE_ENV === 'development',
    // Achado da revisão: o transporte SSE legado do mcp-handler regista as
    // tools UMA VEZ POR CONEXÃO (não por requisição) — uma chave revogada ou
    // rebaixada de admin continua com as tools financeiras registradas até a
    // conexão SSE cair (gap de frescor que não existe no Streamable HTTP,
    // onde cada POST cria um McpServer novo — ver `registerAllMcpTools`).
    // Claude Desktop usa Streamable HTTP; desativa o SSE para tirar esse
    // caminho do modelo de ameaça em vez de só "não usá-lo".
    disableSse: true,
  }
);

const authWrappedHandler = withMcpAuth(
  mcpHandler,
  async (req, bearerToken) => {
    const token = bearerToken ?? extractBearerToken(req);
    if (!token) return undefined;

    // Evita resolver a chave duas vezes por requisição (achado da revisão):
    // `wrappedHandler`, abaixo, já resolveu a chave e guardou o contexto em
    // `mcpContextStorage.run(ctx, ...)` ANTES de chamar este handler — lemos
    // daqui em vez de bater no Supabase de novo. `getStore()` só existe
    // dentro do `run()` de uma requisição em andamento (nunca cacheado entre
    // requisições); o fallback cobre só o caso defensivo de este handler ser
    // invocado fora desse `run()` (não deveria acontecer no fluxo normal).
    const ctx = mcpContextStorage.getStore() ?? (await resolveApiKey(token));
    if (!ctx) return undefined;

    // Return a minimal AuthInfo-compatible object. The real context is stored
    // in AsyncLocalStorage by the outer wrappedHandler below.
    return { token, clientId: ctx.userId, scopes: [] };
  }
);

async function wrappedHandler(request: Request) {
  const token = extractBearerToken(request);

  if (token) {
    const ctx = await resolveApiKey(token);
    if (ctx) {
      return mcpContextStorage.run(ctx, () => authWrappedHandler(request));
    }
  }

  return authWrappedHandler(request);
}

export {
  wrappedHandler as GET,
  wrappedHandler as POST,
  wrappedHandler as DELETE,
};
