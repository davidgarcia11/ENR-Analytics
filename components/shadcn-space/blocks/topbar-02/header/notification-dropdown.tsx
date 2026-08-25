"use client";

import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import { BellOff } from "lucide-react";

type Props = {
  trigger: ReactNode;
  defaultOpen?: boolean;
  align?: "start" | "center" | "end";
};

// Sin sistema de notificaciones todavía (ver "Suscripciones de notificaciones" en el
// dropdown de perfil) — se deja el hueco montado con un estado vacío real, no con
// notificaciones de ejemplo que darían la falsa impresión de que ya funciona.
const NotificationDropdown = ({
  trigger,
  defaultOpen,
  align = "end",
}: Props) => {
  return (
    <div className="flex items-center justify-center">
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger>{trigger}</DropdownMenuTrigger>

        <DropdownMenuContent align={align} className="p-0 w-sm rounded-2xl">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center p-4">
              <p className="text-base font-medium text-popover-foreground">
                Notificaciones
              </p>
            </DropdownMenuLabel>

            <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-2 text-center">
              <BellOff size={28} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No hay notificaciones todavía
              </p>
            </div>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default NotificationDropdown;
