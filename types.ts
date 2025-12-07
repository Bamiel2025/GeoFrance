export interface GeologyAnalysis {
  code: string;        // Notation carte (ex: J9b)
  location_name: string; // Commune ou lieu-dit
  map_sheet: string;   // Feuille 1/50k (ex: n°123 Nom)
  age: string;
  lithology: string;
  formation: string;
  description: string;
  
  // Nouveau contexte Paléo
  paleogeography: {
    environment: string; // Ex: Lagon tropical, Delta, Haute mer...
    climate: string;     // Ex: Tropical humide, Glaciaire...
    sea_level: string;   // Ex: Transgression marine (montée des eaux)
    context: string;     // Description narrative courte
  };
  
  // Nouveaux Fossiles
  fossils: string[];     // Liste des fossiles caractéristiques
  
  coords: {
    lat: number;
    lng: number;
  };
  sources?: {
    uri: string;
    title: string;
  }[];
}

export enum LoadingState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface WMSData {
  rawResponse: string; // The HTML or Text returned by BRGM WMS GetFeatureInfo
  mapImageBase64?: string; // Visual snapshot of the map for AI analysis
}