import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendNewAppointmentRequestToAdmin, sendConditionalAppointmentRequestToPatient } from '@/lib/email';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

/**
 * Request a new appointment (via email link)
 * This endpoint is no longer available - patients can only approve or reject appointments
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  return new NextResponse(`
    <!DOCTYPE html>
    <html lang="hu">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Opció nem elérhető</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background-color: #f5f5f5;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 500px;
        }
        h1 { color: #ef4444; }
        p { color: #6b7280; line-height: 1.6; }
        a {
          color: #2563eb;
          text-decoration: none;
          font-weight: bold;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✗ Opció nem elérhető</h1>
        <p>Ez az opció már nem elérhető.</p>
        <p>Az időpontot csak elfogadni vagy elutasítani lehet.</p>
        <p>Ha új időpontot szeretne, kérjük, lépjen kapcsolatba velünk emailben:</p>
        <p style="margin: 20px 0;"><a href="mailto:konig.janos@semmelweis.hu">konig.janos@semmelweis.hu</a></p>
      </div>
    </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// Disabled - keeping old code for reference but it's not used anymore
/*
export async function GET_OLD(request: NextRequest) {
  ...
}
*/
