import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireFinanceAdmin } from '@/lib/authz-server';
import { FinancePage } from '@/features/finance/FinancePage';
import { APP_NAME } from '@/lib/branding';

export const metadata: Metadata = { title: `Financeiro | ${APP_NAME}` };

export default async function Finance() {
  const supabase = await createClient();
  const auth = await requireFinanceAdmin(supabase);

  if (!auth.ok) {
    redirect('/dashboard');
  }

  return <FinancePage />;
}
