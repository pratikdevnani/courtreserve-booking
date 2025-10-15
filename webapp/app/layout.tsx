import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Court Booking Manager',
  description: 'Manage court reservations and booking jobs',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" style={{ backgroundColor: '#111827' }}>
      <body className="bg-gray-900 text-gray-100" style={{ backgroundColor: '#111827', color: '#f3f4f6' }}>
        <div className="min-h-screen bg-gray-900" style={{ backgroundColor: '#111827' }}>
          <nav className="bg-gray-800 shadow-sm border-b border-gray-700" style={{ backgroundColor: '#1f2937' }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex space-x-8">
                  <Link href="/" className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-400 text-sm font-medium text-gray-100">
                    Home
                  </Link>
                  <Link href="/accounts" className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-400 text-sm font-medium text-gray-100">
                    Accounts
                  </Link>
                  <Link href="/reservations" className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-400 text-sm font-medium text-gray-100">
                    Reservations
                  </Link>
                  <Link href="/booking-jobs" className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-400 text-sm font-medium text-gray-100">
                    Booking Jobs
                  </Link>
                </div>
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
