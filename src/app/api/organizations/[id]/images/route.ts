import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { supabaseAdmin, STORAGE_BUCKETS } from '@/lib/supabase/server';
import { fileNameToUrl } from '@/lib/storage/fileNameToUrl';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

// GET /api/organizations/[id]/images — list all images uploaded by this org
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = z.string().min(1).safeParse(params.id);
    if (!orgId.success) {
      return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 });
    }

    // Verify user is a manager of this org
    const org = await prisma.organization.findFirst({
      where: {
        id: orgId.data,
        managers: { some: { id: session.user.id } },
      },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // List files from both org photos and campaign graphics
    const bucket = STORAGE_BUCKETS.PRIVATE;
    const images: Array<{ name: string; url: string; createdAt: string }> = [];

    // Org-level images (logos, cover images)
    const { data: orgFiles } = await supabaseAdmin.storage.from(bucket).list(`orgs/${orgId.data}`, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (orgFiles) {
      for (const file of orgFiles) {
        if (file.name && !file.name.startsWith('.')) {
          const path = `orgs/${orgId.data}/${file.name}`;
          images.push({
            name: file.name,
            url: fileNameToUrl(path) || '',
            createdAt: file.created_at || '',
          });
        }
      }
    }

    // Campaign graphics — list all campaigns for this org and their graphics
    const campaigns = await prisma.campaign.findMany({
      where: { orgId: orgId.data },
      select: { id: true, name: true },
    });

    const campaignFileResults = await Promise.all(
      campaigns.map(async (campaign) => {
        const { data: campaignFiles } = await supabaseAdmin.storage
          .from(bucket)
          .list(`campaigns/${campaign.id}/actions`, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          });
        return { campaign, files: campaignFiles ?? [] };
      }),
    );

    for (const { campaign, files } of campaignFileResults) {
      for (const file of files) {
        if (file.name && !file.name.startsWith('.')) {
          const path = `campaigns/${campaign.id}/actions/${file.name}`;
          images.push({
            name: `${campaign.name}: ${file.name}`,
            url: fileNameToUrl(path) || '',
            createdAt: file.created_at || '',
          });
        }
      }
    }

    return NextResponse.json({ images });
  } catch (error) {
    logError('Error listing org images', error);
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 });
  }
}
