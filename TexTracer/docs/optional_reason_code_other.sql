-- OPTIONAL. Not part of the frontend change and NOT applied automatically.
-- The Gate 1 "Other" rejection reason sends the free text in `notes` and needs one generic,
-- active reason code in the database (the database rejects unknown codes).
-- Run once on your database (local: psql, or the Supabase SQL editor) if you want the "Other (enter a reason)" option to work end to end.
INSERT INTO reason_codes(code, gate, description)
VALUES ('OTHER', 'gate1_intake', 'Other (see notes)')
ON CONFLICT DO NOTHING;
