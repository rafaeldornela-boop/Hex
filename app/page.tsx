import HexWorldGame from '@/components/game/HexWorldGame';

interface HomePageProps {
  searchParams: Promise<{ autostart?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const autostart = params.autostart === '1';
  return <HexWorldGame initialAutostart={autostart} />;
}
