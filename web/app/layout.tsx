import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KiteScout — Find Your Perfect Kite Trip',
  description: 'AI-powered search for kite camps, cruises, schools, and rentals worldwide.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased h-full">{children}</body>
    </html>
  );
}
