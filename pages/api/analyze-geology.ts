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

    // Parse WMS response for direct code extraction
    let extractedCode = "";
    let extractedDescription = "";

    if (wmsData && wmsData.rawResponse) {
      try {
        const jsonData = JSON.parse(wmsData.rawResponse);
        if (jsonData.features && jsonData.features.length > 0) {
          const props = jsonData.features[0].properties;
          extractedCode = props.NOTATION || props.CODE || props.notation || props.code || "";
          extractedDescription = props.DESCR || props.DESCRIPTION || props.descr || "";
          console.log("Extracted from vector layer:", { extractedCode, extractedDescription });
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

    const manualCode = wmsData?.manualCode;

    // Build prompt based on available inputs
    let wmsInfo = "";
    let instructions = "";

    if (manualCode) {
      // CASE 1: User provided a manual code. 
      // Identity: TRUST MANUAL CODE. 
      // Context: Use WMS + Image + Knowledge.
      wmsInfo = `USER_INPUT: The user has manually identified the code as "${manualCode}".
      DB_CONTEXT: The database at this location had "${extractedCode}" ("${extractedDescription}").`;

      instructions = `1. IDENTITY: You MUST output code "${manualCode}".
2. DESCRIPTION: Use the "${manualCode}" value combined with the DB_CONTEXT and the visual map to provide a rich geological description.
3. CONTEXT: If the manual code "${manualCode}" implies a specific age or formation, use your internal knowledge to describe it, while CROSS-REFERENCING the visual details (e.g., adjacent layers) to explain the paleogeography.`;
    } else if (extractedCode) {
      // CASE 2: Visual Priority Rule.
      // Identity: Map Image > WMS Hint.
      // Context: Use inferred code + WMS Hint.
      wmsInfo = `DB_HINT: The database suggests code "${extractedCode}" (${extractedDescription}).
WARNING: The database layer (GEO50K_HARM) is often spatially misaligned.`;

      instructions = `1. IDENTITY: The user's exact point of interest is located directly in the DEAD CENTER of the provided image.
   - Locate the exact center pixel of the image.
   - Read the geological code written on the map for that central polygon (e.g., 'e5-4', 'Py', 'j9ad').
   - DO NOT USE CODES FROM ADJACENT POLYGONS. Only use the code covering the exact center.
   - If the visual code at the center is clearly visible and differs from "${extractedCode}", you MUST TRUST THE IMAGE.
   - Only if the central area is completely unreadable should you fall back to "${extractedCode}".
2. DESCRIPTION: Describe the geological unit matching your identified visual code. Use the "${extractedDescription}" only as a supporting hint if it logically aligns with your visual identification.`;
    } else if (wmsData?.rawResponse) {
      // CASE 3: Only raw WMS text available
      wmsInfo = `DB_HINT: Database raw response: ${wmsData.rawResponse.substring(0, 500)}`;
      instructions = `1. Identify the code located strictly at the EXACT CENTER of the map image.\n2. Use the DB_HINT only if the center is unreadable.\n3. Provide the description for the central unit.`;
    } else {
      // CASE 4: No WMS info
      instructions = `1. Identify the geological code strictly covering the EXACT CENTER of the map image.\n2. Provide the description for that specific unit.`;
    }

    const prompt = `You are an expert geologist analysing a geological map of France (BRGM 1/50000).
Your Goal: Identify the geological unit EXACTLY as written on the map image at the specific point queried by the user.

Context:
Location: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}
${wmsInfo}
Visual Map: See attached image. The location the user clicked is exactly at the CENTER of the image.

INSTRUCTIONS:
${instructions}
IMPORTANT: ALL YOUR ANSWERS AND DESCRIPTIONS MUST BE IN FRENCH. 
RÉPONDEZ OBLIGATOIREMENT EN FRANÇAIS. Toutes les données récupérées ou générées (lithologie, paléogéographie, âge, formation, description, fossiles) doivent être rédigées et traduites en français.

Response strictly in valid JSON:
{"code":"[Exact code]","location_name":"commune","map_sheet":"feuille 1/50k","age":"stratigraphic age (en français)","age_ma":"âge estimé en millions d'années (ex: ~150 Ma)","formation":"formation name (en français)","lithology":"rock description (en français)","description":"detailed geological context (en français)","paleogeography":{"environment":"depositional environment (en français)","climate":"paleoclimate (en français)","temperature":"température moyenne estimée (ex: 25°C)","sea_level":"sea level (en français)","sea_level_m":"niveau marin par rapport à l'actuel (ex: +50m)","context":"landscape description (en français)"},"fossils":["nom du fossile 1 (en français)","nom du fossile 2 (en français)"]}`;

    // Build content parts
    const parts: any[] = [];

    // Add image if available
    if (wmsData?.mapImageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: wmsData.mapImageBase64
        }
      });
    }

    // Add text prompt
    parts.push({ text: prompt });

    console.log("Calling Gemini API, code:", extractedCode || "none", "hasImage:", !!wmsData?.mapImageBase64);

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
        if (text) break; // Success
      } catch (err: any) {
        console.warn(`Attempt ${attempts} failed: ${err.message}`);

        // Check for Quota Exceeded (429)
        if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
          console.error("Quota Exceeded for gemini-2.5-flash");
          throw new Error("Le quota de l'API Gemini 2.5 Flash est dépassé (Limité à 5 requêtes/min). Veuillez attendre 20 secondes avant de réessayer.");
        }

        if (attempts === maxAttempts) {
          // Return a user friendly message for 503 overload
          if (err.message.includes('503') || err.message.includes('Overloaded')) {
            throw new Error("Le modèle IA (Gemini 2.5) est actuellement surchargé. Veuillez réessayer dans quelques instants.");
          }
          throw err;
        }
        // Simple backoff
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }

    if (!text) {
      // Try without image as last resort if image was the issue (unlikely for 503 but possible for 400s)
      console.log("Empty response, retrying without image...");
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

    // Clean response
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
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

    // REMOVED: Force code override logic
    // We now trust the AI's visual analysis over the harmonized layer if they differ
    if (extractedCode && data.code !== extractedCode) {
      console.log(`AI chose code "${data.code}" over harmonized "${extractedCode}". Accepting AI choice.`);
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
    // Send 500 but with clean error message for frontend
    res.status(500).json({
      error: error?.message || "Erreur inconnue lors de l'analyse"
    });
  }
}