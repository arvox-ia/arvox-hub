/**
 * Controller do módulo financeiro (Fase 1B).
 *
 * Esqueleto: hoje só junta estado das abas com a query de configurações
 * (prova que a camada de dados da Task 5 chega até a shell). Tasks 7-9
 * estendem com queries/mutations de contratos, despesas e dashboard.
 */
'use client';

import { useState } from 'react';
import { useFinanceSettings } from '@/lib/query/hooks/useFinanceQuery';

export type FinanceTab = 'dashboard' | 'contracts' | 'expenses' | 'settings';

export function useFinanceController() {
  const [activeTab, setActiveTab] = useState<FinanceTab>('dashboard');

  const {
    data: settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useFinanceSettings();

  return {
    activeTab,
    setActiveTab,
    settings,
    settingsLoading,
    settingsError,
  };
}
