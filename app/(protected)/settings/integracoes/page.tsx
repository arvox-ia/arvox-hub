import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Integrações | ${APP_NAME}` };

export default function SettingsIntegracoes() {
  return <SettingsPage tab="integrations" />
}
