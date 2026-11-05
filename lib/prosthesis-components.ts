/** The clinician's catalog. The context is part of each identity, including the two pontic entries. */
export const COMPONENT_CONTEXTS = { tooth:'Fogakra', position:'Fogak helyére', implant:'Implantátumra' } as const;
export type ComponentContext = keyof typeof COMPONENT_CONTEXTS;
export const PROSTHESIS_COMPONENTS = {
  tooth_single_crown:{context:'tooth',label:'Szólókorona',code:'SzK'},
  tooth_anchor_crown:{context:'tooth',label:'Horgonykorona',code:'HK'},
  tooth_inlay_onlay:{context:'tooth',label:'Inlay/onlay (betét)',code:'IO'},
  tooth_pontic:{context:'tooth',label:'Hézagfog (pontic)',code:'H'},
  tooth_clasp_crown:{context:'tooth',label:'Kapocstartó korona',code:'KK'},
  tooth_post_core:{context:'tooth',label:'Gyökércsapos műcsonk',code:'CsM'},
  tooth_post_core_ball:{context:'tooth',label:'Gyökércsapos műcsonk gömbretenciós felépítménnyel',code:'CsG'},
  tooth_primary_telescope:{context:'tooth',label:'Primer teleszkóp',code:'PT'},
  position_denture_tooth:{context:'position',label:'Műfog',code:'MF'},
  position_implant:{context:'position',label:'Implantátum',code:'I'},
  implant_single_crown_cemented:{context:'implant',label:'Szólókorona cementezett',code:'Kc'},
  implant_single_crown_screwed:{context:'implant',label:'Szólókorona csavarozott',code:'Ks'},
  implant_anchor_crown_cemented:{context:'implant',label:'Horgonykorona cementezett',code:'HKc'},
  implant_anchor_crown_screwed:{context:'implant',label:'Horgonykorona csavarozott',code:'HKs'},
  implant_pontic:{context:'implant',label:'Hézagfog',code:'Hi'},
  implant_ball_head:{context:'implant',label:'Gömbretenciós fej',code:'G'},
  implant_locator_head:{context:'implant',label:'Locator fej',code:'L'},
  implant_bar_anchor:{context:'implant',label:'Stéghorgony',code:'St'},
} as const;
export type ProsthesisComponent = keyof typeof PROSTHESIS_COMPONENTS;
export const COMPONENT_IDS = Object.keys(PROSTHESIS_COMPONENTS) as [ProsthesisComponent,...ProsthesisComponent[]];
export const LEGACY_POSITION_LABELS = { abutment:'Pillér',pontic:'Hídtest',denture_tooth:'Műfog',implant:'Implantátum',clasp:'Kapocs',attachment:'Elhorgonyzás' } as const;
export const POSITION_ROLE_VALUES = ['abutment','pontic','denture_tooth','implant','clasp','attachment',...COMPONENT_IDS] as const;
export type PositionRole = typeof POSITION_ROLE_VALUES[number];
export const MAX_PROSTHESIS_POSITIONS = POSITION_ROLE_VALUES.length * 16;
export const isDetailedPositionRole = (role:string):role is ProsthesisComponent => Object.prototype.hasOwnProperty.call(PROSTHESIS_COMPONENTS,role);
export function positionLabel(role:string,withContext=false):string {
  if(isDetailedPositionRole(role)){
    const item=PROSTHESIS_COMPONENTS[role];
    return withContext?`${COMPONENT_CONTEXTS[item.context]} · ${item.label}`:item.label;
  }
  const legacy=LEGACY_POSITION_LABELS[role as keyof typeof LEGACY_POSITION_LABELS];
  return legacy?`${legacy}${withContext?' · általános jelölés':''}`:role;
}
export function positionCode(role:string):string {
  if(isDetailedPositionRole(role))return PROSTHESIS_COMPONENTS[role].code;
  return ({abutment:'P',pontic:'H',denture_tooth:'M',implant:'I',clasp:'K',attachment:'E'} as Record<string,string>)[role]??'?';
}
export function positionAnnotations(positions:Array<{tooth:number;role:string}>):Record<number,string> {
  const result:Record<number,string>={};
  for(const p of positions)result[p.tooth]=result[p.tooth]?`${result[p.tooth]}+${positionCode(p.role)}`:positionCode(p.role);
  return result;
}
export const POSITION_LABELS:Record<string,string> = Object.fromEntries(POSITION_ROLE_VALUES.map(role=>[role,positionLabel(role)]));
