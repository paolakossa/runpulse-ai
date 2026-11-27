import type { ReactNode } from 'react';
import AppShell from './app-shell';
import './style.css';

export const metadata = {
  title: 'RunPulse AI — Running analytics',
  description: 'Import, browse, and review privacy-conscious running activity summaries.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
