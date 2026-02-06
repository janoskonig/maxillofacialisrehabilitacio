import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  // Cookie törlése
  response.cookies.delete('auth-token');
  
  return response;
}

