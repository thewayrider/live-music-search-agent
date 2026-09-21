import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function GET(req: NextRequest) {
    const script = req.nextUrl.searchParams.get('script');
    if (!script) return new Response('Missing script param', { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            const rootDir = path.resolve(process.cwd(), '..');
            const batPath = path.join(rootDir, script);

            controller.enqueue(encoder.encode(`data: Starting ${script}...\n\n`));

            const child = spawn('cmd.exe', ['/c', batPath], { cwd: rootDir });

            child.stdout.on('data', (data) => {
                // Parse chunks and handle newlines for SSE format
                const text = data.toString();
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line !== undefined) {
                        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line !== undefined) {
                        controller.enqueue(encoder.encode(`data: ERROR: ${line}\n\n`));
                    }
                }
            });

            child.on('close', (code) => {
                controller.enqueue(encoder.encode(`data: Process exited with code ${code}\n\n`));
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
            });
            
            child.on('error', (err) => {
                controller.enqueue(encoder.encode(`data: ERROR: Failed to start process - ${err.message}\n\n`));
                controller.close();
            });
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
