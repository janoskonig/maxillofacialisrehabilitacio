import { z } from 'zod';

export const REMOVABLE_TYPES = ['zárólemez','részleges akrilátlemezes fogpótlás','teljes lemezes fogpótlás','fedőlemezes fogpótlás','kapocselhorgonyzású részleges fémlemezes fogpótlás','kombinált fogpótlás kapocselhorgonyzással','kombinált fogpótlás rejtett elhorgonyzási eszközzel'] as const;
export const FIXED_TYPES = ['rögzített fogpótlás fogakon elhorgonyozva','cementezett rögzítésű implantációs korona/híd','csavarozott rögzítésű implantációs korona/híd'] as const;
export const EXISTING_PROSTHESIS_TYPES = [...REMOVABLE_TYPES,...FIXED_TYPES,'sebészi sablon készítése'] as const;
export const existingProsthesisTypesSchema = z.array(z.enum(EXISTING_PROSTHESIS_TYPES)).max(11)
  .refine(types => new Set(types).size === types.length,'Ismétlődő fogpótlástípus')
  .refine(types => types.filter(t => (REMOVABLE_TYPES as readonly string[]).includes(t)).length <= 1,'Állcsontonként egyféle kivehető fogpótlás választható.');
export function existingTypes(types: string[] | null | undefined, legacy: string | null | undefined): string[] {
  return types ?? (legacy ? [legacy] : []);
}
export const isFixedDevice = (type: string) => ['fixed','screw_retained_implant_bridge'].includes(type);
export function canAddDevice(devices: Array<{jaw:string;prosthesis_type:string}>, jaw: string, type: string): boolean {
  return isFixedDevice(type) || !devices.some(p => p.jaw === jaw && !isFixedDevice(p.prosthesis_type));
}
