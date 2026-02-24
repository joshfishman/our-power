import prisma from '@/lib/prisma/prisma';
import type { Prisma } from '@/generated/prisma/client';

export async function createCampaign(data: Prisma.CampaignUncheckedCreateInput) {
  return prisma.campaign.create({ data });
}

export async function readCampaign(id: string) {
  return prisma.campaign.findUnique({ where: { id } });
}

export async function updateCampaign(id: string, data: Prisma.CampaignUncheckedUpdateInput) {
  return prisma.campaign.update({ where: { id }, data });
}

export async function deleteCampaign(id: string) {
  return prisma.campaign.delete({ where: { id } });
}

export async function createAction(data: Prisma.ActionUncheckedCreateInput) {
  return prisma.action.create({ data });
}

export async function readAction(id: string) {
  return prisma.action.findUnique({ where: { id } });
}

export async function updateAction(id: string, data: Prisma.ActionUncheckedUpdateInput) {
  return prisma.action.update({ where: { id }, data });
}

export async function deleteAction(id: string) {
  // Action deletion is modeled as soft delete to preserve participation history.
  return prisma.action.update({ where: { id }, data: { isActive: false } });
}

export async function createPost(data: Prisma.PostUncheckedCreateInput) {
  return prisma.post.create({ data });
}

export async function readPost(id: number) {
  return prisma.post.findUnique({ where: { id } });
}

export async function updatePost(id: number, data: Prisma.PostUncheckedUpdateInput) {
  return prisma.post.update({ where: { id }, data });
}

export async function deletePost(id: number) {
  return prisma.post.delete({ where: { id } });
}

export async function updateCampaignMemberRole(
  campaignId: string,
  userId: string,
  role: 'MEMBER' | 'ORGANIZER' | 'ADMIN',
) {
  return prisma.campaignMember.update({
    where: { userId_campaignId: { userId, campaignId } },
    data: { role },
  });
}

export async function deleteUserAccount(userId: string) {
  return prisma.user.delete({ where: { id: userId } });
}
