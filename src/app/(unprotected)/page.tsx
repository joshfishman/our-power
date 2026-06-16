import { redirect } from 'next/navigation';

export default async function Page() {
  // TEMPORARY: the Common Ground scorecard is the app homepage for now.
  // To restore the prior behavior, redirect logged-in users to /feed and
  // everyone else to /login (see git history).
  redirect('/scorecard');
}
