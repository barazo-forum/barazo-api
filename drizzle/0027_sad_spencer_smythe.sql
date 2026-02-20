CREATE INDEX IF NOT EXISTS "users_role_elevated_idx" ON "users" USING btree ("role") WHERE role IN ('moderator', 'admin');
CREATE INDEX IF NOT EXISTS "users_handle_idx" ON "users" USING btree ("handle");
CREATE INDEX IF NOT EXISTS "users_account_created_at_idx" ON "users" USING btree ("account_created_at");
