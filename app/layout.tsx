import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import GlobalErrorHandler from '@/components/GlobalErrorHandler'
import { FeedbackProvider } from '@/components/FeedbackContext'
import { FeedbackModal } from '@/components/FeedbackButton'
import { ToastProvider } from '@/contexts/ToastContext'
import { ToastContainer } from '@/components/ToastContainer'
import { SocketProvider } from '@/contexts/SocketContext'
import PWARegister from '@/components/PWARegister'

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  fallback: ['system-ui', 'arial']
})

export const metadata: Metadata = {
  applicationName: "MaxRehab",
  title: "Maxillofaciális Rehabilitáció",
  description: "Professzionális betegadat gyűjtő rendszer",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MaxRehab"
  },
  other: {
    "mobile-web-app-capable": "yes"
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
}

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
}

// Ne próbálja a build statikusan generálni az oldalakat (cookies/auth miatt sok route dinamikus)
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="hu">
      <body className={inter.className}>
        <ErrorBoundary>
          <SocketProvider>
            <ToastProvider>
              <FeedbackProvider>
                <GlobalErrorHandler />
                {children}
                <FeedbackModal />
                <ToastContainer />
                <PWARegister />
              </FeedbackProvider>
            </ToastProvider>
          </SocketProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}