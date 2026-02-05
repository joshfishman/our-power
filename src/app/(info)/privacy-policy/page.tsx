export const metadata = {
  title: 'Privacy Policy | Our Power',
};

export default function PrivacyPolicyPage() {
  return (
    <article className="prose prose-neutral mx-auto max-w-3xl px-4 py-10 dark:prose-invert sm:px-0">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 4, 2026</p>

      <h2>1. Introduction</h2>
      <p>
        Our Power (&quot;we&quot;, &quot;us&quot;, or &quot;the Platform&quot;) is committed to protecting your privacy.
        This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our
        civic engagement platform.
      </p>

      <h2>2. Information We Collect</h2>

      <h3>2.1 Information You Provide</h3>
      <ul>
        <li>
          <strong>Account Information:</strong> Name, email address, and profile photo (provided via social login
          through Google, Facebook, or email).
        </li>
        <li>
          <strong>Profile Information:</strong> Username, bio, location (zip code), and causes/interests you select
          during onboarding.
        </li>
        <li>
          <strong>Campaign Activity:</strong> Campaigns you join, actions you participate in, RSVP status, and
          participation records.
        </li>
        <li>
          <strong>User-Generated Content:</strong> Posts, comments, images, videos, and other content you share on the
          Platform.
        </li>
        <li>
          <strong>Optional Contact Information:</strong> Phone number and street address, if you choose to provide them.
        </li>
      </ul>

      <h3>2.2 Information Collected Automatically</h3>
      <ul>
        <li>
          <strong>Log Data:</strong> IP address, browser type, pages visited, time spent, and referring URLs.
        </li>
        <li>
          <strong>Device Information:</strong> Device type, operating system, and unique device identifiers.
        </li>
        <li>
          <strong>Cookies:</strong> We use cookies and similar technologies for authentication, session management, and
          analytics.
        </li>
      </ul>

      <h3>2.3 Information from Third Parties</h3>
      <p>
        When you sign in through a social login provider (Google, Facebook), we receive basic profile information (name,
        email, profile image) as authorized by you through that provider.
      </p>

      <h2>3. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, maintain, and improve the Platform.</li>
        <li>Create and manage your account.</li>
        <li>Connect you with relevant campaigns and actions based on your location and interests.</li>
        <li>Send notifications about campaign updates, action reminders, and Platform announcements.</li>
        <li>
          Facilitate advocacy actions (e.g., sending emails to elected officials on your behalf when you initiate such
          actions).
        </li>
        <li>Generate aggregated, anonymized analytics and impact dashboards for campaign organizers.</li>
        <li>Enforce our Terms of Service and protect the Platform.</li>
        <li>Respond to your requests and provide support.</li>
      </ul>

      <h2>4. How We Share Your Information</h2>
      <p>We do not sell your personal information. We may share data with:</p>
      <ul>
        <li>
          <strong>Campaign Organizers:</strong> When you join a campaign, organizers may see your name and participation
          status. They do not receive your email address or contact details unless you choose to share them.
        </li>
        <li>
          <strong>Advocacy Targets:</strong> When you send an advocacy email through the Platform, the recipient (e.g.,
          an elected official) will see your name as the sender.
        </li>
        <li>
          <strong>Service Providers:</strong> We use trusted third-party services for hosting (Vercel), database
          (Supabase), email delivery (Resend), and authentication (NextAuth.js). These providers only access data
          necessary to perform their services and are bound by their own privacy policies.
        </li>
        <li>
          <strong>Third-Party Integrations:</strong> If you use integrated tools (e.g., phone banking or canvassing),
          relevant participation data may be shared with those services as described at the time of use.
        </li>
        <li>
          <strong>Legal Requirements:</strong> We may disclose information if required by law, regulation, legal
          process, or governmental request.
        </li>
      </ul>

      <h2>5. Data Retention</h2>
      <p>
        We retain your personal information for as long as your account is active or as needed to provide you with our
        services. If you delete your account, we will delete or anonymize your personal data within 30 days, except
        where retention is required by law.
      </p>

      <h2>6. Data Security</h2>
      <p>We implement industry-standard security measures to protect your information, including:</p>
      <ul>
        <li>Encrypted data transmission (HTTPS/TLS).</li>
        <li>Secure authentication via OAuth 2.0.</li>
        <li>Rate limiting to prevent abuse.</li>
        <li>Security headers to protect against common web vulnerabilities.</li>
        <li>Regular security reviews of our codebase.</li>
      </ul>
      <p>
        However, no method of electronic transmission or storage is 100% secure. We cannot guarantee absolute security.
      </p>

      <h2>7. Your Rights and Choices</h2>
      <p>You have the right to:</p>
      <ul>
        <li>
          <strong>Access:</strong> Request a copy of the personal data we hold about you.
        </li>
        <li>
          <strong>Correction:</strong> Update or correct inaccurate information through your profile settings.
        </li>
        <li>
          <strong>Deletion:</strong> Delete your account and associated data at any time.
        </li>
        <li>
          <strong>Opt-Out of Notifications:</strong> Manage your notification preferences in your account settings.
        </li>
        <li>
          <strong>Data Portability:</strong> Request your data in a portable format.
        </li>
      </ul>

      <h2>8. California Privacy Rights (CCPA)</h2>
      <p>If you are a California resident, you have the right to:</p>
      <ul>
        <li>Know what personal information is being collected about you.</li>
        <li>Know whether your personal information is sold or disclosed and to whom.</li>
        <li>Say no to the sale of personal information (we do not sell data).</li>
        <li>Access your personal information.</li>
        <li>Request deletion of your personal information.</li>
        <li>Not be discriminated against for exercising your privacy rights.</li>
      </ul>

      <h2>9. Children&apos;s Privacy</h2>
      <p>
        The Platform is not intended for children under 13 years of age. We do not knowingly collect personal
        information from children under 13. If we learn that we have collected such information, we will take steps to
        delete it promptly.
      </p>

      <h2>10. Cookies and Tracking</h2>
      <p>We use the following types of cookies:</p>
      <ul>
        <li>
          <strong>Essential Cookies:</strong> Required for authentication and core Platform functionality.
        </li>
        <li>
          <strong>Analytics Cookies:</strong> Help us understand how users interact with the Platform so we can improve
          it.
        </li>
      </ul>
      <p>
        You can manage cookie preferences through your browser settings. Note that disabling essential cookies may
        prevent you from using the Platform.
      </p>

      <h2>11. Open Source</h2>
      <p>
        Our Power is open-source software. Our codebase is publicly available for review on GitHub. This transparency
        allows the community to verify how we handle user data. However, instance-specific data (your account, posts,
        campaign participation) is stored securely and is not part of the open-source codebase.
      </p>

      <h2>12. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of material changes by posting the
        updated policy on this page and updating the &quot;Last updated&quot; date. We encourage you to review this
        policy periodically.
      </p>

      <h2>13. Contact Us</h2>
      <p>
        If you have questions or concerns about this Privacy Policy or our data practices, please contact us at{' '}
        <a href="mailto:privacy@ourpower.app">privacy@ourpower.app</a>.
      </p>
    </article>
  );
}
