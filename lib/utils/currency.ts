const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formatação única de moeda do app. Não recriar Intl.NumberFormat fora daqui. */
export const formatBRL = (value: number): string => brl.format(value);
