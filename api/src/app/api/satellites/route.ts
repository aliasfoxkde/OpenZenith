import { NextRequest, NextResponse } from 'next/server';
import { cachedFetch } from '@/lib/cache';

export const runtime = 'edge';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_TTL_SATS = 300;

const VALID_GROUPS = new Set([
  'active',
  'visual',
  'weather',
  'military',
  'science',
  'communication',
  'navigation',
  'stations',
  'space-station',
  'gnss',
  'resource',
  'radar',
  'cubesats',
  'education',
  'amateur',
  'engineering',
  'geodetic',
  'disaster',
  'earth-observation',
  'maritime',
  'positioning',
  'experiment',
  'brasil',
  'china',
  'eur-metop',
  'glo-iridium',
  'iridium',
  'iridium-NEXT',
  'musson',
  'orbcomm',
  'sarsat',
  'spire',
  'starlink',
  'swarm',
  'globalstar',
  'oneweb',
  'other-comm',
]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group') || 'active';

  if (!VALID_GROUPS.has(group)) {
    return NextResponse.json(
      { error: `Invalid group. Common: ${[...VALID_GROUPS].slice(0, 10).join(', ')}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
    const resp = await cachedFetch(url, CACHE_TTL_SATS, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'OpenZenith/1.0' },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Celestrak returned ${resp.status}` },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data, {
      headers: { ...CORS_HEADERS, 'Cache-Control': `public, max-age=${CACHE_TTL_SATS}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Satellite data fetch failed';
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
