import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi, getToken, setToken, UNAUTHORIZED_EVENT, type ApiUser } from "@/lib/api";

interface SessionValue {
  user: ApiUser | null;
  /** true while we check a stored token with GET /auth/me */
  restoring: boolean;
  notice: string | null;
  login: (email: string, password: string) => Promise<ApiUser>;
  logout: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Restore a session after a page refresh. The token lives in sessionStorage (cleared when the tab closes).
  useEffect(() => {
    let alive = true;
    if (!getToken()) { setRestoring(false); return; }
    authApi.me()
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { setToken(null); })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, []);

  // Any 401 from the API (expired token, deactivated account) signs the user out.
  useEffect(() => {
    const onUnauthorized = () => { setUser(null); setNotice("Your session has expired. Please sign in again."); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await authApi.login(email.trim(), password);
    setNotice(null);
    setUser(u);
    return u;
  }, []);
  const logout = useCallback(() => { authApi.logout(); setUser(null); setNotice(null); }, []);

  const value = useMemo(() => ({ user, restoring, notice, login, logout }), [user, restoring, notice, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}
