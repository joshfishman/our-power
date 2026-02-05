# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Our Power, please report it responsibly:

1. **Do NOT** open a public GitHub issue.
2. Email your findings to the project maintainers (see the repository's contact information).
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

The following are in scope for security reports:

- Authentication and authorization bypasses
- Data exposure or leakage
- Injection vulnerabilities (SQL, XSS, etc.)
- Privilege escalation
- Secret/credential exposure

## Security Practices

This project follows these security practices:

- **Authentication**: NextAuth.js with OAuth2 providers (Google, Facebook)
- **Authorization**: Role-based access control for organizations and campaigns
- **Input Validation**: Zod schemas on all API endpoints
- **Database**: Prisma ORM (no raw SQL queries)
- **Secrets**: Environment variables only, never committed to source control
- **Headers**: Security headers configured (X-Frame-Options, CSP, etc.)
- **Dependencies**: Regular dependency audits via `npm audit`

## Supported Versions

Only the latest version of Our Power is actively maintained and receives security updates.
