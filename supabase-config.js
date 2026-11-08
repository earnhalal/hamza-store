// Hamza Departmental Store — Supabase configuration
// ---------------------------------------------------
// Cloud sync for the shop terminal. The app reads this config in
// data.js and, when url + anonKey are present, syncs the whole shop
// state to the Supabase table `hamza_state` (single row, id = 1)
// via the REST API — laptop, phone and any other device that opens
// this same site then share one record, and changing a device loses
// nothing. localStorage remains only as an offline fallback/cache.
//
// The anon key below is Supabase's PUBLIC client key. It is designed
// to ship in browser apps: row-level security policies on the table
// are what control access. Never put the service_role key here —
// that key bypasses all security and must stay off the client.
window.HAMZA_SUPABASE_CONFIG = {
  url: "https://egacvztkqztcvuvjrysv.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnYWN2enRrcXp0Y3Z1dmpyeXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNDEyMDAsImV4cCI6MjEwOTcxNzIwMH0.jvIf8UTd56r-CIbYoTf_8a4wP97I-zJCcQMDODDucyc"
};
