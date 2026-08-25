import { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  disabled?: boolean;
}

export interface NavGroup {
  type: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}
