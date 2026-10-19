import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { AppController, AppState } from "./app";

const Ctx = createContext<AppController | null>(null);

export function AppProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export type UseApp = AppState
  & Pick<AppController, "syncNow" | "checkUpdate" | "startUpdate" | "login" | "setPin" | "unlock" | "unlockBiometric" | "lock" | "logout" | "quotes" | "customers" | "sales" | "inventory" | "quotePdf" | "shareQuotePdf">
  & { controller: AppController; /** ¿El usuario tiene el permiso? */ can: (permission: string) => boolean };

/** Estado de la app + acciones. Requiere `<AppProvider>`. */
export function useApp(): UseApp {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp() requiere <AppProvider>.");
  const state = useSyncExternalStore(c.subscribe, c.getState);
  const actions = useMemo(() => ({
    syncNow: () => c.syncNow(),
    checkUpdate: () => c.checkUpdate(),
    startUpdate: () => c.startUpdate(),
    login: (e: string, p: string, d: string) => c.login(e, p, d),
    setPin: (pin: string) => c.setPin(pin),
    unlock: (pin: string) => c.unlock(pin),
    unlockBiometric: () => c.unlockBiometric(),
    lock: () => c.lock(),
    logout: () => c.logout(),
    quotes: c.quotes,
    customers: c.customers,
    sales: c.sales,
    inventory: c.inventory,
    quotePdf: c.quotePdf,
    shareQuotePdf: c.shareQuotePdf,
  }), [c]);
  const can = useMemo(() => { const set = new Set(state.permissions); return (p: string) => set.has(p); }, [state.permissions]);
  return { ...state, ...actions, can, controller: c };
}
