import { clsx, type ClassValue } from "clsx" // Librería para construir strings de clases condicionalmente
import { twMerge } from "tailwind-merge" // Librería para fusionar clases de Tailwind y evitar conflictos

// Función de utilidad 'cn' (Class Names)
// Combina clsx (lógica condicional) y twMerge (limpieza de Tailwind)
// Ejemplo: cn('p-4', isError && 'bg-red-500') -> Si es error, devuelve 'p-4 bg-red-500'
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// Definimos la estructura (interface) de lo que devuelve nuestra función de parseo de fechas
export interface JdeDateResult {
    date: Date; // Objeto Date de Javascript
    subBlock: string; // El código del primer dígito (ej: "1", "3")
    subBlockName: string; // El nombre legible (ej: "Funes 1")
}

// Esta función convierte las fechas extrañas de JDE (formato Julian: CYYDDD) a fechas normales
// jdeDate: El número que viene de la BD (ej: 124001)
// wamcu: El código de planta (opcional) para saber el contexto
export function parseJdeDate(jdeDate: number | string, wamcu?: string): JdeDateResult | null {
    // Convertimos a string y aseguramos que tenga 6 dígitos rellenando con ceros a la izquierda si hace falta
    const str = jdeDate.toString().trim().padStart(6, '0');

    // Si no tiene 6 caracteres, no es válido
    if (str.length !== 6) return null;

    // JDE Date format: C YY DDD
    // C (Centuria): 1 = 2000s
    // YY: Año (ej: 24 para 2024)
    // DDD: Día del año (1 a 366)

    const subBlockCode = str[0]; // El primer dígito se usa a veces para sub-líneas
    const yearShort = parseInt(str.substring(1, 3), 10); // Caracteres 1 y 2 son el año
    const dayOfYear = parseInt(str.substring(3), 10); // Los últimos 3 son el día del año

    const fullYear = 2000 + yearShort; // Calculamos el año completo (2024)

    // Creamos la fecha: Año, Mes 0 (Enero), Día 'dayOfYear'
    // Javascript maneja automáticamente sumar los días al 1 de Enero
    const date = new Date(fullYear, 0, dayOfYear);
    date.setMonth(0, 1); // Reiniciamos a 1 Enero
    date.setDate(dayOfYear); // Sumamos los días

    let subBlockName = "Desconocido"; // Valor por defecto

    // Limpiamos el código de planta (quitamos espacios)
    const plantCode = wamcu ? wamcu.trim() : "";

    // Lógica para determinar el nombre de la línea según la planta
    if (plantCode === "10100") {
        subBlockName = "Aguilar";
        // Aquí asumimos que para Aguilar no hay desglose complejo por ahora
    } else if (plantCode === "10200") {
        subBlockName = "Corella";
    } else if (plantCode === "10300") {
        // Lógica específica para Funes (Planta 10300) basada en el primer dígito (subBlockCode)
        switch (subBlockCode) {
            case '1': case '3': subBlockName = "Funes 1"; break; // '1' = codificación antigua, '3' = actual
            case '2': case '4': subBlockName = "Funes 2"; break; // '2' = codificación antigua, '4' = actual
            case '5': subBlockName = "Funes Pasteurizado"; break;
            default: subBlockName = `Funes (Línea ${subBlockCode})`; break;
        }
    } else {
        // Si no sabemos la planta, intentamos adivinar por el código estándar
        switch (subBlockCode) {
            case '1': subBlockName = "Aguilar"; break;
            case '2': subBlockName = "Corella"; break;
            case '3': subBlockName = "Funes 1"; break;
            case '4': subBlockName = "Funes 2"; break;
            case '5': subBlockName = "Funes Pasteurizado"; break;
            default: subBlockName = `Línea ${subBlockCode}`; break;
        }
    }

    // Devolvemos el objeto con la fecha calculada y los nombres
    return {
        date,
        subBlock: subBlockCode,
        subBlockName
    };
}

// Función para parsear cantidades que vienen multiplicadas por 100 en JDE
// Ej: 1500 en BD significa 15.00
export function parseWasOqs(val: number | string): number {
    if (typeof val === 'number') return val / 100; // Si ya es número, dividimos
    return parseFloat(val.toString()) / 100; // Si es texto, convertimos a decimal y dividimos
}

// Equivalente nativo a getDayOfYear de date-fns
// Devuelve el día del año (1-366) para una fecha dada
export function getDayOfYear(date: Date): number {
    return Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
}

// Convierte una fecha ISO (YYYY-MM-DD) al formato Julian de JDE (CYYDDD)
// Ej: '2024-01-15' → 124015
export function isoToJulian(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayOfYear = getDayOfYear(date);
    const c = Math.floor((y - 1900) / 100);
    const yy = y - 1900 - c * 100;
    return c * 100000 + yy * 1000 + dayOfYear;
}
