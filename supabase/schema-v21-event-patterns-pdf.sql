-- schema-v21: event-level rider Patterns PDF
-- Run in Supabase: SQL Editor -> New query -> paste -> Run

alter table events add column if not exists patterns_pdf_url text;
