import type { Metadata } from 'next';
import { MessagingPage } from '@/features/messaging/MessagingPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Mensagens | ${APP_NAME}` };

export default function Messaging() {
    return <MessagingPage />
}
