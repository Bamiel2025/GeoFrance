import { GoogleGenAI } from "@google/genai";
import { GeologyAnalysis, WMSData } from "../types";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lng, wmsData }: { lat: number; lng: number; wmsData: WMSData | null } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
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

    const result: GeologyAnalysis = {
      ...data,
      coords: { lat, lng },
      sources
    };

    res.status(200).json(result);

  } catch (error) {
    console.error("Erreur Gemini:", error);
    res.status(500).json({ error: "Impossible d'analyser la géologie." });
  }
}