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

    // Validation helper to reject useless/error BRGM layer responses
    const isInvalidBrgm = (text: string) => {
      if (!text) return true;
      const lower = text.toLowerCase();
      return lower.includes("layernotdefined") ||
        lower.includes("non défini") ||
        lower.includes("sans géométrie") ||
        lower.includes("inconnu");
    };

    if (wmsData && wmsData.rawResponse) {
      if (isInvalidBrgm(wmsData.rawResponse)) {
        console.log("BRGM returned invalid data (e.g. LayerNotDefined). Falling back to visual analysis.");
        wmsData.rawResponse = ""; // Clear to force visual fallback (CASE 4)
      } else {
        try {
          const jsonData = JSON.parse(wmsData.rawResponse);
          if (jsonData.features && jsonData.features.length > 0) {
            const props = jsonData.features[0].properties;
            let tempCode = props.NOTATION || props.CODE || props.notation || props.code || "";
            let tempDesc = props.DESCR || props.DESCRIPTION || props.descr || "";

            if (tempCode && !isInvalidBrgm(tempCode)) extractedCode = tempCode;
            if (tempDesc && !isInvalidBrgm(tempDesc)) extractedDescription = tempDesc;

            console.log("Extracted from vector layer:", { extractedCode, extractedDescription });
          }
        } catch (e) {
          // Not JSON, try text parsing
          const notationMatch = wmsData.rawResponse.match(/NOTATION[:\s=]+['"]?([A-Za-z0-9\-_]+)/i);
          const codeMatch = wmsData.rawResponse.match(/CODE[:\s=]+['"]?([A-Za-z0-9\-_]+)/i);
          if (notationMatch && !isInvalidBrgm(notationMatch[1])) extractedCode = notationMatch[1];
          else if (codeMatch && !isInvalidBrgm(codeMatch[1])) extractedCode = codeMatch[1];
          console.log("Extracted from text:", { extractedCode });
        }
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
      // CASE 2: BRGM DB Priority Rule.
      wmsInfo = `DB_EXACT_REFERENCE: The BRGM database identifies the exact polygon as code "${extractedCode}" (${extractedDescription}).`;

      instructions = `1. IDENTITY (CRUCIAL):
   - YOU MUST ABSOLUTELY TRUST THE DB_EXACT_REFERENCE. The geological code is exactly "${extractedCode}".
   - DO NOT ATTEMPT TO READ A DIFFERENT CODE FROM THE IMAGE. The map image is an outdated scan with frequent local notations (e.g., 'e5-4') that have been modernized and harmonized in the database (e.g., 'es4' = Oligocène). Your visual reading can also hallucinate completely wrong codes (like reading 'n3' instead of 'c6b'). The DB vector code "${extractedCode}" is the absolute ground truth.
2. DESCRIPTION & STRATIGRAPHY:
   - Use the code "${extractedCode}" and base your precise geological age and lithology description strictly on the DB description: "${extractedDescription}".
   - WARNING ON PREFIXES (BRGM Lexicon):
     - 'c' (lowercase) = Crétacé (ex: c6b is Maastrichtien, NOT Carbonifère)
     - 'j' = Jurassique
     - 't' = Trias
     - 'e' = Eocène
     - 'g' = Oligocène
     - 'm' = Miocène
     - 'p' = Pliocène
     - 'q' = Quaternaire
     - 'h' = Carbonifère (Houiller)
     - 'd' = Dévonien
     - 's' = Silurien
     - 'or' = Ordovicien
     - 'k' = Cambrien
   - Apply strict scientific rigor to determine the exact age and millions of years (Ma).
3. PALEOGEOGRAPHY: The provided image is solely for you to deduce the paleogeography (environment, sea level, topography) and understand surrounding faults.
4. FOSSILS (CRUCIAL): You must query your internal knowledge of the specific **BRGM geological map notice** (Notice explicative de la carte géologique 1/50000) for this exact location and formation (the one you definitively chose).
   - Extract the EXACT fossil genera or species characteristic of this layer according to the official BRGM text (e.g., specific ammonites, rudistes, foraminifera, nummulites).
   - NEVER use generic terms like 'mollusques', 'dinosaures', or 'bivalves' alone. Give high scientific precision.`;
    } else if (wmsData?.rawResponse) {
      // CASE 3: Only raw WMS text available
      wmsInfo = `DB_HINT: Database raw response: ${wmsData.rawResponse.substring(0, 500)}`;
      instructions = `1. Identify the exact code using the DB_HINT text first. Only if the DB_HINT is totally empty or unreadable should you guess from the exact center of the map image.
2. Provide the scientific description matching the DB_HINT.
3. For Fossils, base your response on the official BRGM notice for this exact unit, providing precise species/genera, avoiding generic terms.`;
    } else {
      // CASE 4: No WMS info
      instructions = `1. Identify the geological code strictly from the EXACT CENTER of the map image. Be careful with lower case (c = Crétacé) vs upper case.
2. Provide the scientific description for that specific unit based on BRGM standards.
3. For Fossils, base your response on the official BRGM notice for this region and unit, providing precise species/genera, avoiding generic terms.`;
    }

    const prompt = `You are an expert geologist analysing a geological map of France (BRGM 1/50000).
Your Goal: Identify the geological unit EXACTLY as provided by the database query or the user.

Context:
Location: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}
${wmsInfo}
Visual Map: See attached image for spatial context (faults, neighbors, geography).

INSTRUCTIONS:
${instructions}
IMPORTANT: ALL YOUR ANSWERS AND DESCRIPTIONS MUST BE IN FRENCH. 
RÉPONDEZ OBLIGATOIREMENT EN FRANÇAIS. Toutes les données récupérées ou générées (lithologie, paléogéographie, âge, formation, description, fossiles) doivent être rédigées et traduites en français.

Response strictly in valid JSON:
{"code":"[Exact code]","location_name":"commune","map_sheet":"feuille 1/50k","age":"stratigraphic age (en français)","age_ma":"âge estimé en millions d'années (ex: ~150 Ma)","formation":"formation name (en français)","lithology":"rock description (en français)","description":"detailed geological context (en français)","paleogeography":{"environment":"depositional environment (en français)","climate":"paleoclimate (en français)","temperature":"température moyenne estimée (ex: 25°C)","sea_level":"sea level (en français)","sea_level_m":"niveau marin par rapport à l'actuel (ex: +50m)","context":"landscape description (en français)","period_en":"Major geological period in English (ex: Jurassic, Cretaceous, Triassic - VERY IMPORTANT for map search)"},"fossils":[{"name":"Nom combiné pédagogique et latin (ex: Ammonite (Perisphinctes))","scientific_query":"STRICT NOM LATIN UNIQUE du genre sans espace (ex: Perisphinctes)"}]}`;

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