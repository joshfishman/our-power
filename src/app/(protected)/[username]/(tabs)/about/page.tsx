import { getProfile } from '../../getProfile';
import { About } from './About';

export async function generateMetadata(props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const profile = await getProfile(params.username);
  return {
    title: `About | ${profile?.name}` || 'About',
  };
}

export default async function Page(props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const profile = await getProfile(params.username);
  if (!profile) return null;

  return (
    <div className="mt-4">
      <About profile={profile} />
    </div>
  );
}
