// Disposable test credentials only. Any provider, database or model request is a test failure.
process.env.SUPABASE_URL = 'https://fixture.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
process.env.OPENROUTER_API_KEY = 'fixture-only';
globalThis.fetch = async () => { throw new Error('Offline test forbids network access'); };
