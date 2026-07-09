-- schema-v33: auto-assigned back numbers for new horses entering online
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Exhibitors whose horse has never been registered can now tick "no back
-- number yet" on the entry form. When their payment is confirmed, the server
-- assigns the next available number and registers the horse in the official
-- registry — permanently, per the back-numbers-for-life rule. That registry
-- write happens with the service role (the payment webhook has no signed-in
-- user), which until now could only READ the registry (schema-v28).

grant insert on horses to service_role;
