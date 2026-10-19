import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { AppController, AppState } from "./app";

const Ctx = createContext<AppController | null>(null);

export function AppProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export type UseApp = AppState
  & Pick<AppController, "syncNow" | "login" | "setPin" | "unlock" | "unlockBiometric" | "lock" | "logout" | "quotes" | "quotePdf" | "shareQuotePdf">
  & { controller: AppController };

/** Estado de la app + acciones. Requiere `<AppProvider>`. */
export function useApp(): UseApp {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp() requiere <AppProvider>.");
  const state = useSyncExternalStore(c.subscribe, c.getState);
  const actions = useMemo(() => ({
    syncNow: () => c.syncNow(),
    login: (e: string, p: string, d: string) => c.login(e, p, d),
    setPin: (pin: string) => c.setPin(pin),
    unlock: (pin: string) => c.unlock(pin),
    unlockBiometric: () => c.unlockBiometric(),
    lock: () => c.lock(),
    logout: () => c.logout(),
    quotes: c.quotes,
    quotePdf: c.quotePdf,
    shareQuotePdf: c.shareQuotePdf,
  }), [c]);
  return { ...state, ...actions, controller: c };
}
