import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KiteScout Cruises — Find Your Kite Cruise',
  description: 'Discover kite cruises & liveaboards worldwide. Search a destination and swipe to shortlist providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased h-full">{children}</body>
    </html>
  );
}
