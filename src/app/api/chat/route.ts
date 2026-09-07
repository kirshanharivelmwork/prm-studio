import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODELS = [
  "claude-3-5-sonnet-latest",
  "claude-3-sonnet-20240229",
  "claude-sonnet-5",
] as const;

const SYSTEM_PROMPT = `You are an automated viral food video director for short-form platforms (TikTok, Instagram Reels).
Given a dish or menu concept, output ONLY raw valid JSON. Do not wrap it in markdown, code fences, or extra commentary. Match this exact structure:
{
  "hook": "Punchy 3-5 word on-screen hook",
  "callToAction": "Clear closing prompt",
  "shots": [
    {
      "time": "0-3s",
      "visual": "Exact camera movement and food action",
      "voiceover": "Spoken line"
    },
    {
      "time": "3-7s",
      "visual": "Texture or preparation detail",
      "voiceover": "Spoken line"
    },
    {
      "time": "7-12s",
      "visual": "Close-up hero cross-section or melt",
      "voiceover": "Spoken line"
    }
  ]
}`;

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

function isModelNotFound(error: unknown): boolean {
  const err = error as {
    status?: number;
    type?: string;
    error?: { type?: string; error?: { type?: string } };
  };
  return (
    err?.status === 404 ||
    err?.type === "not_found_error" ||
    err?.error?.type === "not_found_error" ||
    err?.error?.error?.type === "not_found_error"
  );
}

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    let response: Anthropic.Message | undefined;
    let lastError: unknown;

    for (const model of MODELS) {
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });
        break;
      } catch (error) {
        lastError = error;
        if (!isModelNotFound(error)) throw error;
      }
    }

    if (!response) throw lastError;

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      return NextResponse.json({ error: "Invalid response format" }, { status: 500 });
    }

    const parsedData = JSON.parse(extractJson(text));
    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
