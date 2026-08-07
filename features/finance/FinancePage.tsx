'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardTab } from './components/DashboardTab';
import { ContractsTab } from './components/ContractsTab';
import { ExpensesTab } from './components/ExpensesTab';
import { SettingsTab } from './components/SettingsTab';
import { useFinanceController, type FinanceTab } from './hooks/useFinanceController';

const TAB_CONFIG: { id: FinanceTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'contracts', label: 'Contratos' },
  { id: 'expenses', label: 'Despesas' },
  { id: 'settings', label: 'Configurações' },
];

export const FinancePage: React.FC = () => {
  const controller = useFinanceController();
  const { activeTab, setActiveTab } = controller;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight text-slate-900 dark:text-white">
          Financeiro
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Contratos, recebíveis, despesas e projeção de caixa.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FinanceTab)}>
        <TabsList>
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab controller={controller} />
        </TabsContent>

        <TabsContent value="contracts">
          <ContractsTab controller={controller} />
        </TabsContent>

        <TabsContent value="expenses">
          <ExpensesTab controller={controller} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab controller={controller} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
