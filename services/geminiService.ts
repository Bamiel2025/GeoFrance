import { GoogleGenAI } from "@google/genai";
import { GeologyAnalysis, WMSData } from "../types";

export const analyzeGeologyAtLocation = async (lat: number, lng: number, wmsData: WMSData | null): Promise<GeologyAnalysis> => {
  // Check if running on Vercel (production) or localhost (development)
  const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');

  if (isProduction) {
    // Use server-side API route on Vercel
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
  } else {
    // Use client-side API call for development
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Clé API manquante. Veuillez configurer VITE_GEMINI_API_KEY.");
    }

    const ai = new GoogleGenAI({ apiKey });

    // Prepare contents array (Text + Optional Image)
    const contentsParts: any[] = [];

    // 1. Image Part (Visual Grounding)
    if (wmsData?.mapImageBase64) {
      contentsParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: wmsData.mapImageBase64
        }
      });
    }

    // 2. Text Part (Context + Prompt)
    let contextData = "";
    if (wmsData && wmsData.rawResponse) {
      contextData = `
      SOURCE DE VÉRITÉ 1 (Serveur BRGM) :
      Voici la réponse technique brute du serveur cartographique pour ce point :
      "${wmsData.rawResponse}"
      (Cherche des mentions comme "Notation", "DESCRIPTION", "LIGNE_ETIQ", "CODE").
      `;
    } else {
      contextData = `Attention : La requête serveur a échoué. Fie-toi principalement à l'image de la carte.`;
    }

    const prompt = `
      Tu es un expert géologue et paléontologue. Tu dois identifier précisément la couche géologique et reconstituer son histoire ancienne.

      COORDONNÉES : Lat ${lat}, Lng ${lng}.

      ${contextData}

      SOURCE DE VÉRITÉ 2 (Image ci-jointe) :
      Je t'ai fourni une capture de la carte géologique. Compare le code serveur et le code visuel pour être sûr.

      TA MISSION DE SYNTHÈSE :
      1. Identifie le code, l'âge et la lithologie.
      2. RECONSTITUE LE PASSÉ (Paléogéographie) : À quoi ressemblait cet endroit à cette époque géologique précise ? (Mer profonde, plage tropicale, lac, chaîne de montagne ?). Quel était le climat ?
      3. IDENTIFIE LA VIE (Fossiles) : Quels sont les fossiles typiques que l'on trouve dans cette formation spécifique en France ?

      FORMAT DE RÉPONSE ATTENDU (JSON pur) :
      {
        "code": "Code notation retenu (ex: J9ad)",
        "location_name": "Commune / Lieu-dit",
        "map_sheet": "Feuille 1/50k",
        "age": "Âge stratigraphique",
        "formation": "Nom de la formation",
        "lithology": "Description lithologique",
        "description": "Analyse géologique technique.",
        "paleogeography": {
          "environment": "Ex: Mer épicontinentale peu profonde",
          "climate": "Ex: Tropical chaud",
          "sea_level": "Ex: Période de transgression marine",
          "context": "Phrase descriptive de l'ambiance de l'époque."
        },
        "fossils": ["Nom fossile 1", "Nom fossile 2", "Nom fossile 3"]
      }
    `;

    contentsParts.push({ text: prompt });

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview", // Multimodal model is required
        contents: { parts: contentsParts },
        config: {
          thinkingConfig: { thinkingBudget: 2048 },
          tools: [{ googleSearch: {} }]
        },
      });

      let text = response.text;
      if (!text) throw new Error("Réponse vide de l'IA");

      // Clean Markdown code blocks
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      // Extract JSON substring
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        text = text.substring(firstBrace, lastBrace + 1);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("JSON Parse Error", text);
        throw new Error("Format de réponse invalide.");
      }

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .map((chunk: any) => chunk.web)
        .filter((web: any) => web && web.uri && web.title)
        .map((web: any) => ({ uri: web.uri, title: web.title }));

      return {
        ...data,
        coords: { lat, lng },
        sources
      };

    } catch (error) {
      console.error("Erreur Gemini:", error);
      throw new Error("Impossible d'analyser la géologie.");
    }
  }
};