"use client";

// Los primitivos Base UI con overlay (Popover, Select, Combobox, Sheet,
// NavigationMenu) portan su contenido a <body> por defecto — fuera de
// [data-nova-theme], así que heredan el tema viejo (--primary rojo corporativo,
// #d30b15) en vez de Nova. Bug real: el botón "Aplicar" del Sheet de filtros salía
// rojo, no del gris casi negro de Nova (ver ClickUp #869epr211).
//
// Este contexto da a cada primitivo un contenedor por defecto DENTRO del scope
// Nova, sin tener que pasar `container` a mano en cada Popover/Select/Combobox de
// cada página. Cada página Nova debe envolver su contenido en <NovaPortalProvider>
// con un ref al nodo raíz que lleva data-nova-theme (ver app/produccion-v2/page.tsx).
import { createContext, useContext, type ReactNode, type RefObject } from "react";

type PortalContainer = HTMLElement | null;
const NovaPortalContext = createContext<RefObject<PortalContainer> | null>(null);

export function NovaPortalProvider({
  container,
  children,
}: {
  container: RefObject<PortalContainer>;
  children: ReactNode;
}) {
  return <NovaPortalContext.Provider value={container}>{children}</NovaPortalContext.Provider>;
}

/** Contenedor Nova activo, o `undefined` (fuera de un NovaPortalProvider, o el ref
 * aún no se ha adjuntado — el primitivo cae al comportamiento por defecto de Base
 * UI, portar a <body>). OJO: nunca devolver `null` aquí — Base UI trata
 * `container={null}` como "espera a que se resuelva" y NO renderiza el portal,
 * a diferencia de `undefined`, que sí cae al valor por defecto. */
export function useNovaPortalContainer(): HTMLElement | undefined {
  const ctx = useContext(NovaPortalContext);
  return ctx?.current ?? undefined;
}
