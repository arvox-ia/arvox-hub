'use client';

import React from 'react';
import { LayoutDashboard, FileText, Receipt, Settings as SettingsIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { useFinanceController, type FinanceTab } from './hooks/useFinanceController';

const TAB_CONFIG: { id: FinanceTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'contracts', label: 'Contratos' },
  { id: 'expenses', label: 'Despesas' },
  { id: 'settings', label: 'Configurações' },
];

export const FinancePage: React.FC = () => {
  const { activeTab, setActiveTab } = useFinanceController();

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
          <EmptyState
            icon={LayoutDashboard}
            title="Dashboard em construção"
            description="A visão consolidada de caixa e projeção chega em breve."
          />
        </TabsContent>

        <TabsContent value="contracts">
          <EmptyState
            icon={FileText}
            title="Contratos em construção"
            description="Cadastro de contratos e recebíveis chega em breve."
          />
        </TabsContent>

        <TabsContent value="expenses">
          <EmptyState
            icon={Receipt}
            title="Despesas em construção"
            description="Cadastro de despesas fixas e pontuais chega em breve."
          />
        </TabsContent>

        <TabsContent value="settings">
          <EmptyState
            icon={SettingsIcon}
            title="Configurações em construção"
            description="Metas, alíquota de imposto e saldo inicial chegam em breve."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
