import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: { default: 'Timesplit', template: '%s · Timesplit' },
  description: 'Rent timeshare weeks directly from verified owners.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
