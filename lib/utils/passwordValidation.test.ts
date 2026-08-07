import { describe, expect, it } from 'vitest';
import { getPasswordRequirements, isPasswordValid } from './passwordValidation';

describe('passwordValidation', () => {
    describe('getPasswordRequirements', () => {
        it('marca todos os requisitos como não atendidos para senha vazia', () => {
            expect(getPasswordRequirements('')).toEqual({
                minLength: false,
                hasLowercase: false,
                hasUppercase: false,
                hasDigit: false,
            });
        });

        it('avalia cada requisito de forma independente', () => {
            expect(getPasswordRequirements('abcdef')).toEqual({
                minLength: true,
                hasLowercase: true,
                hasUppercase: false,
                hasDigit: false,
            });
            expect(getPasswordRequirements('ABCDEF')).toEqual({
                minLength: true,
                hasLowercase: false,
                hasUppercase: true,
                hasDigit: false,
            });
            expect(getPasswordRequirements('12345')).toEqual({
                minLength: false,
                hasLowercase: false,
                hasUppercase: false,
                hasDigit: true,
            });
        });

        it('marca todos os requisitos como atendidos para senha forte', () => {
            expect(getPasswordRequirements('Senha123')).toEqual({
                minLength: true,
                hasLowercase: true,
                hasUppercase: true,
                hasDigit: true,
            });
        });
    });

    describe('isPasswordValid', () => {
        it('rejeita senha vazia', () => {
            expect(isPasswordValid('')).toBe(false);
        });

        it('rejeita senha sem maiúscula', () => {
            expect(isPasswordValid('senha123')).toBe(false);
        });

        it('rejeita senha sem minúscula', () => {
            expect(isPasswordValid('SENHA123')).toBe(false);
        });

        it('rejeita senha sem número', () => {
            expect(isPasswordValid('SenhaForte')).toBe(false);
        });

        it('rejeita senha curta mesmo com todos os tipos de caractere', () => {
            expect(isPasswordValid('Sh1')).toBe(false);
        });

        it('aceita senha que atende a todos os requisitos', () => {
            expect(isPasswordValid('Senha123')).toBe(true);
        });
    });
});
