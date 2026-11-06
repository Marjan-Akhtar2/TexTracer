// Test-only no-op: the integration test passes configuration through real environment variables,
// so the project's real backend/.env (with production secrets) is never loaded.
module.exports = { config() { return { parsed: {} }; } };
