"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/nova/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/nova/ui/sheet";
import { BellRing, Globe, Menu } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/nova/ui/avatar";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from "@/components/nova/ui/navigation-menu";

import NotificationDropdown from "@/components/shadcn-space/blocks/topbar-02/header/notification-dropdown";
import LanguageDropdown from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-language";
import ProfileDropdown from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-profile";
import Sidebar from "@/components/shadcn-space/blocks/topbar-02/header/sidebar";
import { NavDropdown, NavButton } from "@/components/shadcn-space/blocks/topbar-02/header/desktop-nav";
import NavData from "@/components/shadcn-space/blocks/topbar-02/data";
import { NavGroup } from "@/components/shadcn-space/blocks/topbar-02/types";

export default function Header() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname();
  const BREAKPOINT = 1024;

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
              <a href="#" className="p-4 sticky top-0 bg-background z-10">
                <img
                  src="https://images.shadcnspace.com/assets/logo/shadcnspace.svg"
                  alt="logo"
                  className="dark:hidden w-40 h-10"
                />
                <img
                  src="https://images.shadcnspace.com/assets/logo/shadcnspace-white.svg"
                  alt="logo"
                  className="hidden dark:block w-40 h-10"
                />
              </a>
              <Sidebar onLinkClick={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>

          <a href="#">
            <img
              src="https://images.shadcnspace.com/assets/logo/shadcnspace.svg"
              alt="logo"
              className="dark:hidden w-40 h-10"
            />
            <img
              src="https://images.shadcnspace.com/assets/logo/shadcnspace-white.svg"
              alt="logo"
              className="hidden dark:block w-40 h-10"
            />
          </a>
        </div>

        <div className="flex items-center gap-2">
          <NotificationDropdown
            defaultOpen={false}
            align="center"
            trigger={
              <div className="rounded-full p-2 hover:bg-accent relative before:absolute before:bottom-0 before:left-1/2 before:z-10 before:w-2 before:h-2 before:rounded-full before:bg-red-500 before:top-1">
                <BellRing className="size-4" />
              </div>
            }
          />
          <LanguageDropdown
            trigger={
              <div
                id="language-dropdown-trigger"
                className="rounded-full hover:bg-accent/80 cursor-pointer p-2"
              >
                <Globe size={16} />
              </div>
            }
          />
          <ProfileDropdown
            trigger={
              <div
                id="profile-dropdown-trigger"
                className="rounded-full cursor-pointer"
              >
                <Avatar className="size-7 rounded-full">
                  <AvatarImage src="https://images.shadcnspace.com/assets/profiles/user-11.jpg" />
                  <AvatarFallback>NJ</AvatarFallback>
                </Avatar>
              </div>
            }
          />
        </div>
      </div>

      {/* NAVIGATION BAR */}
      <div className="hidden lg:flex items-center justify-start gap-1 px-4 py-2 max-w-7xl mx-auto">
        <NavigationMenu>
          <NavigationMenuList className="flex gap-1">
            {(NavData as NavGroup[]).map((item) => {
              if (item.type === "dropdown") {
                // Grupo activo: coincidencia EXACTA de ruta (o de segmento, "/x/y" cuelga
                // de "/x") con alguno de sus items — nunca por prefijo de texto suelto
                // (con startsWith, "/compras-v2" activaba "Dashboards" solo porque
                // empieza por "/compras", sin estar realmente en data.ts). Mientras
                // compras-v2 no esté de verdad enlazado aquí, no debe marcarse nada.
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
