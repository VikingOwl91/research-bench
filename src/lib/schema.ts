import { z } from 'zod';

// Zod's optional JIT probes new Function even when CSP rejects it. Configure
// the interpreter before any schema is constructed, including voice metadata.
z.config({ jitless: true });
export { z };
