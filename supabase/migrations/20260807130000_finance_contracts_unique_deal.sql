-- Trava de integridade pro fluxo "importar de deal ganho" (Fase 1B, Task 10 —
-- achado da revisão pós-deploy): a exclusão de deals já importados
-- (`importableDealRows`, em `useFinanceController.ts`) era só client-cache —
-- duas abas (ou dois admins ao mesmo tempo) podiam importar o MESMO deal
-- ganho e duplicar os recebíveis dele. `deal_id` nunca teve constraint de
-- unicidade no banco.
--
-- Parcial (não coluna-level) por dois motivos: (1) a maioria dos contratos
-- não vem de deal nenhum (`deal_id IS NULL` — contrato cadastrado direto),
-- e uma unique constraint normal trataria múltiplos NULLs como conflito;
-- (2) um contrato importado que depois é soft-deletado não deve travar uma
-- reimportação futura do mesmo deal (mesmo racional de
-- `idx_finance_expense_entries_unique_active`, já usado nesta mesma tabela
-- de migrations).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_finance_contracts_deal
  ON public.finance_contracts (deal_id)
  WHERE deal_id IS NOT NULL AND deleted_at IS NULL;
