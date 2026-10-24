-- Run after enabling btree_gist in Supabase. This is the database guard against race-condition double bookings.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reservations ADD CONSTRAINT reservations_table_time_excl
  EXCLUDE USING gist (table_id WITH =, tstzrange(start, "end", '[)') WITH &&)
  WHERE (status = 'confirmed');
