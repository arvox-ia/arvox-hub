import type { Metadata } from 'next';
import { InboxPage } from '@/features/inbox/InboxPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Inbox | ${APP_NAME}` };

export default function Inbox() {
    return <InboxPage />
}
