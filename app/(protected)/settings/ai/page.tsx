import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `IA – Configurações | ${APP_NAME}` };

export default function SettingsAI() {
  return <SettingsPage tab="ai" />
}
