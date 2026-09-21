import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
    try {
        const { id, days, time } = await req.json();
        const schedulePath = path.resolve(process.cwd(), '../configs/schedules.json');
        
        const data = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
        const index = data.findIndex((t: any) => t.id === id);
        
        if (index > -1) {
            data[index].days = days;
            data[index].time = time;
            fs.writeFileSync(schedulePath, JSON.stringify(data, null, 2));
            return NextResponse.json({ success: true, task: data[index] });
        }
        
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
