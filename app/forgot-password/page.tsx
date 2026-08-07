'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Mail, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { APP_NAME } from '@/lib/branding'

// Mensagem neutra: NUNCA revela se o e-mail existe ou não na base.
// É exibida tanto quando o envio funciona quanto quando o Supabase retorna
// um erro que não seja de rede/configuração (ex.: rate limit), para não dar
// a um atacante um jeito de enumerar contas cadastradas.
const NEUTRAL_SUCCESS_MESSAGE =
    'Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha.'

/**
 * Componente React `ForgotPasswordPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const supabase = createClient()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            if (!supabase) {
                throw new Error('not-configured')
            }

            const appUrl =
                process.env.NEXT_PUBLIC_APP_URL ||
                (typeof window !== 'undefined' ? window.location.origin : '')

            // O resultado desta chamada (erro incluído) não deve mudar o que
            // mostramos ao usuário: o Supabase por padrão não erra quando o
            // e-mail não existe, mas outras respostas de erro (rate limit,
            // etc.) também não podem virar sinal de "conta existe". Só as
            // exceções tratadas abaixo (rede/config) recebem uma mensagem
            // diferente da neutra.
            await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${appUrl}/reset-password`,
            })
            setSubmitted(true)
        } catch (err) {
            if (err instanceof Error && err.message === 'not-configured') {
                setError('Supabase não configurado. Configure as variáveis de ambiente.')
            } else if (err instanceof TypeError) {
                // Falha de rede (ex.: fetch falhou por estar offline) — aqui sim
                // vale avisar, já que não tem relação com a existência da conta.
                setError('Não foi possível conectar. Verifique sua internet e tente novamente.')
            } else {
                // Qualquer outro erro do lado da Supabase: mantém o comportamento
                // neutro para não vazar informação sobre a conta.
                setSubmitted(true)
            }
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
                        Esqueceu sua senha?
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Informe seu e-mail e enviaremos um link para redefinir sua senha.
                    </p>
                </div>

                <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8 backdrop-blur-sm">
                    {submitted ? (
                        <div className="text-center py-2">
                            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                            <p className="text-slate-700 dark:text-slate-200 text-sm">
                                {NEUTRAL_SUCCESS_MESSAGE}
                            </p>
                            <Link
                                href="/login"
                                className="mt-6 inline-flex items-center text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                            >
                                <ArrowLeft className="mr-1.5 h-4 w-4" />
                                Voltar para o login
                            </Link>
                        </div>
                    ) : (
                        <form className="space-y-6" onSubmit={handleSubmit}>
                            <div>
                                <label
                                    htmlFor="email-address"
                                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                                >
                                    Email
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Mail className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <input
                                        id="email-address"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        aria-required="true"
                                        aria-describedby={error ? 'forgot-password-error' : undefined}
                                        className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all sm:text-sm"
                                        placeholder="seu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div
                                    id="forgot-password-error"
                                    role="alert"
                                    aria-live="polite"
                                    className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm text-center"
                                >
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-lg shadow-primary-500/20 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin h-5 w-5" />
                                ) : (
                                    <>
                                        Enviar link
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </button>

                            <Link
                                href="/login"
                                className="flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            >
                                <ArrowLeft className="mr-1.5 h-4 w-4" />
                                Voltar para o login
                            </Link>
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
