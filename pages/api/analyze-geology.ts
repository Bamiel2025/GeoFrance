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

    // Parse WMS response (XML / GML / JSON / Text)
    let extractedCode = "";
    let extractedDescription = "";
    let extractedMapSheet = "";

    if (wmsData && wmsData.rawResponse) {
      const raw = wmsData.rawResponse;

      // Extract GML fields: DESCR, TYPE, CODE_GEOL, numero, nom
      const descrMatch = raw.match(/<DESCR>([^<]+)<\/DESCR>/i);
      const typeMatch = raw.match(/<TYPE>([^<]+)<\/TYPE>/i);
      const codeGeolMatch = raw.match(/<CODE_GEOL>([^<]+)<\/CODE_GEOL>/i);
      const sheetNumMatch = raw.match(/<numero>([^<]+)<\/numero>/i);
      const sheetNameMatch = raw.match(/<nom>([^<]+)<\/nom>/i);

      if (descrMatch) {
        extractedDescription = descrMatch[1].trim();
        if (typeMatch) extractedDescription += ` (${typeMatch[1].trim()})`;
      }
      if (codeGeolMatch) extractedCode = codeGeolMatch[1].trim();

      if (sheetNumMatch && sheetNameMatch) {
        extractedMapSheet = `Feuille 1/50 000 n°${sheetNumMatch[1].trim()} (${sheetNameMatch[1].trim()})`;
      } else if (sheetNameMatch) {
        extractedMapSheet = `Feuille 1/50 000 : ${sheetNameMatch[1].trim()}`;
      }

      // JSON Fallback
      if (!extractedCode && raw.includes('{')) {
        try {
          const jsonData = JSON.parse(raw);
          if (jsonData.features && jsonData.features.length > 0) {
            const props = jsonData.features[0].properties;
            extractedCode = props.NOTATION || props.CODE || props.CODE_GEOL || "";
            extractedDescription = props.DESCR || props.DESCRIPTION || "";
          }
        } catch (e) {
          // Ignore
        }
      }

      console.log("Extracted BRGM metadata:", { extractedCode, extractedDescription, extractedMapSheet });
    }

    const manualCode = wmsData?.manualCode;

    // Build prompt
    let wmsInfo = "";
    let instructions = "";

    if (manualCode) {
      wmsInfo = `USER_OVERRIDE_CODE: The user explicitly specified the geological formation code as "${manualCode}".
      MAP_SHEET_CONTEXT: ${extractedMapSheet || 'Unknown'}
      LITHOLOGY_CONTEXT: ${extractedDescription || 'Unknown'}`;

      instructions = `1. IDENTITY: You MUST use code "${manualCode}".
2. DESCRIPTION: Use the "${manualCode}" code combined with the map sheet context and visual image to provide an accurate geological analysis.`;
    } else {
      wmsInfo = `BRGM_DATABASE_CONTEXT:
- 1/50 000 Geological Map Sheet (Carte de référence): ${extractedMapSheet || 'Inconnue'}
- Regional Lithology (1/1 000 000 BRGM): ${extractedDescription || 'Inconnue'} (Code litho: ${extractedCode || 'N/A'})
- Raw BRGM Response: ${wmsData?.rawResponse ? wmsData.rawResponse.substring(0, 500) : 'None'}`;

      instructions = `1. DÉTERMINATION DU CODE GÉOLOGIQUE ET DE LA FORMATION (CRUCIAL):
   - Vous êtes sur la carte géologique 1/50 000 BRGM ("${extractedMapSheet || 'France'}").
   - Identifiez le code/notation de la formation géologique sous le curseur au centre de l'image (ex: 'c6b', 'c5', 'e5', 'm2', 'j3', 'g1', 'Fy-z', 'R', 'n3', etc.).
   - Utilisez vos connaissances approfondies des cartes géologiques 1/50 000 BRGM pour valider le code avec les couleurs chronostratigraphiques (Vert=Crétacé, Bleu=Jurassique, Jaune=Miocène/Pliocène, Orange/Marron=Eocène/Oligocène, Blanc/Gris=Quaternaire).

2. STRATIGRAPHIE ET LITHOLOGIE EXPLICATIVE:
   - Fournissez l'âge stratigraphique exact (ex: Maastrichtien, Santonien, Bartonien, Cénomanien, etc.) et l'âge estimé en millions d'années (ex: ~70 Ma).
   - Rédigez une description lithologique détaillée de la formation telle que définie dans la notice explicative officielle BRGM de la feuille "${extractedMapSheet || 'carte 1/50 000'}".

3. PALÉOGÉOGRAPHIE ET RECONSTITUTION:
   - Décrivez l'environnement de dépôt (marin, lacustre, d'eau douce, etc.), le climat, le niveau marin et le paysage à l'époque.
   - Indiquez le nom de la période majeure en anglais dans 'period_en' (ex: 'Cretaceous', 'Jurassic', 'Eocene', 'Triassic', 'Neogene') pour permettre la recherche d'une carte paléogéographique.

4. FOSSILES CARACTÉRISTIQUES (NOTICE BRGM):
   - Citez les fossiles caractéristiques répertoriés dans la notice BRGM pour cette formation précise et cette feuille géologique (genres/espèces d'ammonites, rudistes, foraminifères, etc.).
   - Fournissez le nom scientifique du genre en nom simple dans 'scientific_query' (ex: 'Perisphinctes', 'Hippurites', 'Nummulites', 'Tetragonites') sans espaces pour permettre l'affichage de l'image Wikipedia.`;
    }

    const prompt = `You are an expert geologist analyzing a 1/50 000 BRGM geological map of France.
Your Goal: Provide an exact, high-precision scientific analysis of the geological formation at coordinates (Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}).

Context:
${wmsInfo}
Visual Map Image: Attached 50k map snippet centered at coordinates.

INSTRUCTIONS:
${instructions}
CRITICAL: ALL ANSWERS MUST BE IN FRENCH.
RÉPONDEZ OBLIGATOIREMENT EN FRANÇAIS.

Respond strictly in valid JSON:
{
  "code": "[Exact geological code notation, e.g. c6b, e5, m2, Fy-z]",
  "confidence": "[0-100]%",
  "verification_reason": "Explication courte de la validation du code",
  "location_name": "Nom de la commune ou localité",
  "map_sheet": "${extractedMapSheet || 'Nom de la feuille 1/50k'}",
  "age": "Âge stratigraphique (en français, ex: Maastrichtien (Crétacé supérieur))",
  "age_ma": "Âge estimé en Ma (ex: ~70 Ma)",
  "formation": "Nom de la formation géologique (en français)",
  "lithology": "Description des roches (en français)",
  "description": "Explication géologique complète (en français)",
  "paleogeography": {
    "environment": "Environnement de dépôt (en français)",
    "climate": "Paléoclimat (en français)",
    "temperature": "Température moyenne estimée (ex: 22°C)",
    "sea_level": "Niveau de la mer (en français)",
    "sea_level_m": "Niveau relatif (ex: +80m)",
    "context": "Paysage et paléoenvironnement (en français)",
    "period_en": "Major period name in English (e.g. Cretaceous, Jurassic, Eocene, Triassic)"
  },
  "fossils": [
    {
      "name": "Nom pédagogique et latin (ex: Ammonite (Perisphinctes))",
      "scientific_query": "Nom du genre latin sans espace (ex: Perisphinctes)"
    }
  ]
}`;

    const parts: any[] = [];

    if (wmsData?.mapImageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: wmsData.mapImageBase64
        }
      });
    }

    parts.push({ text: prompt });

    console.log("Calling Gemini API with BRGM 50k sheet context:", extractedMapSheet || "None");

    const modelName = "gemini-2.5-flash";
    let attempts = 0;
    const maxAttempts = 3;
    let text: string | undefined;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        const response = await ai.models.generateContent({
          model: modelName,
          contents: parts
        });
        text = response.text;
        if (text) break;
      } catch (err: any) {
        console.warn(`Attempt ${attempts} failed: ${err.message}`);
        if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
          throw new Error("Le quota de l'API Gemini 2.5 Flash est dépassé (Limité à 5 requêtes/min). Veuillez attendre 20 secondes avant de réessayer.");
        }
        if (attempts === maxAttempts) {
          if (err.message?.includes('503') || err.message?.includes('Overloaded')) {
            throw new Error("Le modèle IA (Gemini 2.5) est actuellement surchargé. Veuillez réessayer dans quelques instants.");
          }
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }

    if (!text) {
      try {
        const retryResponse = await ai.models.generateContent({
          model: modelName,
          contents: prompt
        });
        text = retryResponse.text;
      } catch (err) {
        console.error("Fallback text-only failed", err);
      }
    }

    if (!text) {
      throw new Error("Réponse vide de l'IA");
    }

    text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      text = text.substring(firstBrace, lastBrace + 1);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("JSON Parse Error:", text.substring(0, 200));
      throw new Error("Format de réponse invalide");
    }

    const result: GeologyAnalysis = {
      ...data,
      coords: { lat, lng },
      sources: []
    };

    console.log("Success:", data.code, data.formation);
    res.status(200).json(result);

  } catch (error: any) {
    console.error("Error:", error?.message || error);
    res.status(500).json({
      error: error?.message || "Erreur inconnue lors de l'analyse"
    });
  }
}
