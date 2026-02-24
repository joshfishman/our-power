export const metadata = {
  title: 'Help | Our Power',
};

export default function HelpPage() {
  return (
    <article className="prose prose-neutral mx-auto max-w-3xl px-4 py-10 dark:prose-invert sm:px-0">
      <h1>Help Center</h1>
      <p className="lead">Quick guidance for getting started with campaigns, actions, and impact tracking.</p>

      <h2>Getting Started</h2>
      <ol>
        <li>Complete setup with your location and preferred causes.</li>
        <li>Browse active campaigns and join one that matches your interests.</li>
        <li>Open action cards to RSVP, complete tasks, and track participation.</li>
      </ol>

      <h2>Common Actions</h2>
      <ul>
        <li>
          <strong>Join a campaign:</strong> visit <code>/campaigns</code>, open a campaign, and click{' '}
          <em>Join Campaign</em>.
        </li>
        <li>
          <strong>Create a campaign:</strong> go to <code>/campaigns/create</code> (organization managers only).
        </li>
        <li>
          <strong>Create campaign actions:</strong> open a campaign you manage and use <em>Add Action</em>.
        </li>
        <li>
          <strong>Track notifications:</strong> review updates in <code>/notifications</code>.
        </li>
      </ul>

      <h2>Troubleshooting</h2>
      <ul>
        <li>If you cannot create campaigns, confirm you are a manager of an organization.</li>
        <li>If representative lookup fails, update your street address and zip code.</li>
        <li>If action status seems stale, refresh the page after sending email/canvass actions.</li>
      </ul>
    </article>
  );
}
