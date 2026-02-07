# Our Power Roadmap (Campaigns Focus)

This roadmap prioritizes shipping a stable, secure core before expanding features. It is organized into milestones with data model changes, API endpoints, and UI scope.

## Guiding principles

- Improve reliability and security before adding new surface area
- Prefer incremental improvements over large rewrites
- Keep campaign + action flow intuitive for organizers and members

---

## Milestone 1 — Campaign lifecycle improvements

### Goals

- Draft → review → publish flow
- Template-based creation and cloning

### Data model changes

- Add to `Campaign`:
  - `publishedAt: DateTime?`
  - `submittedAt: DateTime?`
  - `reviewedAt: DateTime?`
  - `reviewedById: String?` (FK to User)
  - `visibility: enum (PUBLIC | UNLISTED | PRIVATE)`

### API endpoints

- `POST /api/campaigns/[id]/submit` — submit campaign for review
- `POST /api/campaigns/[id]/publish` — publish after review
- `POST /api/campaigns/[id]/clone` — clone campaign template
- `GET /api/campaigns/templates` — list templates

### UI scope

- Draft banner + “Submit for review” CTA
- Review screen for org managers
- Template picker in campaign creation

---

## Milestone 2 — Action participation + reminders

### Goals

- RSVP + attendance tracking
- Calendar integration (ICS)
- Reminder scheduling UI

### Data model changes

- Add to `ActionParticipation`:
  - `rsvpStatus: enum (GOING | MAYBE | NOT_GOING)`
  - `reminderOptIn: Boolean`
- Add to `Action`:
  - `reminderOffsetMinutes: Int?` (default: 1440)

### API endpoints

- `PATCH /api/actions/[id]/participate` — update RSVP + reminder
- `GET /api/actions/[id]/ics` — download ICS
- `POST /api/actions/[id]/reminders` — schedule reminder (organizer only)

### UI scope

- RSVP buttons with status badges
- Calendar download button
- Reminder toggle in action details

---

## Milestone 3 — Campaign analytics

### Goals

- Funnel metrics by action type
- Cohort participation over time

### Data model changes

- Add `CampaignAnalyticsSnapshot` (pre-aggregated daily)

### API endpoints

- `GET /api/dashboard/campaign/[id]/funnel`
- `GET /api/dashboard/campaign/[id]/cohorts`

### UI scope

- Funnel chart per campaign
- Participation timeline chart

---

## Milestone 4 — Organization management

### Goals

- Role-based permissions
- Invite flow + audit trail

### Data model changes

- Add `OrganizationInvite`
- Add `OrganizationAuditLog`
- Expand `CampaignMember` roles for org admins

### API endpoints

- `POST /api/organizations/[id]/invites`
- `POST /api/organizations/[id]/invites/[inviteId]/accept`
- `GET /api/organizations/[id]/audit`

### UI scope

- Invite modal and pending invites list
- Audit log table (filters + export)

---

## Sequence and dependency map

1. Campaign lifecycle improvements (foundation)
2. Action participation + reminders (user engagement)
3. Campaign analytics (value + reporting)
4. Organization management (scale + governance)

---

## Definition of Done (per milestone)

- API + UI completed and documented
- Tests for critical flows
- Auth/authorization validated
- Performance regression check
