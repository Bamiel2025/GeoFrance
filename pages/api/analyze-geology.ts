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

    // Build a simpler prompt
    let wmsInfo = "";
    if (extractedCode) {
      wmsInfo = `CODE BRGM OFFICIEL: "${extractedCode}". Utilise OBLIGATOIREMENT ce code.`;
    } else if (wmsData?.rawResponse) {
      wmsInfo = `Données serveur BRGM: ${wmsData.rawResponse.substring(0, 500)}`;
    }

    const prompt = `Tu es un expert géologue. Analyse ce point en France: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}.

${wmsInfo}

Réponds UNIQUEMENT en JSON valide:
{"code":"${extractedCode || 'code géologique'}","location_name":"commune","map_sheet":"feuille 1/50k","age":"âge stratigraphique","formation":"nom formation","lithology":"description roches","description":"contexte géologique","paleogeography":{"environment":"milieu de dépôt","climate":"climat ancien","sea_level":"niveau marin","context":"description paysage ancien"},"fossils":["fossile1","fossile2"]}`;

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: parts
    });

    let text = response.text;
    console.log("Response length:", text?.length || 0);

    if (!text) {
      // Try without image
      console.log("Empty response, retrying without image...");
      const retryResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });
      text = retryResponse.text;
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

    // Force the correct code if we extracted one
    if (extractedCode && data.code !== extractedCode) {
      console.warn(`Overriding code: "${data.code}" -> "${extractedCode}"`);
      data.code = extractedCode;
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