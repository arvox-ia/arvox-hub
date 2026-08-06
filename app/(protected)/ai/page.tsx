import type { Metadata } from 'next';
import { AIHubPage } from '@/features/ai-hub/AIHubPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `AI Hub | ${APP_NAME}` };

export default function AIHub() {
    return <AIHubPage />
}
