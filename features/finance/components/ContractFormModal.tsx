'use client';

import React, { useMemo, useState } from 'react';
import { User, Mail, Phone } from 'lucide-react';
import { Modal, ModalForm } from '@/components/ui/Modal';
import { InputField, SelectField, TextareaField, SubmitButton } from '@/components/ui/FormField';
import { ContactSearchCombobox } from '@/components/ui/ContactSearchCombobox';
import { useToast } from '@/context/ToastContext';
import { formatBRL } from '@/lib/utils/currency';
import type { Contact } from '@/types';
import type { ContractFormState, ContractFormValues } from '../hooks/useFinanceController';
import type { ReceivableEntry } from '../core/types';

interface ContractFormModalProps {
  state: ContractFormState;
  contacts: Contact[];
  isSaving: boolean;
  previewReceivables: (values: ContractFormValues) => ReceivableEntry[];
  onClose: () => void;
  onSubmit: (values: ContractFormValues) => void;
}

const DURATION_OPTIONS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: 'INDETERMINATE', label: 'Indeterminado' },
];

function initialValuesFor(state: ContractFormState, today: string): ContractFormValues {
  if (state.mode === 'edit') {
    const c = state.contract;
    return {
      contactId: c.contactId,
      description: c.description,
      setupValue: c.setupValue,
      setupInstallments: c.setupInstallments,
      monthlyValue: c.monthlyValue,
      startDate: c.startDate,
      durationMonths: c.durationMonths,
      billingDay: c.billingDay,
    };
  }
  if (state.mode === 'renew') {
    return state.initialValues;
  }
  return {
    contactId: '',
    description: '',
    setupValue: 0,
    setupInstallments: 1,
    monthlyValue: 0,
    startDate: today,
    durationMonths: 12,
    billingDay: 5,
  };
}

function durationToOptionValue(durationMonths: number | null): string {
  if (durationMonths === null) return 'INDETERMINATE';
  if ([3, 6, 12].includes(durationMonths)) return String(durationMonths);
  return `CUSTOM_${durationMonths}`;
}

/**
 * Modal de criar / editar / renovar contrato (Task 7). No modo create/renew,
 * mostra um preview do que `generateReceivables` (core, sem I/O) vai gerar
 * ANTES de salvar — é dinheiro, o usuário precisa ver vindo. No modo edit,
 * só atualiza os metadados do contrato (nunca regenera recebíveis já
 * persistidos), então o preview não é exibido.
 */
export const ContractFormModal: React.FC<ContractFormModalProps> = ({
  state,
  contacts,
  isSaving,
  previewReceivables,
  onClose,
  onSubmit,
}) => {
  const { addToast } = useToast();
  const todayFallback = useMemo(() => initialValuesFor(state, new Date().toISOString().slice(0, 10)), [state]);
  const [values, setValues] = useState<ContractFormValues>(todayFallback);
  const [durationOption, setDurationOption] = useState(() => durationToOptionValue(todayFallback.durationMonths));
  const [formError, setFormError] = useState<string | null>(null);

  const selectedContact = contacts.find(c => c.id === values.contactId) ?? null;

  const title =
    state.mode === 'edit' ? 'Editar contrato' : state.mode === 'renew' ? 'Renovar contrato' : 'Novo contrato';

  const durationSelectOptions =
    durationOption.startsWith('CUSTOM_') && values.durationMonths !== null
      ? [...DURATION_OPTIONS, { value: durationOption, label: `${values.durationMonths} meses (atual)` }]
      : DURATION_OPTIONS;

  const handleDurationChange = (optionValue: string) => {
    setDurationOption(optionValue);
    if (optionValue === 'INDETERMINATE') {
      setValues(v => ({ ...v, durationMonths: null }));
    } else if (optionValue.startsWith('CUSTOM_')) {
      // Mantém o valor atual (só reaparece se o usuário não mexer no select).
    } else {
      setValues(v => ({ ...v, durationMonths: Number(optionValue) }));
    }
  };

  const preview = useMemo(() => {
    if (state.mode === 'edit') return null;
    if (!values.setupValue && !values.monthlyValue) return [];
    return previewReceivables(values);
  }, [state.mode, values, previewReceivables]);

  const previewSummary = useMemo(() => {
    if (!preview) return null;
    const setupCount = preview.filter(r => r.kind === 'SETUP').length;
    const monthlyCount = preview.filter(r => r.kind === 'MONTHLY').length;
    const total = preview.reduce((sum, r) => sum + r.amount, 0);
    return { count: preview.length, setupCount, monthlyCount, total };
  }, [preview]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!values.contactId) {
      setFormError('Selecione o contato do contrato.');
      return;
    }
    if (values.setupInstallments < 1 || values.setupInstallments > 12) {
      setFormError('Número de parcelas de setup deve ser entre 1 e 12.');
      return;
    }
    if (values.billingDay < 1 || values.billingDay > 28) {
      setFormError('Dia de cobrança deve ser entre 1 e 28.');
      return;
    }
    if (!values.startDate) {
      setFormError('Informe a data de início.');
      return;
    }

    onSubmit(values);
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      <ModalForm onSubmit={handleSubmit}>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Contato <span className="text-red-500">*</span>
          </label>
          {selectedContact ? (
            <div className="flex items-center gap-3 p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg">
              <div className="w-10 h-10 bg-primary-500/20 rounded-full flex items-center justify-center">
                <User size={20} className="text-primary-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{selectedContact.name}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {selectedContact.email && (
                    <span className="flex items-center gap-1 truncate">
                      <Mail size={12} /> {selectedContact.email}
                    </span>
                  )}
                  {selectedContact.phone && (
                    <span className="flex items-center gap-1">
                      <Phone size={12} /> {selectedContact.phone}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setValues(v => ({ ...v, contactId: '' }))}
                className="text-slate-400 hover:text-red-500 transition-colors"
                aria-label="Trocar contato"
              >
                ✕
              </button>
            </div>
          ) : (
            <ContactSearchCombobox
              selectedContact={null}
              selectedCompany={null}
              onSelectContact={contact => setValues(v => ({ ...v, contactId: contact?.id ?? '' }))}
              onSelectCompany={() => {}}
              onCreateNew={() =>
                addToast('Crie o contato primeiro na tela de Contatos, depois volte aqui.', 'info')
              }
            />
          )}
        </div>

        <TextareaField
          label="Descrição"
          placeholder="Ex: Consultoria de automação — pacote mensal"
          value={values.description}
          onChange={e => setValues(v => ({ ...v, description: e.target.value }))}
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Valor de setup (R$)"
            type="number"
            min={0}
            step="0.01"
            value={values.setupValue}
            onChange={e => setValues(v => ({ ...v, setupValue: Number(e.target.value) }))}
          />
          <InputField
            label="Parcelas de setup"
            type="number"
            min={1}
            max={12}
            value={values.setupInstallments}
            onChange={e => setValues(v => ({ ...v, setupInstallments: Number(e.target.value) }))}
            hint="1 a 12 parcelas"
          />
        </div>

        <InputField
          label="Mensalidade (R$)"
          type="number"
          min={0}
          step="0.01"
          value={values.monthlyValue}
          onChange={e => setValues(v => ({ ...v, monthlyValue: Number(e.target.value) }))}
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Data de início"
            type="date"
            value={values.startDate}
            onChange={e => setValues(v => ({ ...v, startDate: e.target.value }))}
          />
          <InputField
            label="Dia de cobrança"
            type="number"
            min={1}
            max={28}
            value={values.billingDay}
            onChange={e => setValues(v => ({ ...v, billingDay: Number(e.target.value) }))}
            hint="1 a 28"
          />
        </div>

        <SelectField
          label="Duração"
          options={durationSelectOptions}
          value={durationOption}
          onChange={e => handleDurationChange(e.target.value)}
        />

        {previewSummary && (
          <div className="p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            {previewSummary.count > 0 ? (
              <>
                <p className="font-medium text-slate-900 dark:text-white">
                  Serão gerados {previewSummary.count} recebível(is): {previewSummary.setupCount} de setup +{' '}
                  {previewSummary.monthlyCount} mensalidade(s)
                </p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">Total: {formatBRL(previewSummary.total)}</p>
              </>
            ) : (
              <p className="text-slate-500 dark:text-slate-400">
                Informe valor de setup e/ou mensalidade para ver o preview dos recebíveis.
              </p>
            )}
          </div>
        )}

        {formError && (
          <p className="text-sm text-red-500" role="alert">
            {formError}
          </p>
        )}

        <SubmitButton isLoading={isSaving} loadingText="Salvando...">
          {state.mode === 'edit' ? 'Salvar alterações' : state.mode === 'renew' ? 'Criar renovação' : 'Criar contrato'}
        </SubmitButton>
      </ModalForm>
    </Modal>
  );
};
