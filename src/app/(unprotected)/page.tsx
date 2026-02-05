import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/getServerUser';

export default async function Page() {
  const [user] = await getServerUser();

  if (user) {
    // Logged in users go to feed
    redirect('/feed');
  } else {
    // Not logged in users go to login
    redirect('/login');
  }
}
