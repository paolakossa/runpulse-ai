'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const navigation = [
  { href: '/', label: 'Overview', isCurrent: (path: string) => path === '/' },
  { href: '/activities', label: 'Activities', isCurrent: (path: string) => path.startsWith('/activities') },
  { href: '/import', label: 'Import', isCurrent: (path: string) => path.startsWith('/import') },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="page-shell">
      <header className="app-header">
        <Link className="brand" href="/" aria-label="RunPulse AI overview">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>RUNPULSE <span className="brand-divider">/</span> AI</span>
        </Link>
        <nav className="app-navigation" aria-label="Main navigation">
          {navigation.map(item => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.isCurrent(pathname) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
      <footer>Built for thoughtful training. Metrics are descriptive, not medical advice.</footer>
    </div>
  );
}
