export async function getNotificationsCount({ userId }: { userId: string }) {
  const res = await fetch(`/api/users/${userId}/notifications/count`);

  if (!res.ok) return 0;

  const count = await res.json().catch(() => 0);
  return typeof count === 'number' ? count : 0;
}
