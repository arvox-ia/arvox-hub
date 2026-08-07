import { Suspense } from 'react'
import { ResetPasswordClient } from './ResetPasswordClient'

/**
 * Componente React `ResetPasswordPage`.
 *
 * @param {{ searchParams?: Promise<{ error?: string; error_description?: string }> }} { searchParams } - Parâmetro `{ searchParams }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string | string[]; error_description?: string | string[] }>
}) {
  const params = await searchParams

  const errorParam = typeof params?.error === 'string' ? params.error : Array.isArray(params?.error) ? params?.error?.[0] ?? null : null
  const errorDescription =
    typeof params?.error_description === 'string'
      ? params.error_description
      : Array.isArray(params?.error_description)
        ? params?.error_description?.[0] ?? null
        : null

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Carregando...</p>
        </div>
      </div>
    }>
      <ResetPasswordClient errorParam={errorParam} errorDescription={errorDescription} />
    </Suspense>
  )
}
