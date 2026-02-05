# Environment Variables Setup Guide

This guide explains where to get each environment variable for Our Power.

---

## 1. Supabase (Database + Storage)

**Where:** https://supabase.com

### Steps:

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Choose organization, name it "our-power", set a database password
4. Wait for project to provision (~2 minutes)

### Get Your Variables:

| Variable                        | Where to Find                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Settings > Database > Connection string > URI (use "Transaction" mode for production) |
| `DIRECT_URL`                    | Settings > Database > Connection string > URI (use "Session" mode)                    |
| `NEXT_PUBLIC_SUPABASE_URL`      | Settings > API > Project URL                                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings > API > anon public key                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Settings > API > service_role key (keep secret!)                                      |

### Storage Buckets:

1. Go to Storage in sidebar
2. Create bucket: `campaign-assets` (Public)
3. Create bucket: `user-uploads` (Private)

---

## 2. Google OAuth

**Where:** https://console.cloud.google.com

### Steps:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Go to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth client ID"
5. Select "Web application"
6. Add Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-domain.com/api/auth/callback/google` (production)
7. Copy Client ID and Client Secret

| Variable             | Value               |
| -------------------- | ------------------- |
| `AUTH_GOOGLE_ID`     | OAuth Client ID     |
| `AUTH_GOOGLE_SECRET` | OAuth Client Secret |

---

## 3. Facebook OAuth

**Where:** https://developers.facebook.com

### Steps:

1. Go to [Facebook Developers](https://developers.facebook.com)
2. Create new app > Select "Consumer" type
3. Add "Facebook Login" product
4. Go to Facebook Login > Settings
5. Add Valid OAuth Redirect URIs:
   - `http://localhost:3000/api/auth/callback/facebook` (development)
   - `https://your-domain.com/api/auth/callback/facebook` (production)
6. Go to Settings > Basic to get App ID and App Secret

| Variable               | Value      |
| ---------------------- | ---------- |
| `AUTH_FACEBOOK_ID`     | App ID     |
| `AUTH_FACEBOOK_SECRET` | App Secret |

---

## 4. Instagram OAuth

**Where:** https://developers.facebook.com (same as Facebook)

### Steps:

1. In your Facebook app, add "Instagram Basic Display" product
2. Go to Instagram Basic Display > Basic Display
3. Add OAuth Redirect URIs:
   - `http://localhost:3000/api/auth/callback/instagram` (development)
   - `https://your-domain.com/api/auth/callback/instagram` (production)
4. Get Instagram App ID and Instagram App Secret

| Variable                | Value                |
| ----------------------- | -------------------- |
| `AUTH_INSTAGRAM_ID`     | Instagram App ID     |
| `AUTH_INSTAGRAM_SECRET` | Instagram App Secret |

**Note:** Instagram requires app review for production. For development, add yourself as a test user.

---

## 5. NextAuth Configuration

| Variable      | Value                                                |
| ------------- | ---------------------------------------------------- |
| `URL`         | Your app URL (e.g., `http://localhost:3000` for dev) |
| `AUTH_URL`    | Same as URL                                          |
| `AUTH_SECRET` | Generate with: `openssl rand -base64 32`             |

---

## 6. Phase II - Ecanvasser (Canvassing)

**Where:** https://www.ecanvasser.com

### Steps:

1. Sign up at [ecanvasser.com](https://www.ecanvasser.com)
2. Email support@ecanvasser.com to request API access
3. Once enabled: Account Settings > Public API > Generate API key

| Variable             | Value                           |
| -------------------- | ------------------------------- |
| `ECANVASSER_API_KEY` | Your API key from Ecanvasser    |
| `ECANVASSER_API_URL` | `https://api.ecanvasser.com/v1` |

---

## 7. Phase II - Phone Banking

### Scale to Win

**Where:** https://www.scaletowin.com

| Variable                | Value                                         |
| ----------------------- | --------------------------------------------- |
| `SCALE_TO_WIN_BASE_URL` | Your campaign URL from Scale to Win dashboard |

### GetThru

**Where:** https://www.getthru.io

| Variable           | Value                                    |
| ------------------ | ---------------------------------------- |
| `GETTHRU_BASE_URL` | Your campaign URL from GetThru dashboard |

---

## Quick Start Checklist

- [ ] Create Supabase project
- [ ] Copy DATABASE_URL and other Supabase vars
- [ ] Create storage buckets (`campaign-assets` public, `user-uploads` private)
- [ ] Set up Google OAuth app
- [ ] Set up Facebook OAuth app
- [ ] Set up Instagram OAuth (optional for MVP)
- [ ] Generate AUTH_SECRET: `openssl rand -base64 32`
- [ ] Generate CRON_SECRET: `openssl rand -base64 32`
- [ ] Copy `.env.example` to `.env.local`
- [ ] Fill in all values in `.env.local`
- [ ] Run `npm install --legacy-peer-deps`
- [ ] Run `npx prisma migrate dev`
- [ ] Run `npx prisma db seed` (seeds causes, sample orgs, campaigns, and actions)
- [ ] Run `npm run dev`

> **Important**: Never commit `.env.local` or any file containing real credentials.
> The `.env.example` file contains only placeholder values and is safe to commit.

---

## Troubleshooting

### "Invalid redirect URI" errors

- Make sure your redirect URIs exactly match (including trailing slashes)
- For local dev, use `http://localhost:3000` not `http://127.0.0.1:3000`

### Database connection issues

- Use the "Transaction" pooler connection string for `DATABASE_URL`
- Use the "Session" connection string for `DIRECT_URL` (needed for migrations)

### OAuth not working in production

- Update all redirect URIs to your production domain
- Facebook/Instagram require app review for public access
