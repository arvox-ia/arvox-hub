import type { Metadata } from 'next';
import { ContactsPage } from '@/features/contacts/ContactsPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Contatos | ${APP_NAME}` };

export default function Contacts() {
    return <ContactsPage />
}
