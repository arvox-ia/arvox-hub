import type { Metadata } from 'next';
import DashboardPage from '@/features/dashboard/DashboardPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Dashboard | ${APP_NAME}` };

export default function Dashboard() {
    return <DashboardPage />
}
