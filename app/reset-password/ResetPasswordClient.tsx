'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/utils/errorUtils'
import { getPasswordRequirements, isPasswordValid as checkIsPasswordValid } from '@/lib/utils/passwordValidation'
import { Loader2, Lock, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { APP_NAME } from '@/lib/branding'

type Status = 'verifying' | 'ready' | 'invalid' | 'success'

// Tempo de espera pelo evento PASSWORD_RECOVERY antes de considerar o link
// inválido quando a Supabase não devolveu `?error=` explícito (ex.: código
// já consumido silenciosamente).
const RECOVERY_TIMEOUT_MS = 8000

/**
 * Traduz o `error_description` que a Supabase anexa à URL de redirecionamento
 * quando o link de recuperação está expirado, já foi usado ou é inválido.
 * @param {string | null | undefined} description - Descrição bruta vinda da Supabase.
 * @returns {string} Mensagem em pt-BR para o usuário.
 */
function describeLinkError(description?: string | null): string {
    if (description && description.toLowerCase().includes('expired')) {
        return 'Esse link de redefinição expirou. Solicite um novo abaixo.'
    }
    return 'Esse link de redefinição é inválido ou já foi utilizado. Solicite um novo abaixo.'
}

/**
 * Componente React `ResetPasswordClient`.
 *
 * @param {{ errorParam?: string | null; errorDescription?: string | null }} props - Erros vindos da query string do link de recuperação.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export function ResetPasswordClient({
    errorParam,
    errorDescription,
}: {
    errorParam?: string | null
    errorDescription?: string | null
}) {
    const [status, setStatus] = useState<Status>('verifying')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const supabase = createClient()

    const passwordRequirements = getPasswordRequirements(password)
    const isPasswordValid = checkIsPasswordValid(password)
    const passwordsMatch = password === confirmPassword && confirmPassword.length > 0

    useEffect(() => {
        // A Supabase redireciona de volta com `?error=...` quando o link do
        // e-mail já foi usado, expirou ou é inválido — nesse caso nem chega a
        // trocar o código por sessão, então tratamos direto, sem esperar.
        if (errorParam) {
            setStatus('invalid')
            return
        }

        if (!supabase) {
            setStatus('invalid')
            return
        }

        let settled = false

        // Se o link ainda for válido, o cliente Supabase detecta o `code` na
        // URL e troca pela sessão automaticamente, disparando o evento
        // PASSWORD_RECOVERY. Assinamos antes de qualquer espera assíncrona
        // para não perder o evento por condição de corrida.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                settled = true
                setStatus('ready')
            }
        })

        // Rede de segurança: se a troca já tiver acontecido antes desse
        // listener ser registrado, já existe uma sessão válida.
        supabase.auth.getSession().then(({ data }) => {
            if (!settled && data.session) {
                settled = true
                setStatus('ready')
            }
        })

        // Se nada acontecer depois de um tempo razoável, o link provavelmente
        // é inválido sem que a Supabase tenha devolvido `?error=` explícito.
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true
                setStatus('invalid')
            }
        }, RECOVERY_TIMEOUT_MS)

        return () => {
            subscription.unsubscribe()
            clearTimeout(timeout)
        }
    }, [errorParam])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!isPasswordValid) {
            setError('A senha não atende aos requisitos mínimos')
            return
        }

        if (!passwordsMatch) {
            setError('As senhas não coincidem')
            return
        }

        setLoading(true)
        setError(null)

        try {
            if (!supabase) {
                throw new Error('Supabase não configurado. Configure as variáveis de ambiente.')
            }

            const { error: updateError } = await supabase.auth.updateUser({ password })
            if (updateError) throw updateError

            setStatus('success')
            setTimeout(() => router.push('/dashboard'), 1500)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
                <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-primary-800/20 rounded-full blur-[100px]" />
                {/* Marca d'água Arvox */}
                <img
                    src="/brand/arvox-lockup.svg"
                    alt=""
                    aria-hidden="true"
                    className="absolute bottom-10 right-10 w-[400px] max-w-[55vw] opacity-[0.06] select-none"
                />
            </div>

            <div className="max-w-md w-full relative z-10 px-4">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white font-display tracking-tight mb-2">
                        Redefinir senha
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Escolha uma nova senha para sua conta.
                    </p>
                </div>

                <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8 backdrop-blur-sm">
                    {status === 'verifying' && (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-600 dark:text-slate-300">
                            <Loader2 className="animate-spin h-6 w-6 mb-3" />
                            <p className="text-sm">Verificando o link…</p>
                        </div>
                    )}

                    {status === 'invalid' && (
                        <div className="text-center py-2">
                            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                            <p className="text-slate-700 dark:text-slate-200 text-sm">
                                {describeLinkError(errorDescription)}
                            </p>
                            <Link
                                href="/forgot-password"
                                className="mt-6 inline-flex items-center justify-center w-full py-3 px-4 border border-transparent rounded-xl shadow-lg shadow-primary-500/20 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all active:scale-[0.98]"
                            >
                                Solicitar novo link
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                            <Link
                                href="/login"
                                className="mt-4 inline-block text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            >
                                Voltar para o login
                            </Link>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="text-center py-2">
                            <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
                                <Loader2 className="animate-spin h-6 w-6 text-green-500" />
                            </div>
                            <p className="text-slate-700 dark:text-slate-200 text-sm">
                                Senha atualizada! Redirecionando…
                            </p>
                        </div>
                    )}

                    {status === 'ready' && (
                        <form className="space-y-6" onSubmit={handleSubmit}>
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                    Nova senha
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        required
                                        aria-required="true"
                                        aria-describedby="password-requirements"
                                        className="block w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all sm:text-sm"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    >
                                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>

                                {password.length > 0 && (
                                    <div id="password-requirements" className="mt-2 space-y-1">
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Requisitos:</p>
                                        <div className="grid grid-cols-2 gap-1 text-xs">
                                            <span className={passwordRequirements.minLength ? 'text-green-500' : 'text-slate-400'}>
                                                {passwordRequirements.minLength ? '✓' : '○'} Mínimo 6 caracteres
                                            </span>
                                            <span className={passwordRequirements.hasLowercase ? 'text-green-500' : 'text-slate-400'}>
                                                {passwordRequirements.hasLowercase ? '✓' : '○'} Letra minúscula
                                            </span>
                                            <span className={passwordRequirements.hasUppercase ? 'text-green-500' : 'text-slate-400'}>
                                                {passwordRequirements.hasUppercase ? '✓' : '○'} Letra maiúscula
                                            </span>
                                            <span className={passwordRequirements.hasDigit ? 'text-green-500' : 'text-slate-400'}>
                                                {passwordRequirements.hasDigit ? '✓' : '○'} Número
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                    Confirmar nova senha
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <input
                                        id="confirm-password"
                                        name="confirmPassword"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        required
                                        aria-required="true"
                                        aria-invalid={confirmPassword.length > 0 && !passwordsMatch ? 'true' : undefined}
                                        className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-all sm:text-sm ${confirmPassword.length > 0
                                            ? passwordsMatch
                                                ? 'border-green-500 focus:border-green-500'
                                                : 'border-red-500 focus:border-red-500'
                                            : 'border-slate-300 dark:border-slate-700 focus:border-primary-500'
                                            }`}
                                        placeholder="••••••••"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                        aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    >
                                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>

                                {confirmPassword.length > 0 && !passwordsMatch && (
                                    <p className="mt-1 text-xs text-red-500">As senhas não coincidem</p>
                                )}
                                {passwordsMatch && <p className="mt-1 text-xs text-green-500">✓ Senhas coincidem</p>}
                            </div>

                            {error && (
                                <div
                                    role="alert"
                                    aria-live="assertive"
                                    className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm text-center"
                                >
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !isPasswordValid || !passwordsMatch}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-lg shadow-primary-500/20 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin h-5 w-5" />
                                ) : (
                                    <>
                                        Salvar nova senha
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>

                <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
                    &copy; {new Date().getFullYear()} {APP_NAME}. Todos os direitos reservados.
                </p>
            </div>
        </div>
    )
}
