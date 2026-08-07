-- Módulo financeiro do Arvox Hub. TODAS as tabelas são restritas a admins da
-- organização em TODOS os verbos (spec: papel 'vendedor' não enxerga nada).

-- ============ 1. Configurações (1 linha por org) ============
CREATE TABLE IF NOT EXISTS public.finance_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  tax_rate NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  projection_months INT NOT NULL DEFAULT 12 CHECK (projection_months BETWEEN 3 AND 24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ 2. Contratos ============
-- RESTRICT em contact_id é intencional: registros financeiros não podem ficar
-- órfãos. A UI de exclusão de contato precisa checar contratos antes de
-- deletar (guard tratado na task de Contratos). deal_id usa SET NULL porque
-- um deal excluído não deve destruir o contrato financeiro já firmado.
CREATE TABLE IF NOT EXISTS public.finance_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  setup_value NUMERIC NOT NULL DEFAULT 0 CHECK (setup_value >= 0),
  setup_installments INT NOT NULL DEFAULT 1 CHECK (setup_installments BETWEEN 1 AND 12),
  monthly_value NUMERIC NOT NULL DEFAULT 0 CHECK (monthly_value >= 0),
  start_date DATE NOT NULL,
  duration_months INT CHECK (duration_months IS NULL OR duration_months > 0), -- NULL = indeterminado
  billing_day INT NOT NULL DEFAULT 5 CHECK (billing_day BETWEEN 1 AND 28),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED','RENEWED')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_finance_contracts_org ON public.finance_contracts(organization_id);
CREATE INDEX idx_finance_contracts_contact ON public.finance_contracts(contact_id);

-- ============ 3. Recebíveis (parcelas materializadas) ============
CREATE TABLE IF NOT EXISTS public.finance_receivables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.finance_contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('SETUP','MONTHLY')),
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID')),
  paid_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_finance_receivables_org_due ON public.finance_receivables(organization_id, due_date);
CREATE INDEX idx_finance_receivables_contract ON public.finance_receivables(contract_id);
CREATE INDEX idx_finance_receivables_pending ON public.finance_receivables(organization_id, due_date)
  WHERE status = 'PENDING' AND deleted_at IS NULL;

-- ============ 4. Despesas (catálogo: regra fixa ou pontual) ============
CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('FIXED','ONE_TIME')),
  due_day INT CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 28),  -- FIXED
  due_date DATE,                                                     -- ONE_TIME
  active BOOLEAN NOT NULL DEFAULT TRUE,                              -- FIXED: regra ligada?
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'FIXED' AND due_day IS NOT NULL AND due_date IS NULL)
      OR (kind = 'ONE_TIME' AND due_date IS NOT NULL AND due_day IS NULL))
);
CREATE INDEX idx_finance_expenses_org ON public.finance_expenses(organization_id);

-- ============ 5. Lançamentos de despesa (com baixa) ============
CREATE TABLE IF NOT EXISTS public.finance_expense_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.finance_expenses(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID')),
  paid_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_finance_expense_entries_org_due ON public.finance_expense_entries(organization_id, due_date);
-- Partial (não coluna-level) para não bloquear recriação do mesmo mês após soft-delete.
CREATE UNIQUE INDEX idx_finance_expense_entries_unique_active
  ON public.finance_expense_entries(expense_id, due_date)
  WHERE deleted_at IS NULL;

-- ============ 6. Metas mensais ============
CREATE TABLE IF NOT EXISTS public.finance_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- sempre dia 1 do mês
  target_value NUMERIC NOT NULL CHECK (target_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, month)
);

-- ============ RLS: admin-only em TODOS os verbos, todas as tabelas ============
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_settings','finance_contracts','finance_receivables',
                           'finance_expenses','finance_expense_entries','finance_goals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL
      USING (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.organization_id = %I.organization_id
          AND p.role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.organization_id = %I.organization_id
          AND p.role = 'admin'))
    $p$, t || '_admin_all', t, t, t);
    EXECUTE format('CREATE TRIGGER trigger_%s_updated BEFORE UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE public.finance_contracts IS
  'Contratos do módulo financeiro (Arvox Hub). Acesso restrito a admins da org via RLS.';
