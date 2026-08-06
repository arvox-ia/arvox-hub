import type { Metadata } from 'next';
import { ActivitiesPage } from '@/features/activities/ActivitiesPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Atividades | ${APP_NAME}` };

export default function Activities() {
    return <ActivitiesPage />
}
