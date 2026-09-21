import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const schedulePath = path.resolve(process.cwd(), '../configs/schedules.json');
        if (!fs.existsSync(schedulePath)) {
            return NextResponse.json({ error: 'Schedules file not found' }, { status: 404 });
        }
        const data = fs.readFileSync(schedulePath, 'utf8');
        return NextResponse.json(JSON.parse(data));
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
