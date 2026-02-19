/**
 * Commitlint configuration
 * Conventional Commits enforced per CLAUDE.md
 * @see https://commitlint.js.org/#/reference-configuration
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
        'a11y',
        'security',
      ],
    ],
    'scope-empty': [0],
    'subject-case': [0],
  },
}
