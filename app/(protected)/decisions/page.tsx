import type { Metadata } from 'next';
import { DecisionQueuePage } from '@/features/decisions/DecisionQueuePage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Decisões | ${APP_NAME}` };

export default function Decisions() {
    return <DecisionQueuePage />
}
