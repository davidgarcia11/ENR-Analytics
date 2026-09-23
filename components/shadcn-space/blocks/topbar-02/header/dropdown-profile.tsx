"use client";

import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@/components/nova/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import {
  BellRing,
  BookmarkCheck,
  FileText,
  LogIn,
  LogOut,
  Settings,
} from "lucide-react";
import { puedeEntrarEnAdmin } from "@/lib/permisos";

export interface SessionUser {
  id: number;
  username: string;
  role: string;
  name: string;
  surname: string;
  permisos?: string[];
}

type Props = {
  trigger: ReactElement;
  user?: SessionUser | null;
  onLogout?: () => void;
  onPresetsClick?: () => void;
  defaultOpen?: boolean;
  align?: "start" | "center" | "end";
};

const itemClass = "px-3 py-2 text-sm cursor-pointer gap-2.5";

export function iniciales(user: SessionUser) {
  const base = user.name ? `${user.name} ${user.surname || ""}`.trim() : user.username;
  const partes = base.split(/\s+/).filter(Boolean);
  return (partes[0]?.[0] ?? "").toUpperCase() + (partes[1]?.[0] ?? "").toUpperCase();
}

const ProfileDropdown = ({ trigger, user, onLogout, onPresetsClick, defaultOpen, align = "end" }: Props) => {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger>{trigger}</DropdownMenuTrigger>

      <DropdownMenuContent className="w-72" align={align}>
        {user ? (
          <DropdownMenuGroup>
            {/* Datos de la sesión — no hay página de perfil todavía, se muestra aquí */}
            <DropdownMenuLabel className="flex items-center gap-3 px-3 py-2 font-normal">
              <Avatar className="size-9">
                <AvatarFallback>{iniciales(user)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-foreground text-sm font-semibold">
                  {user.name ? `${user.name} ${user.surname || ""}`.trim() : user.username}
                </span>
                <span className="text-muted-foreground text-xs">
                  {user.username} · {user.role}
                </span>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            {onPresetsClick && (
              <DropdownMenuItem className={itemClass} onClick={onPresetsClick}>
                <BookmarkCheck size={18} className="text-foreground" />
                <span>Presets</span>
              </DropdownMenuItem>
            )}

            {/* Próximamente: configuración de qué notificaciones recibir. No hay
                sistema de notificaciones real todavía (ver dropdown de campana). */}
            <DropdownMenuItem className={itemClass} disabled title="Próximamente">
              <BellRing size={18} className="text-foreground" />
              <span>Suscripciones de notificaciones</span>
            </DropdownMenuItem>

            {/* Panel admin: admin, o quien tenga algún permiso que desbloquee una
                sección de /admin (lib/permisos.ts). Logs sigue siendo solo de admin. */}
            {puedeEntrarEnAdmin({ role: user.role, permisos: user.permisos ?? [] }) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={itemClass} onClick={() => (window.location.href = "/admin")}>
                  <Settings size={18} className="text-foreground" />
                  <span>{user.role === "admin" ? "Panel admin" : "Configuración"}</span>
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem className={itemClass} onClick={() => (window.location.href = "/admin/logs")}>
                    <FileText size={18} className="text-foreground" />
                    <span>Logs</span>
                  </DropdownMenuItem>
                )}
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem variant="destructive" className={itemClass} onClick={onLogout}>
              <LogOut size={18} />
              <span>Cerrar sesión</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuItem className={itemClass} onClick={() => (window.location.href = "/login")}>
            <LogIn size={18} className="text-foreground" />
            <span>Iniciar sesión</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProfileDropdown;
