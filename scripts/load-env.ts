// Side-effect-only module that loads environment variables from
// .env.local and .env. Import this BEFORE any other module that
// reads process.env at import time (notably anything that pulls in
// `@/lib/prisma/prisma`, which constructs a PrismaClient eagerly).
//
// In ESM, sibling imports evaluate in source order, so importing this
// file first guarantees env vars are populated before prisma loads.

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
