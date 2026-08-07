/**
 * Requisitos mínimos de senha usados em qualquer fluxo que define/redefine
 * a senha do usuário (setup inicial da instância, redefinição de senha).
 *
 * Mantido em um único lugar para que o wizard de setup e a tela de
 * redefinição de senha nunca fiquem com regras divergentes.
 */
export interface PasswordRequirements {
    minLength: boolean;
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasDigit: boolean;
}

/**
 * Calcula quais requisitos de senha uma senha candidata já atende.
 * @param {string} password - Senha candidata.
 * @returns {PasswordRequirements} Mapa de requisito → atendido ou não.
 */
export function getPasswordRequirements(password: string): PasswordRequirements {
    return {
        minLength: password.length >= 6,
        hasLowercase: /[a-z]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
        hasDigit: /\d/.test(password),
    };
}

/**
 * Diz se uma senha candidata atende a todos os requisitos mínimos.
 * @param {string} password - Senha candidata.
 * @returns {boolean} `true` se todos os requisitos forem atendidos.
 */
export function isPasswordValid(password: string): boolean {
    return Object.values(getPasswordRequirements(password)).every(Boolean);
}
