---
name: Typecheck + Parity CI
overview: Fix the full repository TypeScript error backlog, then harden agent-native parity/CRUD scoring and wire non-regression checks into CI with a staged rollout.
todos:
  - id: tc-baseline-bucket
    content: Bucket all current `npm run typecheck` errors by root-cause and owning files
    status: pending
  - id: tc-fix-test-types
    content: Fix test-only type errors (act import, App Route context params, helper typings)
    status: pending
  - id: tc-fix-schema-types
    content: Refactor Zod action schema layering to avoid `ZodEffects` partial/omit breakage
    status: pending
  - id: tc-fix-ui-types
    content: Resolve strict-mode UI/form type mismatches (DateValue, implicit any, component prop contracts)
    status: pending
  - id: tc-fix-lib-types
    content: Resolve dependency/library typing issues (swiper exports, resend casts, blob/file typing)
    status: pending
  - id: tc-verify-clean
    content: Run lint + full typecheck and ensure zero TypeScript errors
    status: pending
  - id: an-parity-uplift
    content: Raise parity and CRUD score quality by expanding capability coverage and unsupported-action handling
    status: pending
  - id: an-ci-scorecard
    content: 'Add staged CI scorecard checks: visibility, soft non-regression gate, optional hard gate'
    status: pending
isProject: false
---

# Typecheck and Agent-Native CI Hardening Plan

## Goal

Clear all current `npm run typecheck` failures across the repository, then add durable parity/CRUD scorecard enforcement in CI without brittle fixed thresholds.

## Scope

- Full repo typecheck remediation (not only agent-native files).
- Integrated follow-up for parity score quality + CI non-regression checks.

## Phase 1: Typecheck Stabilization

### 1) Build an error inventory and ownership map

- Re-run `npm run typecheck` and group errors by category:
  - test harness/signature errors
  - route handler signature mismatches
  - schema/type-level design issues
  - strict-mode callback and props mismatches
  - dependency export typing issues
- Track primary fix files:
  - `[/Users/joshuafishman/dev/op/src/__tests__](/Users/joshuafishman/dev/op/src/__tests__)`
  - `[/Users/joshuafishman/dev/op/src/app/api](/Users/joshuafishman/dev/op/src/app/api)`
  - `[/Users/joshuafishman/dev/op/src/components](/Users/joshuafishman/dev/op/src/components)`
  - `[/Users/joshuafishman/dev/op/src/lib](/Users/joshuafishman/dev/op/src/lib)`

### 2) Fix test and route signature typing first (high leverage)

- Update test imports/usages to React 18-safe `act` patterns in:
  - `[/Users/joshuafishman/dev/op/src/__tests__/campaign.test.tsx](/Users/joshuafishman/dev/op/src/__tests__/campaign.test.tsx)`
- Align route handler test context to each route’s real signature (`params` sync vs promise) in:
  - `[/Users/joshuafishman/dev/op/src/__tests__/action-participation-api.test.ts](/Users/joshuafishman/dev/op/src/__tests__/action-participation-api.test.ts)`
  - `[/Users/joshuafishman/dev/op/src/__tests__/campaigns-api.test.ts](/Users/joshuafishman/dev/op/src/__tests__/campaigns-api.test.ts)`

### 3) Refactor Zod schema layering to preserve ergonomics

- Split action schema into a base `ZodObject` and refinement layer so PATCH logic can safely use `partial()`/`omit()`.
- Fix affected usage sites:
  - `[/Users/joshuafishman/dev/op/src/lib/validations/campaign.ts](/Users/joshuafishman/dev/op/src/lib/validations/campaign.ts)`
  - `[/Users/joshuafishman/dev/op/src/app/api/actions/[id]/route.ts](/Users/joshuafishman/dev/op/src/app/api/actions/[id]/route.ts)`
  - `[/Users/joshuafishman/dev/op/src/app/api/actions/route.ts](/Users/joshuafishman/dev/op/src/app/api/actions/route.ts)`

### 4) Resolve UI strict-mode mismatches

- Normalize date state types to `DateValue | null` where used with `DatePicker` and typed handlers.
- Add explicit callback parameter types to remove implicit `any`.
- Fix prop contract mismatches (`required` vs `isRequired`, `rows` compatibility, etc.).
- Primary files:
  - `[/Users/joshuafishman/dev/op/src/components/campaigns/CreateActionForm.tsx](/Users/joshuafishman/dev/op/src/components/campaigns/CreateActionForm.tsx)`
  - `[/Users/joshuafishman/dev/op/src/app/(protected)/campaigns/create/page.tsx](/Users/joshuafishman/dev/op/src/app/(protected)`/campaigns/create/page.tsx)
  - `[/Users/joshuafishman/dev/op/src/components/organizations/CreateOrganizationForm.tsx](/Users/joshuafishman/dev/op/src/components/organizations/CreateOrganizationForm.tsx)`

### 5) Resolve dependency and library typing blockers

- Swiper module typing resolution strategy (prefer proper import path; fallback local module declaration only if needed).
- Fix `Blob`/`File` assumptions and unsafe casts.
- Primary files:
  - `[/Users/joshuafishman/dev/op/src/components/VisualMediaSlider.tsx](/Users/joshuafishman/dev/op/src/components/VisualMediaSlider.tsx)`
  - `[/Users/joshuafishman/dev/op/src/hooks/mutations/useWritePostMutations.ts](/Users/joshuafishman/dev/op/src/hooks/mutations/useWritePostMutations.ts)`
  - `[/Users/joshuafishman/dev/op/src/lib/email/resend.ts](/Users/joshuafishman/dev/op/src/lib/email/resend.ts)`

## Phase 2: Verify and Lock a Clean Baseline

### 6) Verification gate

- Run and require success:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:run -- src/__tests__/agent-native-scorecard.test.ts`
- Exit this phase only when typecheck is fully clean.

## Phase 3: Parity Score Uplift and CI Wiring

### 7) Improve scorecard fidelity and parity coverage

- Expand capability mapping and unsupported-action logic from:
  - `[/Users/joshuafishman/dev/op/src/lib/agent-native/capabilities.ts](/Users/joshuafishman/dev/op/src/lib/agent-native/capabilities.ts)`
  - `[/Users/joshuafishman/dev/op/src/lib/agent-native/scorecard.ts](/Users/joshuafishman/dev/op/src/lib/agent-native/scorecard.ts)`
- Align docs to implementation:
  - `[/Users/joshuafishman/dev/op/docs/agent-native/capability-matrix.md](/Users/joshuafishman/dev/op/docs/agent-native/capability-matrix.md)`
  - `[/Users/joshuafishman/dev/op/docs/agent-native/principles-scorecard.md](/Users/joshuafishman/dev/op/docs/agent-native/principles-scorecard.md)`

### 8) Add staged CI scorecard enforcement

- Extend CI workflow in `[/Users/joshuafishman/dev/op/.github/workflows/ci.yml](/Users/joshuafishman/dev/op/.github/workflows/ci.yml)`:
  1. **Visibility stage**: emit scorecard JSON artifact/log.
  2. **Soft gate stage**: fail only on parity/CRUD regression vs baseline.
  3. **Optional hard gate**: no new unsupported actions/incomplete entities.
- Keep checks non-brittle by comparing deltas, not absolute percentages.

## Deliverables

- `npm run typecheck` passes with zero errors.
- Agent-native scorecard stays executable and test-covered.
- CI enforces non-regression for parity/CRUD in gradual stages.
- Capability and scorecard docs reflect current code behavior.
- provide documentation and standards for dev work going forward
