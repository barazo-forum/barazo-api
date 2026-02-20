import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      globals: false,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/integration/**'],
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/server.ts', 'src/db/migrations/**'],
      },
    },
  })
)
