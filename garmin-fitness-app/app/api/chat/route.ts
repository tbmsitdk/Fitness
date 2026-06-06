import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { streamChat } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { ChatMessage } from '@/types';
import type { UserSettings } from '@/lib/settings';

export async function POST(request: NextRequest) {
  try {
    const { messages, settings }: { messages: ChatMessage[]; settings?: UserSettings } = await request.json();


    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const [actResult, wellResult, ftpResult] = await Promise.all([
      sql`SELECT * FROM activities WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT * FROM wellness WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    ]);

    const activities = actResult.rows.map(coerceActivity);
    const wellness = wellResult.rows.map(coerceWellness);
    const manualFtpWatts: number | null = ftpResult.rows[0]?.ftp_watts ? Number(ftpResult.rows[0].ftp_watts) : null;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(messages as Parameters<typeof streamChat>[0], activities, wellness, settings, manualFtpWatts)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
