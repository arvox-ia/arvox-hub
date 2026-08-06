import type { Metadata } from 'next';
import { BoardsPage } from '@/features/boards/BoardsPage'
import { APP_NAME } from '@/lib/branding'

export const metadata: Metadata = { title: `Funis | ${APP_NAME}` };

export default function Boards() {
    return <BoardsPage />
}
