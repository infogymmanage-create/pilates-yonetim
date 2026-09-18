import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xfwesxolwhopmkvqhswm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhmd2VzeG9sd2hvcG1rdnFoc3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NzE0NzUsImV4cCI6MjEwNTI0NzQ3NX0.-iAEGiwlSKqdFAIfdIxGhCVtv-n8o6lWUfUaBlgV6Is";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
