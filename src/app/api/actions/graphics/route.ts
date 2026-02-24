import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { v4 as uuid } from 'uuid';
import { uploadObject } from '@/lib/storage/uploadObject';
import { fileNameToUrl } from '@/lib/storage/fileNameToUrl';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// POST /api/actions/graphics?campaignId=...
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 10, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaignId = z.string().min(1).safeParse(searchParams.get('campaignId'));
    if (!campaignId.success) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId.data,
        org: { managers: { some: { id: session.user.id } } },
      },
      select: { id: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Not authorized to upload graphics for this campaign' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const fileExtension = file.type.split('/')[1];
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `campaigns/${campaignId.data}/actions/graphics-${Date.now()}-${uuid()}.${fileExtension}`;
    await uploadObject(buffer, fileName, fileExtension);

    const uploadedTo = fileNameToUrl(fileName);
    return NextResponse.json({ uploadedTo });
  } catch (error) {
    logError('Error uploading action graphic', error);
    return NextResponse.json({ error: 'Failed to upload graphic' }, { status: 500 });
  }
}
