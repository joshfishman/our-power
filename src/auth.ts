import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import { PrismaAdapter } from '@auth/prisma-adapter';
import prisma from '@/lib/prisma/prisma';
import { sendEmail } from '@/lib/email';
import { logDebug, logError, logWarn } from '@/lib/logger';

declare module 'next-auth' {
  interface Session {
    user: { id: string; name: string };
  }
}

// We are splitting the auth configuration into multiple files (`auth.config.ts` and `auth.ts`),
// as some adapters (Prisma) and Node APIs (`stream` module required for sending emails) are
// not supported in the Edge runtime. More info here: https://authjs.dev/guides/upgrade-to-v5
export const {
  auth,
  handlers: { GET, POST },
  signIn,
} = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    {
      // There's currently an issue with NextAuth that requires all these properties to be specified
      // even if we really only need the `sendVerificationRequest`: https://github.com/nextauthjs/next-auth/issues/8125
      id: 'email',
      type: 'email',
      name: 'Email',
      from: 'noreply@norcio.dev',
      server: {},
      maxAge: 24 * 60 * 60,
      options: {},
      async sendVerificationRequest({ identifier: email, url }) {
        await sendEmail({
          to: email,
          subject: 'Login to Our Power',
          html: `<body style="background-color: #f4f4f5; padding: 40px 0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <tr>
      <td align="center" style="padding: 40px 20px 20px;">
        <h1 style="margin: 0; font-size: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #18181b;">
          Login to <strong style="color: #0284c7;">Our Power</strong>
        </h1>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px;">
        <a href="${url}" target="_blank" style="display: inline-block; background: #0284c7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Sign In
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 40px 40px;">
        <p style="margin: 0; font-size: 14px; color: #71717a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          If you did not request this email, you can safely ignore it.
        </p>
      </td>
    </tr>
  </table>
</body>`,
        });
      },
    },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  // Enable debug mode in development to see detailed OAuth errors
  debug: process.env.NODE_ENV === 'development',
  // Log OAuth errors for debugging
  logger: {
    error(code, ...message) {
      logError('[NextAuth Error]', message, { code });
    },
    warn(code, ...message) {
      logWarn('[NextAuth Warning]', { code, message });
    },
    debug(code, ...message) {
      logDebug('[NextAuth Debug]', { code, message });
    },
  },
  events: {
    async signIn({ user: signedInUser, account }) {
      logDebug('[Auth Event] Sign in', { provider: account?.provider });

      // Auto-assign username if missing (e.g. first OAuth sign-in)
      if (signedInUser?.id) {
        const existing = await prisma.user.findUnique({
          where: { id: signedInUser.id },
          select: { username: true, name: true },
        });
        if (existing && !existing.username) {
          await prisma.user.update({
            where: { id: signedInUser.id },
            data: {
              username: signedInUser.id,
              // Also ensure name is populated from the OAuth provider
              ...(!existing.name && signedInUser.name ? { name: signedInUser.name } : {}),
            },
          });
        }
      }
    },
    async linkAccount({ account }) {
      logDebug('[Auth Event] Account linked', { provider: account?.provider });
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account }) {
      logDebug('[Auth Callback] signIn', { provider: account?.provider });
      return true;
    },
    session({ token, user, ...rest }) {
      return {
        /**
         * We need to explicitly return the `id` here to make it available to the client
         * when calling `useSession()` as NextAuth does not include the user's id.
         *
         * If you only need to get the `id` of the user in the client, use NextAuth's
         * `useSession()`, but if you need more of user's data, use the `useSessionUserData()`
         * custom hook instead.
         */
        user: {
          id: token.sub!,
        },
        expires: rest.session.expires,
      };
    },
  },
});
