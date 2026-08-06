import type { Metadata } from 'next';
import { ProfilePage } from '@/features/profile/ProfilePage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Perfil | ${APP_NAME}` };

export default function Profile() {
    return <ProfilePage />
}
