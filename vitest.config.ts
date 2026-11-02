import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config';

// .claude/ holds agent worktrees (full copies of the repo); their tests are not ours.
export default mergeConfig(vite, defineConfig({ test: { setupFiles: ['tests/setup.ts'], exclude: [...configDefaults.exclude, '.claude/**'] } }));
