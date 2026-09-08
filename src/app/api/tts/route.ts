import { NextResponse } from "next/server";
import { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_VOICE = "en-US-ChristopherNeural";
const VOICE_PATTERN = /^[A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z0-9]+$/;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const requestedVoice =
      typeof body?.voice === "string" ? body.voice.trim() : DEFAULT_VOICE;
    const voice = VOICE_PATTERN.test(requestedVoice)
      ? requestedVoice
      : DEFAULT_VOICE;

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(escapeXml(text), {
      rate: "+12%",
      pitch: "+4%",
    });

    const audioBuffer = await streamToBuffer(audioStream);
    tts.close();

    if (!audioBuffer.length) {
      return NextResponse.json(
        { error: "TTS produced an empty audio buffer" },
        { status: 502 }
      );
    }

    const path = `audio/${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("raw-footage")
      .upload(path, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message || "Audio upload failed" },
        { status: 500 }
      );
    }

    const { data: publicData } = supabase.storage
      .from("raw-footage")
      .getPublicUrl(path);

    return NextResponse.json({ audioUrl: publicData.publicUrl });
  } catch (error: unknown) {
    console.error("TTS error:", error);
    const message = error instanceof Error ? error.message : "TTS failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
