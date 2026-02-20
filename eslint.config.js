import baseConfig from '../eslint.config.base.js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { ignores: ['drizzle/'] }
)
