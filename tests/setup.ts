// Global test setup. Tests written before v16 train big models on toy fleets and buy GPUs in bulk; the v16 memory
// wall and GPU allocation would refuse those setups. tests/scaleLimits.test.ts turns both back on for its own cases.
import { MEMORY_TUNING, SUPPLY_TUNING } from '../src/sim/systems/scaleLimits';

MEMORY_TUNING.ENFORCE = false;
SUPPLY_TUNING.ENFORCE = false;
