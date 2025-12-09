import { GoogleGenAI } from "@google/genai";
import type { NextApiRequest, NextApiResponse } from "next";
import { GeologyAnalysis, WMSData } from "../../types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lng, wmsData }: { lat: number; lng: number; wmsData: WMSData | null } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY not found in environment variables");
    return res.status(500).json({ error: 'API key not configured. Please set GEMINI_API_KEY environment variable.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Prepare contents array (Text + Optional Image)
    const contentsParts: any[] = [];

    // 1. Image Part (Visual Grounding) - if available
    if (wmsData?.mapImageBase64) {
      contentsParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: wmsData.mapImageBase64
        }
      });
    }

    // 2. Parse WMS response for direct code extraction
    let extractedCode = "";
    let extractedNotation = "";
    let extractedDescription = "";

    if (wmsData && wmsData.rawResponse) {
      // Try to parse as JSON (from vector layer)
      try {
        const jsonData = JSON.parse(wmsData.rawResponse);
        if (jsonData.features && jsonData.features.length > 0) {
          const props = jsonData.features[0].properties;
          extractedCode = props.NOTATION || props.CODE || props.notation || props.code || "";
          extractedNotation = props.NOTATION || props.DESCR || props.LEGENDE || "";
          extractedDescription = props.DESCR || props.DESCRIPTION || props.descr || "";
          console.log("Extracted from vector layer:", { extractedCode, extractedNotation, extractedDescription });
        }
      } catch (e) {
        // Not JSON, try text parsing
        const notationMatch = wmsData.rawResponse.match(/NOTATION[:\s=]+['"]?([A-Za-z0-9\-_]+)/i);
        const codeMatch = wmsData.rawResponse.match(/CODE[:\s=]+['"]?([A-Za-z0-9\-_]+)/i);
        if (notationMatch) extractedCode = notationMatch[1];
        else if (codeMatch) extractedCode = codeMatch[1];
        console.log("Extracted from text:", { extractedCode });
      }
    }

    // 3. Build context with explicit priority on WMS data
    let contextData = "";
    if (extractedCode) {
      contextData = `
      ⚠️ DONNÉE OFFICIELLE BRGM (PRIORITÉ ABSOLUE) ⚠️
      Le serveur cartographique BRGM a retourné le CODE EXACT suivant pour ce point :
      CODE/NOTATION = "${extractedCode}"
      ${extractedDescription ? `DESCRIPTION = "${extractedDescription}"` : ""}
      
      TU DOIS OBLIGATOIREMENT utiliser ce code "${extractedCode}" dans ta réponse.
      NE PAS INVENTER un autre code. Le code BRGM fait autorité.
      `;
    } else if (wmsData && wmsData.rawResponse) {
      contextData = `
      DONNÉES SERVEUR BRGM (à analyser) :
      Voici la réponse brute du serveur cartographique :
      "${wmsData.rawResponse}"
      
      Cherche le code/notation géologique dans cette réponse.
      Si tu trouves un code (ex: n4, J9, e7, K2...), utilise-le exactement.
      `;
    } else {
      contextData = `
      ⚠️ ATTENTION : Aucune donnée serveur disponible.
      Analyse l'image de la carte géologique pour identifier le code.
      Le code est généralement visible sur la carte (ex: n4, J9, e7, K2, p2d, b2...).
      `;
    }

    const prompt = `
Tu es un expert géologue spécialisé dans la géologie française et les cartes du BRGM.

COORDONNÉES DU POINT CLIQUÉ : Latitude ${lat.toFixed(5)}, Longitude ${lng.toFixed(5)}

${contextData}

${wmsData?.mapImageBase64 ? `
IMAGE DE LA CARTE GÉOLOGIQUE :
J'ai joint une capture de la carte géologique centrée sur le point cliqué.
Le code géologique est souvent inscrit sur la carte (lettres/chiffres comme "n4", "J9", "e7"...).
${extractedCode ? `Le code BRGM "${extractedCode}" doit correspondre à ce que tu vois sur l'image.` : "Identifie le code visible sur l'image."}
` : ""}

TA MISSION :
1. IDENTIFIER le code géologique EXACT (${extractedCode ? `utilise "${extractedCode}"` : "d'après l'image ou les données serveur"})
2. Déterminer l'âge géologique correspondant à ce code
3. Décrire la lithologie et la formation
4. Reconstituer le paléo-environnement de cette époque
5. Lister les fossiles typiques de cette formation en France

RÈGLES IMPORTANTES :
- Le CODE doit être EXACTEMENT celui fourni par le BRGM${extractedCode ? ` : "${extractedCode}"` : ""}
- Ne pas inventer de code - utiliser uniquement les données fournies
- Si incertain, indique "Code incertain" mais utilise quand même le code BRGM

RÉPONDS EN JSON VALIDE UNIQUEMENT (pas de markdown, pas de texte avant/après) :
{
  "code": "${extractedCode || 'Code de la carte'}",
  "location_name": "Nom de la commune ou lieu-dit proche",
  "map_sheet": "Numéro et nom de la feuille 1/50000",
  "age": "Âge stratigraphique complet (ex: Miocène supérieur, Tortonien)",
  "formation": "Nom de la formation géologique",
  "lithology": "Description lithologique détaillée",
  "description": "Synthèse géologique du contexte local",
  "paleogeography": {
    "environment": "Type d'environnement de dépôt (ex: Mer épicontinentale, Lac, Delta)",
    "climate": "Climat de l'époque (ex: Tropical humide, Tempéré)",
    "sea_level": "Contexte eustatique (ex: Transgression marine)",
    "context": "Description narrative du paysage ancien"
  },
  "fossils": ["Liste", "des", "fossiles", "caractéristiques"]
}
`;

    contentsParts.push({ text: prompt });

    console.log("Calling Gemini API with extracted code:", extractedCode || "none");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contentsParts
    });

    let text = response.text;
    console.log("Gemini response received, length:", text?.length || 0);

    if (!text) {
      throw new Error("Réponse vide de l'IA");
    }

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
      console.error("JSON Parse Error. Raw response:", text);
      throw new Error("Format de réponse invalide - impossible de parser le JSON.");
    }

    // Force the code to be the extracted one if we have it
    if (extractedCode && data.code !== extractedCode) {
      console.warn(`AI returned code "${data.code}" but BRGM said "${extractedCode}". Overriding.`);
      data.code = extractedCode;
    }

    const result: GeologyAnalysis = {
      ...data,
      coords: { lat, lng },
      sources: []
    };

    console.log("Successfully parsed geology analysis:", data.code, "-", data.formation);
    res.status(200).json(result);

  } catch (error: any) {
    console.error("Erreur Gemini complète:", error);
    const errorMessage = error?.message || error?.toString() || "Erreur inconnue";
    res.status(500).json({
      error: `Erreur d'analyse: ${errorMessage}`,
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
}