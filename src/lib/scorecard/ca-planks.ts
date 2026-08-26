import type { SeedPlank } from './types';

// California state planks for the 2025-2026 Legislative Session.
//
// Per methodology decision (Option A, 2026-04-29): the federal Plank 5
// "Peace and Strength" does not map to state level. CA scorecard is /20
// across four planks rather than /25 across five.
//
// Bill numbers below are PROVISIONAL — verify each against
// leginfo.legislature.ca.gov and OpenStates before any sync runs.

export const CA_PLANKS: SeedPlank[] = [
  {
    jurisdiction: 'CA',
    slug: 'honest-government',
    number: 1,
    name: 'Honest Government',
    shortDescription: 'End legalized bribery in Sacramento.',
    tagline: 'End legalized bribery. Public servants, not private clients.',
    body: `Members of the California Legislature work for Californians. Stop pay-to-play. Strengthen the Levine Act. Limit lobbyist gifts. Disclose dark money in state campaigns. Real cooling-off periods between Sacramento and the lobby corps next door.`,
    commitments: [
      'Public servants work for the public, not for private clients.',
      'No trading stocks on inside information.',
      'No corporate PAC money.',
      'No walking into a lobbying job the day you leave office — real cooling-off periods.',
      'Public financing of elections, so candidates answer to voters, not donors.',
      'Full disclosure of dark money.',
    ],
    color: '#8B3A3A',
    markers: [
      {
        slug: 'corporate-pac-refusal-ca',
        name: 'Refuses corporate PAC money in current cycle',
        markerType: 'PRIMARY',
        description:
          'Member receives less than 5% of campaign receipts from corporate PACs in the current state cycle, per Cal-Access filings as classified by our Committee Classification table.',
        methodologyNotes:
          'Computed from Cal-Access raw data (CCDC pipeline). Requires the CommitteeClassification table to be seeded with at least the top 500 CA committees before publishing any score on this marker.',
        displayOrder: 1,
        bills: [],
      },
      {
        slug: 'levine-act-strengthen',
        name: 'Supported strengthening the Levine Act (anti-pay-to-play)',
        markerType: 'SECONDARY',
        description:
          'Authored, principal-coauthored, or coauthored legislation extending or strengthening SB 1439 (Levine Act) protections against contributions from parties with pending decisions before legislators.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-359',
            billTitle: 'Fair Political Practices Commission',
            actionType: 'COSPONSOR',
            legiscanBillId: 1949677,
            isProvisional: false,
            notes: 'FPPC modernization bill — closest 2025-2026 vehicle for Levine Act enhancements.',
          },
        ],
      },
      {
        slug: 'lobbyist-gifts-ca',
        name: 'Supported tightening lobbyist gift limits',
        markerType: 'SECONDARY',
        description:
          'Authored or coauthored legislation reducing the annual lobbyist gift cap or expanding the categories of disclosable gifts.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-1175',
            billTitle: 'Lobbyist registration and termination',
            actionType: 'COSPONSOR',
            legiscanBillId: 2119739,
            isProvisional: false,
            notes: 'Lobbyist registration/termination bill — closest 2025-2026 vehicle for gift/disclosure tightening.',
          },
        ],
      },
      {
        slug: 'dark-money-disclosure-ca',
        name: 'Supported state-level dark money disclosure',
        markerType: 'SECONDARY',
        description:
          'Authored or coauthored legislation requiring increased disclosure of independent expenditure funding sources in state elections, or supporting state-level public financing.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-42',
            billTitle: 'Political Reform Act of 1974: public campaign financing: California Fair Elections Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1894817,
            isProvisional: false,
            notes:
              '22 CA Senate cosponsors. Public-financing vehicle — strongest signal on the campaign-finance reform marker in 2025-2026.',
          },
        ],
      },
      {
        slug: 'cooling-off-ca',
        name: 'Supported extended cooling-off period for legislators-turned-lobbyists',
        markerType: 'SECONDARY',
        description:
          'Authored or coauthored legislation extending the post-service lobbying ban for former state legislators and senior staff.',
        displayOrder: 5,
        bills: [],
      },
    ],
  },

  {
    jurisdiction: 'CA',
    slug: 'our-children-our-future',
    number: 2,
    name: 'Our Children Our Future',
    shortDescription: 'Strong public schools, real climate action, infrastructure that lasts.',
    tagline: 'What we build and hand down to the next generation.',
    body: `Strong public schools — California's LCFF and TK rollouts mean every child has the chance to learn close to home. Real funding for UC, CSU, and community colleges. Climate action that meets SB 100 targets and the moment we are in. Wildfire prevention. Water infrastructure that holds for the next century. Broadband for every child.`,
    commitments: [
      'Strong public schools — every child deserves a good one in their neighborhood.',
      'Parental transparency and voice within public schools, without draining public dollars to vouchers or charters.',
      'Early childhood education.',
      'Federal science and technology research.',
      'Clean energy independence — solar, wind, nuclear, geothermal, batteries, the grid.',
      'Roads, bridges, broadband, water.',
      'Environmental stewardship.',
    ],
    color: '#2C4A5E',
    markers: [
      {
        slug: 'public-school-investment-ca',
        name: 'Supported Local Control Funding Formula and TK expansion',
        markerType: 'PRIMARY',
        description:
          'Voted for the LCFF base in budget acts and for transitional kindergarten universalization; opposed voucher / ESA proposals.',
        methodologyNotes:
          'CA LCFF and TK rollouts are the binary signal. Vouchers/charters explicitly excluded as qualifying per platform.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-477',
            billTitle: 'Fair Pay for Educators Act: LCFF base grants',
            actionType: 'COSPONSOR',
            legiscanBillId: 1964664,
            isProvisional: false,
            notes:
              'Directly raises LCFF base grants — flagship 2025-2026 vehicle for the Children Our Future primary marker.',
          },
        ],
      },
      {
        slug: 'climate-sb100-ca',
        name: 'Supported SB 100 / 100% clean electricity implementation',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation implementing SB 100 100% clean electricity targets and the related grid build-out.',
        displayOrder: 2,
        bills: [],
        // No clean SB 100 implementation vehicle in the 2025-2026 dataset yet — leaving empty rather than mismatching.
      },
      {
        slug: 'wildfire-prevention-ca',
        name: 'Supported wildfire prevention and resilience funding',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation funding wildfire prevention, fuel reduction, or insurance reform addressing wildfire risk.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-35',
            billTitle: 'Safe Drinking Water, Wildfire Prevention, Drought Preparedness, and Clean Air Bond',
            actionType: 'COSPONSOR',
            legiscanBillId: 1893372,
            isProvisional: false,
            notes: '31 CA Assembly cosponsors — the broadest-coverage wildfire-prevention vehicle in 2025-2026.',
          },
        ],
      },
      {
        slug: 'higher-ed-funding-ca',
        name: 'Supported UC / CSU / community college funding floors',
        markerType: 'SECONDARY',
        description:
          'Voted yes on budget acts maintaining or increasing the UC, CSU, and community college funding compacts.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-88',
            billTitle: 'Cal Grants and Middle Class Scholarship Program: eligibility',
            actionType: 'COSPONSOR',
            legiscanBillId: 1903333,
            isProvisional: false,
            notes: '9 CA Assembly cosponsors. Expands Cal Grant + Middle Class Scholarship eligibility.',
          },
        ],
      },
      {
        slug: 'broadband-ca',
        name: 'Supported broadband infrastructure expansion',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation expanding broadband access in underserved CA communities.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-716',
            billTitle: 'Lifeline program: broadband internet access service',
            actionType: 'COSPONSOR',
            legiscanBillId: 1980446,
            isProvisional: false,
            notes: 'Adds broadband to the state Lifeline program — closest 2025-2026 vehicle for broadband expansion.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'CA',
    slug: 'making-a-living',
    number: 3,
    name: 'Making a Living',
    shortDescription: 'A full-time job in California should support a life.',
    tagline: 'Wages, housing, no predatory lending.',
    body: `California has the highest housing costs in the country. The state minimum wage is meaningful but rent eats it. Build housing — SB 9, SB 10, ADU pathways, by-right zoning where it works. Stop wage theft. Cap predatory loan rates. Protect tenants from no-cause eviction. Keep workers' protections strong.`,
    commitments: [
      'A federal minimum wage that means something.',
      'Stop wage theft and retaliation against workers who organize.',
      'End non-competes that trap workers in low-wage jobs.',
      'Cap predatory loan rates.',
      'Build housing.',
      'Paid family leave for working families.',
    ],
    color: '#8B3A3A',
    markers: [
      {
        slug: 'housing-supply-ca',
        name: 'Supported housing supply legislation',
        markerType: 'PRIMARY',
        description:
          'Authored, principal-coauthored, or voted yes on at least one of: SB 9 / SB 10 successor bills, ADU expansion bills, or comparable by-right zoning measures.',
        methodologyNotes:
          'Composite marker: any supported housing-supply bill counts. Reflects that CA housing policy spans many vehicles rather than a single primary.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-956',
            billTitle: 'Accessory dwelling units: ministerial approval: single-family dwellings',
            actionType: 'COSPONSOR',
            legiscanBillId: 1978708,
            isProvisional: false,
            notes: 'ADU streamlining for single-family parcels — supply-side housing bill.',
          },
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-462',
            billTitle: 'Land use: accessory dwelling units',
            actionType: 'COSPONSOR',
            legiscanBillId: 1961071,
            isProvisional: false,
            notes: 'Companion ADU bill.',
          },
        ],
      },
      {
        slug: 'tenant-protection-ca',
        name: 'Supported AB 1482 tenant protections (or expansion thereof)',
        markerType: 'SECONDARY',
        description:
          'Voted yes on AB 1482 (Tenant Protection Act) or subsequent legislation extending or strengthening it.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-768',
            billTitle: 'Mobilehome parks: rent protections: local rent control',
            actionType: 'COSPONSOR',
            legiscanBillId: 1974485,
            isProvisional: false,
            notes: 'Mobilehome rent protections — closest tenant-protection vehicle in 2025-2026.',
          },
        ],
      },
      {
        slug: 'wage-theft-ca',
        name: 'Supported wage theft enforcement',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation strengthening wage theft enforcement or recovery.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-485',
            billTitle: 'Labor Commissioner: unsatisfied judgments: nonpayment of wages',
            actionType: 'COSPONSOR',
            legiscanBillId: 1964672,
            isProvisional: false,
            notes: 'Strengthens Labor Commissioner authority to recover unpaid wages.',
          },
        ],
      },
      {
        slug: 'loan-rate-cap-ca',
        name: 'Supported state-level consumer loan rate caps',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on California Fair Access to Credit Act extensions or APR caps on small-dollar loans.',
        displayOrder: 4,
        bills: [],
        // No clean 2025-2026 rate-cap vehicle found in dataset yet.
      },
      {
        slug: 'paid-leave-sdi-ca',
        name: 'Supported strengthening Paid Family Leave / SDI',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation expanding California Paid Family Leave benefits, eligibility, or job protection.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-590',
            billTitle: 'Paid family leave: eligibility: care for designated persons',
            actionType: 'COSPONSOR',
            legiscanBillId: 1978823,
            isProvisional: false,
            notes: '12 CA Senate cosponsors. Expands CA Paid Family Leave to cover designated non-family caregivers.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'CA',
    slug: 'the-care-we-owe',
    number: 4,
    name: 'The Care We Owe',
    shortDescription: 'Honor the promises this state has made.',
    tagline: 'Healthcare access, veterans, and care for working families.',
    body: `Medi-Cal expansion has covered millions more Californians. Keep building that. CalRx for affordable medication. Real funding for state veterans homes and benefits. Mental health access that actually exists in your county. Childcare that working parents can afford.`,
    commitments: [
      'Honor the promises this country made — to veterans, to elders, to working families who paid in.',
      'Veterans get the care they earned.',
      'Drug prices come down.',
      'Medicare and Medicaid stay strong.',
      'Social Security stays solvent and pays what people earned.',
      'Childcare and paid leave, so families can work and raise children at the same time.',
    ],
    color: '#2C4A5E',
    markers: [
      {
        slug: 'medi-cal-expansion-ca',
        name: 'Supported Medi-Cal expansion and protection',
        markerType: 'PRIMARY',
        description:
          'Voted yes on budget acts expanding Medi-Cal eligibility (including undocumented adults) and opposed proposals reducing coverage.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-1284',
            billTitle: 'Medi-Cal benefits: employer reports',
            actionType: 'COSPONSOR',
            legiscanBillId: 2121868,
            isProvisional: false,
            notes: '8 CA Senate cosponsors. Strengthens Medi-Cal benefit reporting requirements.',
          },
        ],
      },
      {
        slug: 'calrx-ca',
        name: 'Supported CalRx affordable medication program',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation expanding the CalRx state generic drug program.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_SENATE_BILL',
            billNumber: 'SB-829',
            billTitle: 'California Institute for Scientific Research: CalRx Initiative: vaccines',
            actionType: 'COSPONSOR',
            legiscanBillId: 1980559,
            isProvisional: false,
            notes: 'CalRx expansion to state-manufactured vaccines.',
          },
        ],
      },
      {
        slug: 'veterans-ca',
        name: 'Supported state veterans home and benefits funding',
        markerType: 'SECONDARY',
        description:
          'Voted yes on budget items funding CalVet, state veterans homes, or expanded state veterans benefits.',
        displayOrder: 3,
        bills: [],
        // No clean 2025-2026 CalVet-specific bill in dataset yet.
      },
      {
        slug: 'mental-health-ca',
        name: 'Supported county-level mental health capacity',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation expanding mental health access — MHSA reforms, CARE Court funding (where directionally aligned), county capacity grants.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-1429',
            billTitle: 'Behavioral health reimbursement',
            actionType: 'COSPONSOR',
            legiscanBillId: 1980326,
            isProvisional: false,
            notes: 'Behavioral health reimbursement reform — closest 2025-2026 mental-health capacity vehicle.',
          },
        ],
      },
      {
        slug: 'childcare-ca',
        name: 'Supported state childcare assistance',
        markerType: 'SECONDARY',
        description:
          'Authored, coauthored, or voted yes on legislation expanding subsidized childcare slots or provider rates.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-2678',
            billTitle: 'Preschool programs: QRIS block grant',
            actionType: 'COSPONSOR',
            legiscanBillId: 2121755,
            isProvisional: false,
            notes: 'Preschool QRIS block grant — closest 2025-2026 childcare vehicle.',
          },
        ],
      },
      {
        slug: 'calcare-single-payer',
        name: 'Supported CalCare (single-payer healthcare)',
        markerType: 'SECONDARY',
        description:
          'Voted yes on or coauthored CalCare legislation establishing a state single-payer healthcare program for all Californians.',
        methodologyNotes:
          'Single-payer is more contested than the rest of the platform — flagged for cross-partisan review. Included because it has been a recurring vote of conscience in the CA Assembly that distinguishes legislators willing to advance the bill from those who let it die in committee.',
        displayOrder: 6,
        bills: [
          // Current vehicle (2025-2026 session) — featured + public-slug.
          // Vote-roll empty for now; flips once Health Committee acts.
          {
            congressNumber: 20252026,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-1900',
            billTitle: 'CalCare — Guaranteed Health Care for All',
            actionType: 'COSPONSOR',
            legiscanBillId: 2116282,
            publicSlug: 'calcare',
            isFeatured: true,
            isProvisional: false,
            publicDescription:
              'AB 1900 — CalCare — establishes a single-payer healthcare program for every Californian, replacing private insurance with a publicly-funded system covering doctor visits, hospitalization, prescriptions, mental health, dental, and vision. Authored by Assembly Member Ash Kalra (D-San José) with the California Nurses Association as the 2025-2026 successor to AB 2200, which passed the Assembly Health Committee 9-4-3 in April 2024 before dying in Appropriations.',
            statusNote:
              'Introduced in the 2025-2026 California legislative session. Successor to AB 2200. Awaiting committee action.',
            callToAction:
              'Hello — my name is [your name] and I live in [your city]. I am calling to ask [Member name] to coauthor AB 1900 (CalCare) and to publicly commit to advancing it out of committee for a full floor vote. Healthcare in California still costs too much and leaves too many people behind. We need a vote of conscience on single-payer, not a quiet death in committee. Thank you for your time.',
            notes: 'Verified via LegiScan 2025-2026 session dataset. Confirmed sponsors include Kalra, Bryan, Lee.',
          },
          // Historical record — last session's vote of conscience.
          // Kept for scoring continuity (members who voted yes on AB-2200
          // still earn the marker even if they haven't yet cosponsored AB-1900).
          {
            congressNumber: 20232024,
            billType: 'CA_ASSEMBLY_BILL',
            billNumber: 'AB-2200',
            billTitle: 'CalCare — Guaranteed Health Care for All (2023-24)',
            actionType: 'VOTE_YES',
            legiscanBillId: 1840414,
            isFeatured: false,
            isProvisional: false,
            statusNote:
              'Passed Assembly Health Committee 9-4-3 on April 23, 2024. Held in Assembly Appropriations Committee. Did not advance to a floor vote.',
            notes:
              'Historical bill from 2023-2024. Members who voted YES are credited toward the calcare-single-payer marker even if they have not yet cosponsored the AB 1900 successor.',
          },
        ],
      },
    ],
  },
];
