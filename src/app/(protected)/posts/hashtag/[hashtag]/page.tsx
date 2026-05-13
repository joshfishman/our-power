import { Posts } from '@/components/Posts';

export default async function Page(props: { params: Promise<{ hashtag: string }> }) {
  const params = await props.params;
  return (
    <div className="px-4 pt-4">
      <h1 className="mb-4 text-4xl font-bold">#{params.hashtag}</h1>
      <Posts type="hashtag" hashtag={params.hashtag} />
    </div>
  );
}
