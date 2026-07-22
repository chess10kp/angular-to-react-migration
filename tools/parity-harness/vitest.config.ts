import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  test: {
    environment: 'node',
    globals: false,
    // These carry Node/CJS internals or global side effects; let Node load them
    // directly instead of routing through Vite's transform pipeline.
    server: {
      deps: {
        external: ['jsdom', 'zone.js', 'reflect-metadata', /@angular\//],
      },
    },
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 20000,
    // Angular's platform is process-global; keep parity runs in one worker.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
