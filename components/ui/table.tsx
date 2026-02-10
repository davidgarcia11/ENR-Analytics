import * as React from "react"
import { cn } from "@/lib/utils"

// Componente Tabla contenedor
// forwardRef permite que quien use este componente pueda obtener una referencia al elemento DOM real
const Table = React.forwardRef<
    HTMLTableElement,
    React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
    // Wrapper div con overflow-auto para permitir scroll horizontal si la tabla es muy ancha
    <div className="relative w-full overflow-auto">
        <table
            ref={ref}
            // cn() ayuda a mezclar las clases por defecto "w-full..." con las que se pasen en 'className'
            className={cn("w-full caption-bottom text-sm select-text", className)}
            {...props}
        />
    </div>
))
Table.displayName = "Table"

// Componente Header de Tabla (<thead>)
const TableHeader = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

// componente Body de Tabla (<tbody>)
const TableBody = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <tbody
        ref={ref}
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
    />
))
TableBody.displayName = "TableBody"

// Fila de Tabla (<tr>)
const TableRow = React.forwardRef<
    HTMLTableRowElement,
    React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
    <tr
        ref={ref}
        // Incluye estilos como border-b (línea abajo) y hover (efecto al pasar ratón)
        className={cn(
            "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
            className
        )}
        {...props}
    />
))
TableRow.displayName = "TableRow"

// Celda de Cabecera (<th>)
const TableHead = React.forwardRef<
    HTMLTableCellElement,
    React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <th
        ref={ref}
        className={cn(
            "h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
            className
        )}
        {...props}
    />
))
TableHead.displayName = "TableHead"

// Celda Normal (<td>)
const TableCell = React.forwardRef<
    HTMLTableCellElement,
    React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <td
        ref={ref}
        className={cn(
            "p-4 align-middle [&:has([role=checkbox])]:pr-0",
            className
        )}
        {...props}
    />
))
TableCell.displayName = "TableCell"

export {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
}
