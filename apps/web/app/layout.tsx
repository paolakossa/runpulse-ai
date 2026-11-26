import type { ReactNode } from 'react';
import './style.css';

export const metadata = {
  title: 'RunPulse AI — Every run tells a story',
  description: 'Import a GPX activity for a clear, privacy-conscious running summary.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
