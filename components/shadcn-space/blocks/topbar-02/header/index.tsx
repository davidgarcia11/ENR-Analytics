"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Button } from "@/components/nova/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/nova/ui/sheet";
import { BellRing, Menu } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/nova/ui/avatar";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from "@/components/nova/ui/navigation-menu";

import NotificationDropdown from "@/components/shadcn-space/blocks/topbar-02/header/notification-dropdown";
import ProfileDropdown, { iniciales, type SessionUser } from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-profile";
import Sidebar from "@/components/shadcn-space/blocks/topbar-02/header/sidebar";
import { NavDropdown, NavButton } from "@/components/shadcn-space/blocks/topbar-02/header/desktop-nav";
import { getNavData, type ScreenConfig } from "@/components/shadcn-space/blocks/topbar-02/data";
import { NavGroup } from "@/components/shadcn-space/blocks/topbar-02/types";
import ModeToggle, { type ThemeMode } from "@/components/nova/mode-toggle";

export default function Header({
  user = null,
  onLogout,
  onPresetsClick,
  mode,
  onModeChange,
}: {
  user?: SessionUser | null;
  onLogout?: () => void;
  onPresetsClick?: () => void;
  mode?: ThemeMode;
  onModeChange?: (m: ThemeMode) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  const BREAKPOINT = 1024;
  const [screensConfig, setScreensConfig] = useState<Record<string, ScreenConfig>>({});
  const navData = getNavData(user?.role ?? null, screensConfig);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= BREAKPOINT) {
        setSheetOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Mismo endpoint y misma regla de acceso que components/Navbar.tsx — sin esto, el
  // nav mostraba siempre todos los paneles de lib/panels.ts, tuviera o no acceso real
  // el usuario a cada uno.
  useEffect(() => {
    fetch("/api/screen-permissions")
      .then((r) => (r.ok ? r.json() : {}))
      .then(setScreensConfig)
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-background">
      <div className="flex items-center justify-between max-w-7xl mx-auto p-4">
        <div className="flex items-center gap-3">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              id="mobile-sidebar-trigger"
              className="lg:hidden"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="cursor-pointer"
                >
                  <Menu size={20} />
                </Button>
              }
            />

            <SheetContent side="left" className="overflow-auto w-75!">
              <SheetTitle className="sr-only">customizer</SheetTitle>
              <a href="/" className="p-4 sticky top-0 bg-background z-10 block">
                <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
              </a>
              <Sidebar navData={navData} onLinkClick={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>

          <a href="/">
            <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
          </a>
        </div>

        <div className="flex items-center gap-2">
          {mode && onModeChange && <ModeToggle mode={mode} onChange={onModeChange} />}
          <NotificationDropdown
            defaultOpen={false}
            align="center"
            trigger={
              <div className="rounded-full p-2 hover:bg-accent">
                <BellRing className="size-4" />
              </div>
            }
          />
          <ProfileDropdown
            user={user}
            onLogout={onLogout}
            onPresetsClick={onPresetsClick}
            trigger={
              <div
                id="profile-dropdown-trigger"
                className="rounded-full cursor-pointer"
              >
                <Avatar className="size-7 rounded-full">
                  <AvatarFallback>{user ? iniciales(user) : "?"}</AvatarFallback>
                </Avatar>
              </div>
            }
          />
        </div>
      </div>

      {/* NAVIGATION BAR — caja propia con borde redondeado, igual que
          layout/horizontal/header/index.tsx del proyecto de referencia
          (border border-border rounded-lg), separada del bloque de logo/iconos. */}
      <div className="hidden lg:flex items-center justify-start gap-1 max-w-7xl mx-auto mb-2 rounded-lg border border-border px-2 py-2">
        <NavigationMenu>
          <NavigationMenuList className="flex gap-1">
            {(navData as NavGroup[]).map((item) => {
              if (item.type === "dropdown") {
                // Grupo activo: coincidencia EXACTA de ruta (o de segmento, "/x/y" cuelga
                // de "/x") con alguno de sus items — nunca por prefijo de texto suelto
                // (con startsWith, cualquier ruta que empezara por el mismo texto activaba
                // el grupo aunque no estuviera realmente en data.ts — bug real visto con
                // "/compras-v2" antes de que ese fuera el /compras real).
                const active = item.items.some(
                  (i) => i.href && i.href !== "#" && (pathname === i.href || pathname.startsWith(`${i.href}/`))
                );
                return (
                  <NavDropdown
                    key={item.label}
                    label={item.label}
                    icon={item.icon}
                    items={item.items}
                    active={active}
                  />
                );
              }

              return (
                <NavigationMenuItem key={item.label}>
                  <NavigationMenuLink
                    render={<NavButton label={item.label} icon={item.icon} />}
                  />
                </NavigationMenuItem>
              );
            })}
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </header>
  );
}
