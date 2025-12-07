import { GeologyAnalysis, WMSData } from "../types";

export const analyzeGeologyAtLocation = async (lat: number, lng: number, wmsData: WMSData | null): Promise<GeologyAnalysis> => {
  try {
    const response = await fetch('/api/analyze-geology', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lat, lng, wmsData }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erreur lors de l\'analyse');
    }

    const data: GeologyAnalysis = await response.json();
    return data;
  } catch (error) {
    console.error("Erreur lors de l'appel API:", error);
    throw new Error("Impossible d'analyser la géologie.");
  }
};