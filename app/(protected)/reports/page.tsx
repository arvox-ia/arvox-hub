import type { Metadata } from 'next';
import ReportsPage from '@/features/reports/ReportsPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Relatórios | ${APP_NAME}` };

export default function Reports() {
    return <ReportsPage />
}
