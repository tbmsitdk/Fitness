import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { streamChat } from '@/lib/ai';
import { Activity, WellnessRecord, ChatMessage } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { messages }: { messages: ChatMessage[] } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const [actResult, wellResult] = await Promise.all([
      sql`SELECT * FROM activities WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT * FROM wellness WHERE date >= ${cutoff} ORDER BY date`,
    ]);

    const activities = actResult.rows as Activity[];
    const wellness = wellResult.rows as WellnessRecord[];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(messages, activities, wellness)) {
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
