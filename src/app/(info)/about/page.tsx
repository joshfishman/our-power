export const metadata = {
  title: 'About | Our Power',
};

export default function AboutPage() {
  return (
    <article className="prose prose-neutral mx-auto max-w-3xl px-4 py-10 dark:prose-invert sm:px-0">
      <h1>About Our Power</h1>

      <p className="lead">
        Our Power is a civic engagement platform that connects citizens with organizations and campaigns to make
        real-world change through coordinated action.
      </p>

      <h2>Our Mission</h2>
      <p>
        Democracy works best when people participate. Our Power makes it easy for citizens to discover campaigns that
        matter to them, take meaningful action, and see the impact of their collective effort. We believe that organized
        citizens have the power to shape policy, hold leaders accountable, and build the communities they want to live
        in.
      </p>

      <h2>What We Do</h2>
      <p>
        Our Power is a social network built for activism. We provide the tools for organizations to run coordinated
        lobbying campaigns, and for citizens to participate in those campaigns through:
      </p>
      <ul>
        <li>
          <strong>Events</strong> &mdash; Show up at hearings, rallies, town halls, and community meetings.
        </li>
        <li>
          <strong>Phone Banking</strong> &mdash; Call your representatives with guided scripts and integrated dialers.
        </li>
        <li>
          <strong>Email Campaigns</strong> &mdash; Send advocacy emails to elected officials with one click.
        </li>
        <li>
          <strong>Canvassing</strong> &mdash; Go door-to-door to organize your neighbors.
        </li>
      </ul>

      <h2>How It Works</h2>
      <ol>
        <li>
          <strong>Sign up</strong> and tell us about the causes you care about and where you live.
        </li>
        <li>
          <strong>Discover campaigns</strong> that match your interests and location.
        </li>
        <li>
          <strong>Join and take action</strong> &mdash; RSVP for events, make calls, send emails, and canvass.
        </li>
        <li>
          <strong>Track your impact</strong> and share campaigns with your network to grow the movement.
        </li>
      </ol>

      <h2>Open Source</h2>
      <p>
        Our Power is free and open source. We believe the tools of democracy should be transparent, community-owned, and
        available to everyone. Our code is publicly available on{' '}
        <a href="https://github.com/joshfishman/our-power" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        , and we welcome contributions from developers, designers, organizers, and anyone who wants to help build a
        better platform for civic engagement.
      </p>

      <h2>Get Involved</h2>
      <p>
        Whether you are a citizen looking to make a difference, an organization running campaigns, or a developer who
        wants to contribute to the platform, there is a place for you. Check out our{' '}
        <a
          href="https://github.com/joshfishman/our-power/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer">
          Contributing Guide
        </a>{' '}
        to get started.
      </p>
    </article>
  );
}
