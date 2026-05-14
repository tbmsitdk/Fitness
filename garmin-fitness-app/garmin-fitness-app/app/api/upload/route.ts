import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';

// This route handles only the client upload token exchange.
// The actual file goes directly from the browser to Vercel Blob,
// bypassing the 4.5 MB serverless function body limit.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['application/zip', 'application/x-zip-compressed'],
        maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
        tokenPayload: pathname,
      }),
      onUploadCompleted: async ({ blob }) => {
        // Intentionally empty — processing is triggered by the client
        // calling /api/process after this upload resolves
        console.log('Blob uploaded:', blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
