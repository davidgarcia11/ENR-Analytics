"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";

export type ThemeMode = "light" | "dark" | "system";

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

// Selector Claro/Oscuro/Sistema — no persiste entre recargas (el proyecto no usa
// localStorage/sessionStorage en componentes), vuelve a "Sistema" en cada carga.
export default function ModeToggle({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (m: ThemeMode) => void;
}) {
  const Icon = ICONS[mode];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="rounded-full cursor-pointer">
            <Icon size={16} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem className="gap-2 px-2 py-1.5" onClick={() => onChange("light")}>
          <Sun size={16} />
          <span>Claro</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-2 py-1.5" onClick={() => onChange("dark")}>
          <Moon size={16} />
          <span>Oscuro</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-2 py-1.5" onClick={() => onChange("system")}>
          <Monitor size={16} />
          <span>Sistema</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
