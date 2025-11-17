import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import GlobalErrorHandler from '@/components/GlobalErrorHandler'
import FeedbackButton from '@/components/FeedbackButton'
import { ToastProvider } from '@/contexts/ToastContext'
import { ToastContainer } from '@/components/ToastContainer'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Maxillofaciális Rehabilitáció - Betegadat Gyűjtés',
  description: 'Professzionális betegadat gyűjtő rendszer maxillofaciális rehabilitációhoz',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="hu">
      <body className={inter.className}>
        <ErrorBoundary>
          <ToastProvider>
            <GlobalErrorHandler />
            {children}
            <FeedbackButton />
            <ToastContainer />
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}