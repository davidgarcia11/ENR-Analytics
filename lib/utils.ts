import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export interface JdeDateResult {
    date: Date;
    subBlock: string;
    subBlockName: string;
}

export function parseJdeDate(jdeDate: number | string, wamcu?: string): JdeDateResult | null {
    const str = jdeDate.toString().trim().padStart(6, '0');
    if (str.length !== 6) return null;

    const subBlockCode = str[0];
    const yearShort = parseInt(str.substring(1, 3), 10);
    const dayOfYear = parseInt(str.substring(3), 10);

    const fullYear = 2000 + yearShort;
    const date = new Date(fullYear, 0, dayOfYear);
    date.setMonth(0, 1);
    date.setDate(dayOfYear);

    let subBlockName = "Desconocido";

    // Clean WAMCU (remove spaces)
    const plantCode = wamcu ? wamcu.trim() : "";

    if (plantCode === "10100") {
        subBlockName = "Aguilar";
        // If needed, we can add "Línea X" if the code isn't 1?
        // User didn't specify sublines for Aguilar/Corella, just that 1=Aguilar. 
        // If code is not 1, maybe it's anomalous, but context is Aguilar.
    } else if (plantCode === "10200") {
        subBlockName = "Corella";
    } else if (plantCode === "10300") {
        // Funes Logic
        switch (subBlockCode) {
            case '3': subBlockName = "Funes 1"; break;
            case '4': subBlockName = "Funes 2"; break;
            case '5': subBlockName = "Funes Pasteurizado"; break;
            default: subBlockName = `Funes (Línea ${subBlockCode})`; break; // Fallback for 1 or others
        }
    } else {
        // Fallback if WAMCU is missing or unknown
        switch (subBlockCode) {
            case '1': subBlockName = "Aguilar"; break;
            case '2': subBlockName = "Corella"; break;
            case '3': subBlockName = "Funes 1"; break;
            case '4': subBlockName = "Funes 2"; break;
            case '5': subBlockName = "Funes Pasteurizado"; break;
            default: subBlockName = `Línea ${subBlockCode}`; break;
        }
    }

    return {
        date,
        subBlock: subBlockCode,
        subBlockName
    };
}

export function parseWasOqs(val: number | string): number {
    if (typeof val === 'number') return val / 100;
    return parseFloat(val.toString()) / 100;
}
