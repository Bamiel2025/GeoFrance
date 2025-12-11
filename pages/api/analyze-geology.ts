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
      // CASE 1: User provided a manual code. This is the absolute truth.
      wmsInfo = `USER_INPUT: The user has manually identified the code as "${manualCode}".`;
      instructions = `1. TRUST THE USER INPUT "${manualCode}" 100%. \n2. Ignore any conflicting info from the database or image regarding the code identity.\n3. Output code "${manualCode}".\n4. Use your internal knowledge to provide the description for "${manualCode}".`;
    } else if (extractedCode) {
      // CASE 2: WMS Hint available, but Visual Priority Rule applies.
      wmsInfo = `DB_HINT: The database suggests code "${extractedCode}" (${extractedDescription}).
WARNING: The database layer (GEO50K_HARM) is often spatially misaligned with the visual map (SCAN_D_GEOL50).
You MUST inspect the image. The code printed on the map text (e.g. 'j9ad', 't2', 'n4') is the ONLY source of truth.
If the text on the map is different from "${extractedCode}", IGNORE the database hint completely and analyze the map code.`;
      instructions = `1. Read the code text directly under or near the blue marker pin on the image.\n2. If the text on the map (e.g., 'j9ad') contradicts the DB_HINT (e.g., 'e8b-9'), TRUST THE IMAGE.\n3. Output the code from the image.\n4. Provide the geological description for the *image code*.`;
    } else if (wmsData?.rawResponse) {
      // CASE 3: Only raw WMS text available
      wmsInfo = `DB_HINT: Database raw response: ${wmsData.rawResponse.substring(0, 500)}`;
      instructions = `1. Identify the code from the map image.\n2. Use the DB_HINT only if the image is unclear.\n3. Provide the description.`;
    } else {
      // CASE 4: No WMS info
      instructions = `1. Identify the geological code strictly from the map image.\n2. Provide the description.`;
    }

    const prompt = `You are an expert geologist analysing a geological map of France (BRGM 1/50000).
Your Goal: Identify the geological unit EXACTLY as written on the map image or provided by the user.

Context:
Location: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}
${wmsInfo}
Visual Map: See attached image.

INSTRUCTIONS:
${instructions}

Response strictly in valid JSON:
{"code":"[Exact code]","location_name":"commune","map_sheet":"feuille 1/50k","age":"stratigraphic age","formation":"formation name","lithology":"rock description","description":"detailed geological context","paleogeography":{"environment":"depositional environment","climate":"paleoclimate","sea_level":"sea level","context":"landscape description"},"fossils":["fossil1","fossil2"]}`;

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
        if (attempts === maxAttempts) throw err; // Throw on last failure
        // Simple backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
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
    res.status(500).json({
      error: `Erreur d'analyse: ${error?.message || "Erreur inconnue"}`
    });
  }
}