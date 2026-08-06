-- supabase/migrations/20260806120000_add_enabled_modules.sql
-- Módulos do Arvox Hub habilitados por organização.
-- 'crm' é o default de toda org; 'finance' e 'projects' são ligados por org.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS enabled_modules text[] NOT NULL DEFAULT '{crm}';

COMMENT ON COLUMN public.organization_settings.enabled_modules IS
  'Módulos do Arvox Hub habilitados para a organização: crm, finance, projects.';
