"use client";

import { useCallback, useRef, useState } from "react";
import {
  Film,
  Sparkles,
  Clock,
  Video,
  Mic,
  Copy,
  Check,
  Upload,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Shot {
  time: string;
  visual: string;
  voiceover: string;
}

interface ScriptResponse {
  hook: string;
  callToAction: string;
  shots: Shot[];
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState(
    "Signature Dish: Truffle Wagyu Smash Burger with caramelized onions and smoked cheddar. Target audience: Foodies in London."
  );
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState<ScriptResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadVideo = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) {
      alert("Please upload a video file.");
      return;
    }

    setUploading(true);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return localUrl;
    });

    try {
      const ext = file.name.split(".").pop() || "mp4";
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("raw-footage")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        alert(error.message || "Upload failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      alert(message);
    } finally {
      setUploading(false);
    }
  }, []);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadVideo(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadVideo(file);
  }

  async function handleGenerate() {
    setLoading(true);
    setData(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        alert(json.error || "Generation failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!data) return;

    const fullText =
      `HOOK: ${data.hook}\n\n` +
      data.shots
        .map((shot) => `[${shot.time}]\nVisual: ${shot.visual}\nVO: "${shot.voiceover}"`)
        .join("\n\n") +
      `\n\nCTA: ${data.callToAction}`;

    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">PRM Video Studio</h1>
              <p className="text-sm text-zinc-400">Viral Short-Form Food Pipeline</p>
            </div>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300">
            Next.js + Claude 3.5
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,240px)_1fr]">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative mx-auto w-full max-w-[240px] aspect-[9/16] rounded-xl border-2 border-dashed cursor-pointer overflow-hidden transition ${
              isDragging
                ? "border-emerald-400 bg-emerald-500/10"
                : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {previewUrl ? (
              <video
                src={previewUrl}
                className="absolute inset-0 h-full w-full object-cover"
                controls
                playsInline
                muted
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <Upload className="w-8 h-8 text-zinc-400" />
                <p className="text-sm font-medium text-zinc-200">Drop raw footage</p>
                <p className="text-xs text-zinc-500">9:16 preview · raw-footage bucket</p>
              </div>
            )}

            {uploading && (
              <div className="absolute inset-0 bg-zinc-950/70 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                <span className="text-xs text-zinc-300">Uploading...</span>
              </div>
            )}
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 space-y-4">
            <label className="text-sm font-medium text-zinc-300">
              Dish Concept & Target Audience
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm focus:outline-none focus:border-zinc-500 resize-none"
              placeholder="Describe the dish, ingredients, and style..."
            />
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold px-5 py-2.5 rounded-lg text-sm transition disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? "Generating Storyboard..." : "Generate 15s Script"}
            </button>
          </div>
        </div>

        {data && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  On-Screen Text Hook
                </span>
                <h2 className="text-2xl font-black tracking-tight mt-1 text-white">
                  &ldquo;{data.hook}&rdquo;
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-md border border-zinc-700 transition"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? "Copied" : "Copy Full Script"}
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Storyboard Shots
              </h3>
              <div className="grid gap-3">
                {data.shots.map((shot, idx) => (
                  <div
                    key={`${shot.time}-${idx}`}
                    className="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-lg space-y-2"
                  >
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                      <Clock className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{shot.time}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-zinc-300">
                      <Video className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <span>{shot.visual}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-emerald-300">
                      <Mic className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="italic">&ldquo;{shot.voiceover}&rdquo;</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-zinc-800/80 pt-4 flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-400">Closing CTA:</span>
              <span className="font-semibold text-white text-right">{data.callToAction}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
