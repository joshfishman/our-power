import type { SeedPlank } from './types';

// Federal planks for the 119th Congress.
//
// Bill numbers verified 2026-04-30 against the LegiScan 119th Congress
// bulk dataset. Each non-provisional entry has a `legiscanBillId` pinned
// so sync resolves it deterministically (CA-style cross-session bill_number
// reuse can't bite at the federal level the same way, but pinning is still
// the safest contract).
//
// Pre-119th historical bills (CHIPS Act H.R.4346 / IIJA H.R.3684 / PACT
// Act S.3373) were activated 2026-05-30 (v1.8.15) after downloading the
// 117th Congress LegiScan dataset (session_id=1823, dataset_date
// 2023-01-04) into data/US/2021-2022_117th_Congress/. v1.8.15 was rolled
// back same day because the sync resolver only looked up voters by
// Legislator.legiscanPeopleId (119th IDs), so 117th roll-call voters
// silently dropped. PR #52 (bioguide-id fallback) adds a per-session
// peopleId→bioguideId lookup; v1.8.15-v2 re-activates with correct
// cross-session attribution.

export const FEDERAL_PLANKS: SeedPlank[] = [
  {
    jurisdiction: 'FEDERAL',
    slug: 'honest-government',
    number: 1,
    name: 'Honest Government',
    shortDescription: 'End legalized bribery. Public servants, not private clients.',
    tagline: 'End legalized bribery. Public servants, not private clients.',
    body: `Public servants work for the public. End the system where members of Congress trade stocks on inside information, take corporate PAC money, and walk into lobbying jobs the day they leave office. Public financing of elections so candidates work for voters, not donors. Full disclosure of dark money. Real cooling-off periods between government service and lobbying.`,
    color: '#8B3A3A',
    markers: [
      {
        slug: 'corporate-pac-refusal',
        name: 'Refuses corporate PAC money in current cycle',
        markerType: 'PRIMARY',
        description:
          'Member receives less than 5% of total campaign receipts from corporate PACs in the current cycle.',
        methodologyNotes:
          'Computed from FEC filings via OpenSecrets bulk data. Threshold of 5% allows for legacy contributions while filtering active corporate PAC reliance.',
        displayOrder: 1,
        bills: [],
      },
      {
        slug: 'stock-trading-ban',
        name: 'Cosponsored congressional stock trading ban',
        markerType: 'SECONDARY',
        description:
          'Cosponsored at least one bill banning individual stock trading by members of Congress and their immediate families.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1498',
            billTitle: 'HONEST Act (Halting Ownership and Non-Ethical Stock Transactions)',
            actionType: 'COSPONSOR',
            legiscanBillId: 2027015,
            isProvisional: false,
            notes: 'Hawley-led bipartisan stock trading ban. Cosponsors include Moreno, Ossoff, Peters, Merkley.',
          },
          {
            congressNumber: 119,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.4890',
            billTitle: 'ETHICS Act (Ending Trading and Holdings in Congressional Stocks)',
            actionType: 'COSPONSOR',
            legiscanBillId: 2041431,
            isProvisional: false,
            notes:
              'Bipartisan stock-trading ban. Lead: Krishnamoorthi (D); R cosponsors include Cloud, Kiggans, Self, Lawler, Joyce, Fitzpatrick.',
          },
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1879',
            billTitle: 'Ban Congressional Stock Trading Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2033497,
            isProvisional: false,
            notes: 'Ossoff-led Democratic stock-trading ban; 17 Senate cosponsors. Hitting any of the three counts.',
          },
        ],
      },
      {
        slug: 'public-financing',
        name: 'Cosponsored public financing of elections',
        markerType: 'SECONDARY',
        description:
          'Cosponsored legislation establishing or expanding public financing of federal elections (small-dollar match, vouchers, etc.).',
        methodologyNotes:
          'This is the most partisan-coded marker on the platform — conservative legal tradition raises 1st Amendment concerns. Consider revisiting if cross-partisan reception suffers.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2523',
            billTitle: 'John R. Lewis Voting Rights Advancement Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2040922,
            isProvisional: false,
            notes:
              'Successor vehicle to Freedom to Vote / For the People — voting rights + election worker protection. Lead: Durbin. The Freedom to Vote Act itself was not reintroduced in the 119th.',
          },
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2822',
            billTitle: 'Register America to Vote Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2044376,
            isProvisional: false,
            notes:
              'Voter-registration access vehicle; 14 Senate cosponsors. Counts under public-financing/voting-access marker.',
          },
        ],
      },
      {
        slug: 'disclose-act',
        name: 'Cosponsored DISCLOSE Act',
        markerType: 'SECONDARY',
        description: 'Cosponsored legislation requiring full disclosure of dark money political spending.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.3991',
            billTitle: 'DISCLOSE Act of 2026',
            actionType: 'COSPONSOR',
            legiscanBillId: 2129858,
            isProvisional: false,
            notes: 'Lead: Whitehouse. Cosponsors include Wyden, Schumer.',
          },
        ],
      },
      {
        slug: 'lobbying-cooling-off',
        name: 'Cosponsored lobbying reform with extended cooling-off period',
        markerType: 'SECONDARY',
        description:
          'Cosponsored legislation extending the post-service lobbying ban for former members and senior staff.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1850',
            billTitle: 'Close the Revolving Door Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2033362,
            isProvisional: false,
            notes: 'Lead: Bennet. Bans former senators from lobbying for life and former senior staff for six years.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'FEDERAL',
    slug: 'our-children-our-future',
    number: 2,
    name: 'Our Children Our Future',
    shortDescription: 'The schools, science, and infrastructure we hand down.',
    tagline: 'What we build and hand down to the next generation.',
    body: `Strong public schools — every child deserves a good one in their neighborhood. Parental empowerment within public schools (transparency, voice in curriculum), without draining public dollars to vouchers or charters. Early childhood education. Federal science and technology research. Clean energy independence — solar, wind, nuclear, geothermal, batteries, the grid. Roads, bridges, broadband, water. Environmental stewardship.`,
    color: '#2C4A5E',
    markers: [
      {
        slug: 'major-investment-vote',
        name: 'Supported major education, research, infrastructure, or clean energy investment in past two Congresses',
        markerType: 'PRIMARY',
        description:
          'Voted for or cosponsored at least one of: CHIPS and Science Act, IIJA (Bipartisan Infrastructure Law), IRA clean energy provisions, or major early childhood / childcare legislation.',
        methodologyNotes:
          'Broad primary marker — accepts any one of several major investment categories. Plank deliberately excludes vouchers/charters as qualifying.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 117,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.4346',
            billTitle: 'CHIPS and Science Act',
            actionType: 'VOTE_YES',
            legiscanBillId: 1518388,
            isProvisional: false,
            notes:
              'Signed into law 2022-08-09. CHIPS and Science. Senate cloture 64-32 on 2022-07-27. Final passage House 243-187 on 2022-07-28 (rc 1222482). v1.8.15-v2: re-activated after PR #52 (bioguide-id fallback) corrects cross-session people-ID resolution. https://legiscan.com/US/bill/HB4346/2021',
          },
          {
            congressNumber: 117,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.3684',
            billTitle: 'Infrastructure Investment and Jobs Act',
            actionType: 'VOTE_YES',
            legiscanBillId: 1514715,
            isProvisional: false,
            notes:
              'Signed into law 2021-11-15. Bipartisan Infrastructure Law. Senate passed 69-30 on 2021-08-10 (rc 1105920); House agreed to Senate amendment 228-206 on 2021-11-05 (rc 1115607). v1.8.15-v2: re-activated after PR #52 (bioguide-id fallback) corrects cross-session people-ID resolution. https://legiscan.com/US/bill/HB3684/2021',
          },
        ],
      },
      {
        slug: 'clean-energy-investment',
        name: 'Supported clean energy investment',
        markerType: 'SECONDARY',
        description:
          'Voted for or cosponsored clean energy legislation (IRA clean energy provisions, specific clean energy bills, permitting reform supporting renewables).',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2681',
            billTitle: 'Lowering Electric Bills Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2041321,
            isProvisional: false,
            notes:
              'Schumer-led with 40 Senate cosponsors. Targets clean-energy permitting + grid investment to reduce ratepayer costs.',
          },
        ],
      },
      {
        slug: 'science-research-funding',
        name: 'Cosponsored scientific research funding legislation',
        markerType: 'SECONDARY',
        description:
          'Cosponsored bills increasing or protecting NIH, NSF, NASA, or other federal science research funding.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2005',
            billTitle: 'IDeA Reauthorization Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2036781,
            isProvisional: false,
            notes:
              'Bipartisan reauthorization of NIH IDeA program (Hyde-Smith R, Capito R, Hassan D). Smaller-cosponsor bill but a clean cross-partisan signal.',
          },
        ],
      },
      {
        slug: 'environmental-protection',
        name: 'Supported environmental protection legislation',
        markerType: 'SECONDARY',
        description:
          'Cosponsored bills protecting clean air, clean water, public lands, or addressing PFAS / toxic exposure.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2272',
            billTitle: 'Tribal Access to Clean Water Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2039437,
            isProvisional: false,
            notes:
              'Bennet-led. Cleanest 119th vehicle for clean-water infrastructure investment with bipartisan signal in this Congress.',
          },
        ],
      },
      {
        slug: 'early-childhood',
        name: 'Cosponsored early childhood education or childcare legislation',
        markerType: 'SECONDARY',
        description: 'Cosponsored federal childcare assistance, universal pre-K, or expanded child tax credit.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1393',
            billTitle: 'American Family Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2022426,
            isProvisional: false,
            notes:
              'Bennet-led with 45 Senate cosponsors. Expanded child tax credit — high-coverage 119th vehicle for the early-childhood plank.',
          },
        ],
      },
      {
        slug: 'infrastructure-broadband',
        name: 'Supported infrastructure funding (broadband, water, transit, roads)',
        markerType: 'SECONDARY',
        description:
          'Voted for or cosponsored infrastructure investment legislation beyond IIJA — broadband expansion, water infrastructure, transit, road safety.',
        displayOrder: 6,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.674',
            billTitle: 'Broadband Grant Tax Treatment Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1979416,
            isProvisional: false,
            notes:
              'Bipartisan tax fix for broadband grants (16 cosponsors). Practical pro-broadband-deployment vote distinct from IIJA.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'FEDERAL',
    slug: 'making-a-living',
    number: 3,
    name: 'Making a Living',
    shortDescription: 'A full-time job should support a life.',
    tagline: 'A full-time job should support a life. Wages, housing, no predatory lending.',
    body: `A federal minimum wage that means something. Stop wage theft and retaliation against workers who organize. End non-competes that trap workers in low-wage jobs. Cap predatory loan rates. Build housing. Paid family leave for working families.`,
    color: '#8B3A3A',
    markers: [
      {
        slug: 'minimum-wage-increase',
        name: 'Supported federal minimum wage increase to $15+',
        markerType: 'PRIMARY',
        description:
          'Voted for or cosponsored Raise the Wage Act or equivalent federal minimum wage increase to $15 or higher.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1332',
            billTitle: 'Raise the Wage Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2022084,
            isProvisional: false,
            notes: 'Lead: Sanders. Phased federal minimum wage increase to $17/hr by 2030.',
          },
        ],
      },
      {
        slug: 'team-act-gop-alt',
        name: 'Republican-led minimum wage alternative',
        markerType: 'SECONDARY',
        description:
          'Cosponsored a Republican-led federal minimum wage bill as an alternative to the $15 Raise the Wage Act path.',
        methodologyNotes:
          'Slug retained for backward compatibility — originally named for the Romney-Cotton TEAM Act, which was not reintroduced in the 119th after Romney retired. The 119th vehicle is Hawley/Welch/Gallego S.2013 (Higher Wages for American Workers Act). Counts as a Plank 3 secondary under Option C two-tier methodology because it moves toward a federal minimum wage floor, even at lower magnitude than $15.',
        displayOrder: 2,
        isRepublicanAlternative: true,
        parallelMarkerSlug: 'minimum-wage-increase',
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2013',
            billTitle: 'Higher Wages for American Workers Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2036830,
            isProvisional: false,
            notes:
              'Hawley-led with Welch (D) and Gallego (D). Replaces the unintroduced TEAM Act as the GOP-alt minimum-wage vehicle in the 119th.',
          },
        ],
      },
      {
        slug: 'wage-theft-noncompete',
        name: 'Cosponsored wage theft, anti-retaliation, or non-compete reform legislation',
        markerType: 'SECONDARY',
        description:
          'Cosponsored at least one of: Wage Theft Prevention and Wage Recovery Act, Workforce Mobility Act (non-compete reform), or anti-retaliation provisions for organizing workers.',
        methodologyNotes:
          'Replaces PRO Act marker per platform decision (PRO Act explicitly removed for cross-partisan compatibility).',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2031',
            billTitle: 'Workforce Mobility Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2036988,
            isProvisional: false,
            notes:
              'Federal restriction on most non-compete agreements. Smaller-cosponsor bipartisan bill but a clean signal on the worker-mobility front of this marker.',
          },
        ],
      },
      {
        slug: 'loan-rate-cap',
        name: 'Cosponsored Veterans and Consumers Fair Credit Act (36% rate cap)',
        markerType: 'SECONDARY',
        description: 'Cosponsored federal 36% APR cap on consumer loans (Hawley, Vance, others have backed this).',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.381',
            billTitle: '10 Percent Credit Card Interest Rate Cap Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1956425,
            isProvisional: false,
            notes:
              'Sanders + Hawley + Merkley + Gillibrand. The Veterans and Consumers Fair Credit Act (36% APR cap) was not reintroduced in 119th; this is the strongest cross-partisan rate-cap bill in the 119th and counts toward the same marker.',
          },
        ],
      },
      {
        slug: 'housing-supply',
        name: 'Supported federal housing supply or affordability legislation',
        markerType: 'SECONDARY',
        description:
          'Cosponsored federal legislation expanding housing supply, addressing affordability, or protecting tenants.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2414',
            billTitle: 'Housing Supply Expansion Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2040339,
            isProvisional: false,
            notes:
              '12 Senate cosponsors. Federal supply-side housing bill — pairs naturally with state-level YIMBY work.',
          },
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1515',
            billTitle: 'Affordable Housing Credit Improvement Act of 2025',
            actionType: 'COSPONSOR',
            legiscanBillId: 2027365,
            isProvisional: false,
            notes:
              'Cantwell-led with 42 Senate cosponsors. LIHTC expansion — the highest-coverage housing bill in the 119th.',
          },
        ],
      },
      {
        slug: 'paid-family-leave',
        name: 'Cosponsored FAMILY Act or equivalent paid family leave',
        markerType: 'SECONDARY',
        description: 'Cosponsored federal paid family and medical leave legislation.',
        displayOrder: 6,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2823',
            billTitle: 'FAMILY Act — Family and Medical Insurance Leave Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2044287,
            isProvisional: false,
            notes: 'Gillibrand-led with 39 Senate cosponsors. The flagship Democratic paid-leave vehicle in the 119th.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'FEDERAL',
    slug: 'the-care-we-owe',
    number: 4,
    name: 'The Care We Owe',
    shortDescription: 'Honor the promises this country has made.',
    tagline: 'Honor the promises this country has made — to veterans, elders, and working families.',
    body: `The country made promises — to veterans, to elders, to working families who paid in. Honor them. Veterans get the care they earned. Drug prices come down. Medicare and Medicaid stay strong. Social Security stays solvent and pays what people earned. Childcare and paid leave so families can work and raise children at the same time.`,
    color: '#2C4A5E',
    markers: [
      {
        slug: 'major-care-vote',
        name: 'Supported major healthcare cost or veterans benefit legislation in past two Congresses',
        markerType: 'PRIMARY',
        description:
          'Voted for or cosponsored at least one of: IRA drug pricing provisions, Medical Debt Relief Act, ACA subsidy expansion, PACT Act, or Medicare expansion.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1836',
            billTitle: 'SMART Prices Act — Strengthening Medicare And Reducing Taxpayer Prices',
            actionType: 'COSPONSOR',
            legiscanBillId: 2033385,
            isProvisional: false,
            notes:
              '27 Senate cosponsors. 119th-era extension of IRA drug-price negotiation. The cleanest active vehicle for the Care primary marker now that PACT/IRA are historical.',
          },
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.1186',
            billTitle: 'Lower Drug Costs for Families Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2016678,
            isProvisional: false,
            notes: '13 Senate cosponsors. Broader drug-pricing vehicle. Counts under the same Care primary marker.',
          },
        ],
      },
      {
        slug: 'pact-act',
        name: 'Supported PACT Act or other major veterans benefit legislation',
        markerType: 'SECONDARY',
        description: 'Voted for the Honoring our PACT Act or cosponsored major veterans benefit expansion.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 117,
            billType: 'SENATE_BILL',
            billNumber: 'S.3373',
            billTitle: 'Honoring our PACT Act',
            actionType: 'VOTE_YES',
            legiscanBillId: 1537975,
            isProvisional: false,
            notes:
              'Signed into law 2022-08-10. Sergeant First Class Heath Robinson Honoring our Promise to Address Comprehensive Toxics Act. House passed 342-88 on 2022-07-13 (rc 1222095); Senate agreed to House amendment 86-11 on 2022-08-02 (rc 1222937). v1.8.15-v2: re-activated after PR #52 (bioguide-id fallback) corrects cross-session people-ID resolution. https://legiscan.com/US/bill/SB3373/2021',
          },
        ],
      },
      {
        slug: 'medicaid-protection',
        name: 'Voted against Medicaid cuts',
        markerType: 'SECONDARY',
        description:
          'Voted against reconciliation bills or appropriations that cut Medicaid funding or imposed coverage-reducing requirements.',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 119,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.1195',
            billTitle: 'Protect Medicaid Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1965924,
            isProvisional: false,
            notes:
              '17 House cosponsors. Standalone bill blocking Medicaid coverage rollbacks — easier to score on than parsing reconciliation roll calls.',
          },
        ],
      },
      {
        slug: 'social-security-solvency',
        name: 'Cosponsored Social Security solvency legislation that protects current and future retirees',
        markerType: 'SECONDARY',
        description:
          'Cosponsored legislation honestly addressing Social Security trust fund depletion (~2033-35) while protecting earned benefits — Social Security 2100 Act, bipartisan solvency commission bills, or equivalent.',
        methodologyNotes:
          'Framing emphasizes fiscal honesty plus protection of earned benefits, not just defense of status quo.',
        displayOrder: 4,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2614',
            billTitle: 'Protecting and Preserving Social Security Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2041159,
            isProvisional: false,
            notes: 'Smaller-cosponsor bill but the cleanest 119th vehicle that tackles solvency without benefit cuts.',
          },
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.770',
            billTitle: 'Social Security Expansion Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1988462,
            isProvisional: false,
            notes:
              'Sanders-led with 11 Senate cosponsors. Companion H.R.1700 has 37 House cosponsors. Pairs with the Protecting/Preserving Act for broader solvency coverage.',
          },
        ],
      },
      {
        slug: 'new-parents-act-gop-alt',
        name: 'Republican-led paid leave alternative',
        markerType: 'SECONDARY',
        description:
          'Cosponsored a Republican-led or bipartisan paid family leave bill as an alternative to payroll-tax-funded paid leave proposals.',
        methodologyNotes:
          'Slug retained for backward compatibility — originally named for the Rubio New Parents Act, which was not reintroduced in the 119th after Rubio became Secretary of State. The 119th GOP-led vehicle is Bice-Houlahan H.R.3089 (More Paid Leave for More Americans Act), bipartisan paid leave that uses tax credits and federal-state partnership rather than payroll-tax-based funding. Counts as a Plank 4 secondary under Option C two-tier methodology.',
        displayOrder: 5,
        isRepublicanAlternative: true,
        parallelMarkerSlug: 'paid-leave-childcare',
        bills: [
          {
            congressNumber: 119,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.3089',
            billTitle: 'More Paid Leave for More Americans Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2027855,
            isProvisional: false,
            notes:
              'Bice (R) + Houlahan (D) + Miller-Meeks (R). Bipartisan paid leave vehicle replacing Rubio New Parents Act in the 119th.',
          },
        ],
      },
      {
        slug: 'paid-leave-childcare',
        name: 'Cosponsored childcare or paid leave legislation',
        markerType: 'SECONDARY',
        description: 'Cosponsored federal childcare assistance or paid family/medical leave legislation.',
        displayOrder: 6,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2295',
            billTitle: 'Child Care for Working Families Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2039554,
            isProvisional: false,
            notes:
              '44 Senate cosponsors. Companion to H.R.4418 (100 House cosponsors). Federal childcare-cap-on-fees bill.',
          },
        ],
      },
    ],
  },

  {
    jurisdiction: 'FEDERAL',
    slug: 'peace-and-strength',
    number: 5,
    name: 'Peace and Strength',
    shortDescription: 'Use American power wisely. End the forever wars. Audit the Pentagon.',
    tagline: 'Use American power wisely. End the forever wars. Audit the Pentagon.',
    body: `Strength means using power wisely. End the forever wars — Congress, not the executive alone, decides when American troops go into combat. Audit the Pentagon, every dollar accounted for. Break up monopolies that have grown too powerful — Big Tech, pharma, agriculture, defense. Real diplomacy at parity with force projection. Trade deals that protect American workers and the environment.`,
    color: '#8B3A3A',
    markers: [
      {
        slug: 'war-powers',
        name: 'Supported congressional war powers reassertion',
        markerType: 'PRIMARY',
        description:
          'Cosponsored AUMF repeal or voted yes on Iran, Yemen, or Venezuela War Powers Resolutions in the 119th Congress.',
        displayOrder: 1,
        bills: [
          {
            congressNumber: 119,
            billType: 'HOUSE_CONCURRENT_RES',
            billNumber: 'H.Con.Res.38',
            billTitle: 'War Powers Resolution directing the President',
            actionType: 'COSPONSOR',
            legiscanBillId: 2037503,
            isProvisional: false,
            notes:
              '95 House cosponsors. Concurrent resolution invoking War Powers Resolution authority — flagship 119th vehicle for the war-powers primary marker.',
          },
        ],
      },
      {
        slug: 'pentagon-audit',
        name: 'Supported Pentagon audit legislation or accountability amendments',
        markerType: 'SECONDARY',
        description:
          'Cosponsored Pentagon audit-enforcement bills or supported NDAA amendments tying funding to audit completion.',
        displayOrder: 2,
        bills: [
          {
            congressNumber: 119,
            billType: 'HOUSE_BILL',
            billNumber: 'H.R.7555',
            billTitle: 'Audit the Pentagon Act of 2026',
            actionType: 'COSPONSOR',
            legiscanBillId: 2116412,
            isProvisional: false,
            notes: '22 House cosponsors. Conditions Pentagon discretionary funding on completing a clean audit.',
          },
        ],
      },
      {
        slug: 'antitrust-major',
        name: 'Cosponsored major antitrust legislation',
        markerType: 'SECONDARY',
        description:
          'Cosponsored AICOA, Open App Markets Act, or substantial merger scrutiny bills (Hawley/Klobuchar bipartisan ground).',
        displayOrder: 3,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.2153',
            billTitle: 'Open App Markets Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 2038084,
            isProvisional: false,
            notes:
              'Klobuchar/Blumenthal/Hawley/Lee bipartisan antitrust vehicle restricting platform self-preferencing on app stores.',
          },
        ],
      },
      {
        slug: 'state-department-funding',
        name: 'Supported State Department funding and diplomatic capacity',
        markerType: 'SECONDARY',
        description: 'Voted for or cosponsored full State Department appropriations and diplomatic capacity expansion.',
        displayOrder: 4,
        bills: [],
        // No clean 119th match found in the bulk dataset for diplomatic-capacity legislation.
        // Leave empty — the secondary credit gap costs at most 1 point on this plank.
        // Revisit when 119th gets a State Department Authorization vehicle.
      },
      {
        slug: 'trade-protections',
        name: 'Supported labor and environmental protections in trade agreements',
        markerType: 'SECONDARY',
        description:
          'Cosponsored or voted for trade legislation that conditions agreements on labor and environmental standards.',
        displayOrder: 5,
        bills: [
          {
            congressNumber: 119,
            billType: 'SENATE_BILL',
            billNumber: 'S.691',
            billTitle: 'Leveling the Playing Field 2.0 Act',
            actionType: 'COSPONSOR',
            legiscanBillId: 1982380,
            isProvisional: false,
            notes:
              '22 Senate cosponsors. Strengthens trade-remedy enforcement against dumping; companion H.R.1548 has 96 House cosponsors.',
          },
        ],
      },
    ],
  },
];
