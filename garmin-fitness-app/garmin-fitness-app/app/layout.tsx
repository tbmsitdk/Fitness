import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Garmin Fitness Analytics',
  description: 'Personal fitness analytics powered by your Garmin data and AI coaching',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
