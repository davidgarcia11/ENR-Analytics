import { NextResponse } from 'next/server';
import { getAllScreensConfig } from '@/lib/permissions';

export async function GET() {
  const config = getAllScreensConfig();
  return NextResponse.json(config);
}
