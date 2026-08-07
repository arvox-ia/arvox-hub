'use client';

import React, { useMemo, useState } from 'react';
import { Modal, ModalForm } from '@/components/ui/Modal';
import { InputField, SelectField, SubmitButton } from '@/components/ui/FormField';
import { EXPENSE_CATEGORIES } from '../core/types';
import type { ExpenseFormState, ExpenseFormValues } from '../hooks/useFinanceController';

interface ExpenseFormModalProps {
  state: ExpenseFormState;
  isSaving: boolean;
  /** `yyyy-MM-dd` — dia 1 do mês atualmente selecionado na aba, usado como default de data pontual em modo 'create'. */
  defaultDate: string;
  onClose: () => void;
  onSubmit: (values: ExpenseFormValues) => void;
}

const KIND_OPTIONS = [
  { value: 'FIXED', label: 'Fixa mensal' },
  { value: 'ONE_TIME', label: 'Pontual' },
];

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }));

function initialValuesFor(state: ExpenseFormState, defaultDate: string): ExpenseFormValues {
  if (state.mode === 'edit') {
    const e = state.expense;
    return {
      description: e.description,
      category: e.category,
      amount: e.amount,
      kind: e.kind,
      dueDay: e.dueDay ?? 5,
      dueDate: e.dueDate ?? defaultDate,
      active: e.active,
    };
  }
  return {
    description: '',
    category: EXPENSE_CATEGORIES[0],
    amount: 0,
    kind: 'FIXED',
    dueDay: 5,
    dueDate: defaultDate,
    active: true,
  };
}

/**
 * Modal de criar / editar despesa (Task 8). `active` NUNCA é editável aqui —
 * ativar/desativar uma regra fixa é uma ação de um clique na lista (Switch em
 * `ExpensesTab`), não um campo do form; o valor só é carregado do estado
 * atual (edit) ou default `true` (create) e repassado intacto no submit.
 */
export const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({
  state,
  isSaving,
  defaultDate,
  onClose,
  onSubmit,
}) => {
  const initial = useMemo(() => initialValuesFor(state, defaultDate), [state, defaultDate]);
  const [values, setValues] = useState<ExpenseFormValues>(initial);
  const [formError, setFormError] = useState<string | null>(null);

  const title = state.mode === 'edit' ? 'Editar despesa' : 'Nova despesa';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!values.description.trim()) {
      setFormError('Informe uma descrição.');
      return;
    }
    if (!values.amount || values.amount <= 0) {
      setFormError('O valor deve ser maior que zero.');
      return;
    }
    if (values.kind === 'FIXED' && (values.dueDay < 1 || values.dueDay > 28)) {
      setFormError('Dia de vencimento deve ser entre 1 e 28.');
      return;
    }
    if (values.kind === 'ONE_TIME' && !values.dueDate) {
      setFormError('Informe a data de vencimento.');
      return;
    }

    onSubmit(values);
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <ModalForm onSubmit={handleSubmit}>
        <InputField
          label="Descrição"
          placeholder="Ex: Assinatura Vercel"
          value={values.description}
          onChange={e => setValues(v => ({ ...v, description: e.target.value }))}
        />

        <SelectField
          label="Categoria"
          options={CATEGORY_OPTIONS}
          value={values.category}
          onChange={e => setValues(v => ({ ...v, category: e.target.value }))}
        />

        <InputField
          label="Valor (R$)"
          type="number"
          min={0}
          step="0.01"
          value={values.amount}
          onChange={e => setValues(v => ({ ...v, amount: Number(e.target.value) }))}
        />

        <SelectField
          label="Tipo"
          options={KIND_OPTIONS}
          value={values.kind}
          onChange={e => setValues(v => ({ ...v, kind: e.target.value as ExpenseFormValues['kind'] }))}
          hint="Fixa mensal gera um lançamento todo mês (dia informado). Pontual gera um único lançamento na data."
        />

        {values.kind === 'FIXED' ? (
          <InputField
            label="Dia do vencimento"
            type="number"
            min={1}
            max={28}
            value={values.dueDay}
            onChange={e => setValues(v => ({ ...v, dueDay: Number(e.target.value) }))}
            hint="1 a 28 — evita problemas com meses mais curtos"
          />
        ) : (
          <InputField
            label="Data do vencimento"
            type="date"
            value={values.dueDate}
            onChange={e => setValues(v => ({ ...v, dueDate: e.target.value }))}
          />
        )}

        {formError && (
          <p className="text-sm text-red-500" role="alert">
            {formError}
          </p>
        )}

        <SubmitButton isLoading={isSaving} loadingText="Salvando...">
          {state.mode === 'edit' ? 'Salvar alterações' : 'Criar despesa'}
        </SubmitButton>
      </ModalForm>
    </Modal>
  );
};
