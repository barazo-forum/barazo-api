export default {
  '*.ts': ['prettier --write', 'eslint --fix'],
  '*.{js,mjs,cjs}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
}
