# Connecting the React frontend

**Status: done.** The frontend in `../frontend` is fully wired to this API (no demo data remains).
See the root `README.md` for the run steps and the list of integrations and limitations.

* API client with every endpoint and response type: `frontend/src/lib/api.ts`
* Session / token handling: `frontend/src/lib/session.tsx` (token kept in `sessionStorage`, restored through `GET /auth/me`)
* Screens: `frontend/src/views/*`, navigation per role: `frontend/src/lib/nav.ts`
* Frontend setting: `frontend/.env` -> `VITE_API_URL=http://localhost:5000/api`
* Backend setting: the frontend's address must be in `CORS_ORIGIN` in `backend/.env` (default list already contains `http://localhost:8080`).

Never put database passwords or Supabase service keys in the frontend; it only needs the API URL.
