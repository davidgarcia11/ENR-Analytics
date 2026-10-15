"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/nova/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/nova/ui/sidebar";

// Sidebar 01 de ShadcnSpace (Admin Dashboard Sidebar) adaptado a la app: el bloque
// original llevaba el ítem activo en un estado interno (se activaba al hacer clic, sin
// cambiar de página) y enlaces <a>. Aquí el estado activo llega por props (`active`, lo
// calcula el armazón a partir de la ruta y de la sección elegida), los enlaces son
// next/link y un subítem puede ser un botón (`onSelect`) para cambiar de sección sin
// navegar. Estilo y estructura (secciones, colapsables, ítem activo en bg-primary)
// sin tocar. Ver components/nova/README.md.
export type NavItem = {
  label?: string;
  isSection?: boolean;
  title?: string;
  icon?: LucideIcon;
  href?: string;
  /** Ítem de la página actual (o subítem de la sección elegida). */
  active?: boolean;
  /** Si existe, el subítem es un botón en vez de un enlace. */
  onSelect?: () => void;
  children?: NavItem[];
};

export function NavMain({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item, index) => (
        <NavMainItem key={item.title || item.label || index} item={item} />
      ))}
    </>
  );
}

function NavMainItem({ item }: { item: NavItem }) {
  const hasChildren = !!item.children?.length;
  const isParentActive = !!item.active;
  const [isOpen, setIsOpen] = React.useState(isParentActive);

  // Se abre al pasar a ser el ítem activo
  React.useEffect(() => {
    if (isParentActive) {
      setIsOpen(true);
    }
  }, [isParentActive]);

  // Section label
  if (item.isSection && item.label) {
    return (
      <SidebarGroup className="p-0 pt-5 first:pt-0">
        <SidebarGroupLabel className="p-0 text-xs font-medium uppercase text-sidebar-foreground">
          {item.label}
        </SidebarGroupLabel>
      </SidebarGroup>
    );
  }

  // Item with children → collapsible
  if (hasChildren && item.title) {
    return (
      <SidebarGroup className="p-0">
        <SidebarMenu>
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <SidebarMenuItem>
              <CollapsibleTrigger
                className="w-full"
                render={
                  <SidebarMenuButton
                    id={`nav-main-trigger-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                    tooltip={item.title}
                    isActive={isParentActive}
                    className={cn(
                      "rounded-md text-sm font-medium px-3 py-2 h-9 transition-colors cursor-pointer",
                      isParentActive ? "bg-primary! text-primary-foreground!" : ""
                    )}
                  >
                    {item.icon && <item.icon size={16} />}
                    <span>{item.title}</span>
                    <ChevronRight
                      className={cn(
                        "ml-auto transition-transform duration-200",
                        isOpen && "rotate-90"
                      )}
                    />
                  </SidebarMenuButton>
                }
              />
              <CollapsibleContent>
                <SidebarMenuSub className="me-0 pe-0">
                  {item.children!.map((child, index) => (
                    <NavMainSubItem key={child.title || index} item={child} />
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  // Item without children
  if (item.title) {
    return (
      <SidebarGroup className="p-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              id={`nav-main-button-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
              tooltip={item.title}
              isActive={isParentActive}
              className={cn(
                "rounded-md text-sm font-medium px-3 py-2 h-9 transition-colors cursor-pointer",
                isParentActive ? "bg-primary! text-primary-foreground!" : ""
              )}
              render={<Link href={item.href ?? "#"} />}
            >
              {item.icon && <item.icon />}
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return null;
}

function NavMainSubItem({ item }: { item: NavItem }) {
  const hasChildren = !!item.children?.length;
  const [isOpen, setIsOpen] = React.useState(false);

  if (hasChildren && item.title) {
    return (
      <SidebarMenuSubItem>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger
            className="w-full"
            render={
              <SidebarMenuSubButton
                id={`nav-sub-trigger-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                className="rounded-md text-sm font-medium px-3 py-2 h-9"
              >
                {item.icon && <item.icon />}
                <span>{item.title}</span>
                <ChevronRight
                  className={cn(
                    "ml-auto transition-transform duration-200",
                    isOpen && "rotate-90"
                  )}
                />
              </SidebarMenuSubButton>
            }
          />
          <CollapsibleContent>
            <SidebarMenuSub className="me-0 pe-0">
              {item.children!.map((child, index) => (
                <NavMainSubItem key={child.title || index} item={child} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuSubItem>
    );
  }

  if (item.title) {
    return (
      <SidebarMenuSubItem className="w-full">
        <SidebarMenuSubButton
          id={`nav-sub-button-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
          className={cn(
            "w-full rounded-md transition-colors",
            item.active ? "bg-muted! text-foreground!" : ""
          )}
          isActive={!!item.active}
          onClick={item.onSelect}
          render={item.onSelect ? <button type="button">{item.title}</button> : <Link href={item.href ?? "#"}>{item.title}</Link>}
        />
      </SidebarMenuSubItem>
    );
  }

  return null;
}
