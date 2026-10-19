"use client";

import Image from "next/image";
import Link from "next/link";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem } from "@/components/nova/ui/sidebar";
import { ScrollArea } from "@/components/nova/ui/scroll-area";
import { NavItem, NavMain } from "@/components/shadcn-space/blocks/sidebar-01/nav-main";

// Sidebar 01 de ShadcnSpace (Admin Dashboard Sidebar) adaptado a la app: `items` llega
// por props (el armazón de los paneles Nova lo construye con los paneles reales de
// lib/panels.ts), el logo es el de Elaborados Naturales en vez del de ShadcnSpace y se
// quitó la tarjeta promocional «Grab Pro Now» (imagen remota y botón de compra). La
// estructura (cabecera, ScrollArea, NavMain) y las clases del bloque, sin tocar. Va con
// variant="inset" y colapso a iconos, como el sidebar del dashboard de referencia y
// /admin. Ver components/nova/README.md.
// Adaptación: `pl-0 pr-2` en vez del `px-0` del bloque. Sin el margen derecho, el panel de la
// barra (z-10) llega hasta el mismo píxel donde la tarjeta de contenido dibuja su contorno y su
// sombra, y los tapa: la línea que separa la barra del contenido se ve blanca. Con 8 px
// libres a la derecha (como el `p-2` del `inset` de la referencia) se ven el contorno y la
// sombra suave a su izquierda.
export type { NavItem };

export function AppSidebar({ items }: { items: NavItem[] }) {
  return (
    <Sidebar variant="inset" collapsible="icon" className="pl-0 pr-2 h-full [&_[data-slot=sidebar-inner]]:h-full">
      <div className="flex flex-col gap-6">
        {/* ---------------- Header ---------------- */}
        <SidebarHeader className="px-4 pt-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/" className="w-full h-full">
                {/* Logo completo abierto; cuadrado con iniciales cuando está colapsado */}
                <Image src="/logo.png" alt="Elaborados Naturales" width={112} height={50} priority className="h-10 w-auto group-data-[collapsible=icon]:hidden" />
                <span className="hidden size-8 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:flex">
                  EN
                </span>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* ---------------- Content ---------------- */}
        <SidebarContent className="overflow-hidden">
          <ScrollArea className="h-[calc(100vh-100px)]">
            <div className="px-4 group-data-[collapsible=icon]:px-2">
              <NavMain items={items} />
            </div>
          </ScrollArea>
        </SidebarContent>
      </div>
    </Sidebar>
  );
}
