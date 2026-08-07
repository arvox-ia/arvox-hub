-- =============================================================================
-- Escopos por chave de API (api_keys.scopes)
-- =============================================================================
-- Contexto/risco que motiva esta migration:
-- Hoje `api_keys` não tem noção de permissão — uma chave só carrega
-- organization_id. A landing page (arvox.com.br) usa uma chave criada por um
-- admin apenas para criar leads (POST /api/public/v1/contacts). Se o acesso
-- ao financeiro fosse herdado do papel de quem criou a chave, essa MESMA
-- chave da LP passaria a poder ler/escrever caixa da empresa silenciosamente
-- — sem ninguém ter pedido isso. Por isso: escopo é explícito POR CHAVE,
-- default '{crm}', e nenhuma chave existente ganha permissão nova com este
-- deploy (toda linha atual recebe o default '{crm}' via ALTER ... DEFAULT).

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{crm}';

COMMENT ON COLUMN public.api_keys.scopes IS
  'Escopos explícitos da chave (ex.: {crm}, {crm,finance}). Default {crm} — '
  'nunca inferir financeiro do papel de quem criou a chave: a chave da LP '
  '(criada por admin, só usada para criar leads) não pode ganhar acesso ao '
  'financeiro por herança. "finance" só é gravado por create_api_key quando '
  'o solicitante é admin no momento da criação.';

-- -----------------------------------------------------------------------------
-- validate_api_key: agora também devolve scopes e created_by.
-- Mantém a assinatura (p_token TEXT) e todas as colunas de saída anteriores
-- (api_key_id, api_key_prefix, organization_id, organization_name) — só
-- ACRESCENTA colunas no final, para não quebrar chamadores existentes que
-- leem por nome de coluna (authPublicApi já valida o shape defensivamente).
-- Postgres não permite CREATE OR REPLACE mudar as colunas de retorno de uma
-- função RETURNS TABLE — precisa DROP antes.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_api_key(TEXT);

CREATE OR REPLACE FUNCTION public.validate_api_key(p_token TEXT)
RETURNS TABLE (
  api_key_id UUID,
  api_key_prefix TEXT,
  organization_id UUID,
  organization_name TEXT,
  scopes TEXT[],
  created_by UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  h TEXT;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN;
  END IF;

  h := public._api_key_sha256_hex(p_token);

  RETURN QUERY
  WITH k AS (
    SELECT ak.id, ak.key_prefix, ak.organization_id, ak.scopes, ak.created_by
    FROM public.api_keys ak
    WHERE ak.key_hash = h
      AND ak.revoked_at IS NULL
    LIMIT 1
  )
  SELECT
    k.id,
    k.key_prefix,
    k.organization_id,
    o.name,
    k.scopes,
    k.created_by
  FROM k
  JOIN public.organizations o ON o.id = k.organization_id;

  -- Touch last_used_at (best-effort)
  UPDATE public.api_keys
    SET last_used_at = now(),
        updated_at = now()
  WHERE key_hash = h
    AND revoked_at IS NULL;
END;
$$;

ALTER FUNCTION public.validate_api_key(TEXT) SET search_path = '';
REVOKE ALL ON FUNCTION public.validate_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_api_key(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_api_key: passa a aceitar p_scopes (default '{crm}').
-- Guard server-side (nunca confiar no cliente): a função já exige que quem
-- chama seja admin da organização para criar QUALQUER chave (bloco existente
-- abaixo, preservado). Além disso, saneamos a lista recebida — descartamos
-- valores desconhecidos e só persistimos 'finance' quando o chamador é
-- admin nesse instante. Isso é redundante com o guard de admin da função
-- inteira hoje, mas documentado explicitamente para não depender
-- implicitamente dele caso a regra de "quem pode criar chave" mude no
-- futuro (ex.: vendedor passar a poder criar chaves só de CRM).
-- A assinatura ganha um parâmetro novo (p_scopes) — isso cria uma função
-- distinta da antiga create_api_key(TEXT) aos olhos do Postgres (overload
-- por tipo de parâmetro, CREATE OR REPLACE não "vira" a antiga). Sem o DROP
-- abaixo, as duas coexistiriam e uma chamada só com p_name viraria ambígua
-- entre as duas assinaturas.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_api_key(TEXT);

CREATE OR REPLACE FUNCTION public.create_api_key(p_name TEXT, p_scopes TEXT[] DEFAULT '{crm}')
RETURNS TABLE (
  api_key_id UUID,
  token TEXT,
  key_prefix TEXT,
  organization_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  uid UUID;
  org_id UUID;
  t TEXT;
  prefix TEXT;
  h TEXT;
  is_admin BOOLEAN;
  safe_scopes TEXT[];
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.organization_id INTO org_id
  FROM public.profiles p
  WHERE p.id = uid;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for user';
  END IF;

  -- Must be admin
  is_admin := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = uid AND p.organization_id = org_id AND p.role = 'admin'
  );
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Sanitiza escopos: mantém apenas valores conhecidos; nunca confia
  -- cegamente no array vindo do cliente. 'finance' só sobrevive ao filtro
  -- se is_admin = true (sempre verdadeiro aqui, ver acima) — silenciosamente
  -- descartado caso contrário, em vez de falhar a criação inteira da chave.
  SELECT COALESCE(array_agg(DISTINCT s), '{crm}')
    INTO safe_scopes
    FROM unnest(COALESCE(p_scopes, '{crm}'::text[])) AS s
    WHERE s = 'crm' OR (s = 'finance' AND is_admin);

  IF safe_scopes IS NULL OR array_length(safe_scopes, 1) IS NULL THEN
    safe_scopes := '{crm}';
  END IF;

  t := public._api_key_make_token();
  prefix := left(t, 12);
  h := public._api_key_sha256_hex(t);

  INSERT INTO public.api_keys (organization_id, name, key_prefix, key_hash, created_by, updated_at, scopes)
  VALUES (org_id, COALESCE(NULLIF(btrim(p_name), ''), 'Integração'), prefix, h, uid, now(), safe_scopes)
  RETURNING id INTO api_key_id;

  token := t;
  key_prefix := prefix;
  organization_id := org_id;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.create_api_key(TEXT, TEXT[]) SET search_path = '';
REVOKE ALL ON FUNCTION public.create_api_key(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_api_key(TEXT, TEXT[]) TO authenticated;
