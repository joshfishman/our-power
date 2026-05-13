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

// POST /api/organizations/[id]/photo?type=logo|image
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 10, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = z.string().min(1).safeParse(params.id);
    if (!organizationId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const photoType = searchParams.get('type') || 'logo';
    if (photoType !== 'logo' && photoType !== 'image') {
      return NextResponse.json({ error: 'type must be "logo" or "image"' }, { status: 400 });
    }

    // Verify user is a manager of this org
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId.data,
        managers: { some: { id: session.user.id } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized to manage this organization' }, { status: 403 });
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
    const fileName = `orgs/${organizationId.data}/${photoType}-${Date.now()}-${uuid()}.${fileExtension}`;
    await uploadObject(buffer, fileName, fileExtension);

    const field = photoType === 'logo' ? 'logoUrl' : 'imageUrl';
    await prisma.organization.update({
      where: { id: organizationId.data },
      data: { [field]: fileName },
    });

    const uploadedTo = fileNameToUrl(fileName);
    return NextResponse.json({ uploadedTo, field });
  } catch (error) {
    logError('Error uploading org photo', error);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
}
