import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hexagon World — Guia & Preparação Godot',
  description:
    'Inspeção completa, documentação inicial (README e ROADMAP) e pacote independente pronto para GitHub do projeto de aprendizado em Godot baseado no Starter-Kit-Hexagon-World.',
  openGraph: {
    title: 'Hexagon World — Guia & Preparação Godot',
    description:
      'Inspeção completa, documentação inicial (README e ROADMAP) e pacote independente pronto para GitHub do Starter-Kit-Hexagon-World.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hexagon World — Guia & Preparação Godot',
    description:
      'Inspeção completa, documentação inicial (README e ROADMAP) e pacote independente pronto para GitHub do Starter-Kit-Hexagon-World.',
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
