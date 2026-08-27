import { LucideIcon } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import {
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuTrigger,
} from "@/components/nova/ui/navigation-menu";
import { NavItem } from "@/components/shadcn-space/blocks/topbar-02/types";
import { cn } from "@/lib/utils";

export function NavDropdown({
  label,
  icon: Icon,
  items,
  active,
}: {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  active?: boolean;
}) {
  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger
        className={cn(
          "gap-2 rounded-lg border border-transparent cursor-pointer",
          // Base UI marca abierto con data-open/data-popup-open, NUNCA data-[state=open]
          // (eso es convención de Radix) — con el atributo equivocado este override no
          // se aplicaba nunca al abrir el desplegable, y ganaba el gris por defecto del
          // primitivo (navigation-menu.tsx: data-open:bg-muted/50) combinado con nuestro
          // text-background, casi invisible. Bug real, no solo de modo oscuro.
          //
          // focus:/data-open:focus: también hace falta: navigationMenuTriggerStyle trae
          // focus:bg-muted y data-open:focus:bg-muted, y por especificidad CSS (:focus
          // añade una pseudo-clase) ganan al bg-foreground de aquí arriba, que nunca
          // cubría la variante :focus. Al pulsar para CERRAR el desplegable, el botón
          // conserva el foco del clic → se veía blanco hasta perder el foco (clic fuera
          // de la barra). Bug real, visto en /compras y /mrp.
          active
            ? "bg-foreground text-background hover:bg-foreground hover:text-background focus:bg-foreground focus:text-background data-open:bg-foreground data-open:text-background data-open:hover:bg-foreground data-open:focus:bg-foreground data-popup-open:bg-foreground data-popup-open:text-background data-popup-open:hover:bg-foreground data-popup-open:focus:bg-foreground"
            : "hover:bg-accent data-open:border-muted data-open:bg-accent data-popup-open:border-muted data-popup-open:bg-accent"
        )}
      >
        <Icon size={16} />
        <span className="text-sm">{label}</span>
      </NavigationMenuTrigger>

      <NavigationMenuContent className="min-w-48 p-1">
        <ul className="space-y-1">
          {items.map((item) => {
            const ItemIcon = item.icon;
            if (item.disabled) {
              return (
                <li key={item.label}>
                  <span
                    aria-disabled="true"
                    title="Próximamente"
                    className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60"
                  >
                    <ItemIcon size={16} />
                    <span>{item.label}</span>
                  </span>
                </li>
              );
            }
            return (
              <li key={item.label}>
                <NavigationMenuLink
                  render={
                    <a
                      href={item.href}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-foreground"
                    >
                      <ItemIcon size={16} />
                      <span>{item.label}</span>
                    </a>
                  }
                />
              </li>
            );
          })}
        </ul>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
}

export function NavButton({
  label,
  icon: Icon,
}: {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Button variant="ghost" className="gap-2 rounded-lg">
      <Icon size={16} />
      <span className="text-sm">{label}</span>
    </Button>
  );
}
