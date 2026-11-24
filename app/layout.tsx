import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#9bd2ee',
};

export const metadata: Metadata = {
  title: 'Hexagon World — Construtor 3D',
  description:
    'Construtor 3D de mundos hexagonais com 72 peças originais, controles táteis para celular e desktop, e documentação do Starter-Kit-Hexagon-World.',
  openGraph: {
    title: 'Hexagon World — Construtor 3D',
    description:
      'Construtor 3D de mundos hexagonais com 72 peças originais, controles táteis para celular e desktop, e documentação do Starter-Kit-Hexagon-World.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hexagon World — Construtor 3D',
    description:
      'Construtor 3D de mundos hexagonais com 72 peças originais, controles táteis para celular e desktop, e documentação do Starter-Kit-Hexagon-World.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        suppressHydrationWarning
        className="font-sans bg-slate-50 text-slate-900 antialiased selection:bg-emerald-100 selection:text-emerald-950"
      >
        {children}
      </body>
    </html>
  );
}
