# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-05

### Added

- Social feed with posts, comments, likes, and follows (based on Munia)
- OAuth authentication via Google and Facebook (NextAuth.js v5)
- Email magic link authentication via Resend
- User onboarding wizard with location and cause selection (skippable)
- Organization management: create, edit, delete, add/remove managers
- Campaign creation and management with cause categories and campaign types
- Action system supporting EVENT, PHONE, EMAIL, and CANVASS types
- Server-side email sending for EMAIL actions via Resend
- Phone banking integration (Scale to Win deep-linking)
- Canvassing integration (Ecanvasser REST API)
- Campaign and action dashboards with analytics
- My Campaigns and My Actions pages for citizens
- Action RSVP and completion tracking
- Action reminder cron job
- Database seeding script with sample data
- Security headers, rate limiting utility, and auth guards
- CI pipeline via GitHub Actions (lint, type-check, test, build)
- Pre-commit hooks via Husky + lint-staged
- Open-source documentation (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)

### Security

- Sanitized `.env.example` to contain only placeholder values
- Protected debug endpoint (development-only)
- Fail-closed cron authentication
- Fixed missing `await` on `verifyAccessToPost` authorization check
- Added authorization to dashboard stats and campaign dashboard routes
- Removed email exposure from public organization API responses
