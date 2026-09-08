"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Play,
  Pause,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ScriptShot {
  time: string;
  visual: string;
  voiceover: string;
}

interface ScriptResponse {
  hook: string;
  callToAction: string;
  shots: ScriptShot[];
}

interface StoredShot {
  id: string;
  shot_index: number;
  time_marker: string;
  visual_cue: string;
  voiceover: string;
  media_url: string | null;
}

const SHOT_LABELS = ["Shot 1: 0-3s", "Shot 2: 3-7s", "Shot 3: 7-12s"] as const;
const SHOT_DURATIONS = [3, 4, 5] as const;
const SEQUENCE_TOTAL = SHOT_DURATIONS.reduce((sum, duration) => sum + duration, 0);

function parseDishAndAudience(prompt: string): {
  dish_concept: string;
  target_audience: string;
} {
  const match = prompt.match(/target audience:\s*(.+)$/is);
  if (match && match.index !== undefined) {
    const target_audience = match[1].trim().replace(/[.\s]+$/, "");
    const dish_concept = prompt
      .slice(0, match.index)
      .replace(/signature dish:\s*/i, "")
      .trim()
      .replace(/[.\s]+$/, "");
    return {
      dish_concept: dish_concept || prompt.trim(),
      target_audience: target_audience || "General",
    };
  }
  return { dish_concept: prompt.trim(), target_audience: "General" };
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function shotWindow(seqTime: number): {
  index: number;
  localTime: number;
  start: number;
  duration: number;
} {
  let start = 0;
  for (let i = 0; i < SHOT_DURATIONS.length; i += 1) {
    const duration = SHOT_DURATIONS[i];
    const end = start + duration;
    if (seqTime < end || i === SHOT_DURATIONS.length - 1) {
      return {
        index: i,
        localTime: Math.min(Math.max(seqTime - start, 0), duration),
        start,
        duration,
      };
    }
    start = end;
  }
  return { index: 0, localTime: 0, start: 0, duration: SHOT_DURATIONS[0] };
}

function SequencePlayer({
  hook,
  shots,
  previewByShot,
  onActiveIndexChange,
}: {
  hook: string;
  shots: StoredShot[];
  previewByShot: Record<number, string>;
  onActiveIndexChange: (index: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastShotRef = useRef(0);
  const loadedShotRef = useRef(-1);

  const [seqTime, setSeqTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transport, setTransport] = useState<{
    startSeq: number;
    startWall: number;
    epoch: number;
  } | null>(null);

  const windowAtTime = shotWindow(seqTime);
  const activeShot = shots[windowAtTime.index];
  const mediaUrl =
    previewByShot[windowAtTime.index] || activeShot?.media_url || null;

  const syncMedia = useCallback(
    (time: number, shouldPlay: boolean) => {
      const { index, localTime } = shotWindow(time);
      onActiveIndexChange(index);

      const url = previewByShot[index] || shots[index]?.media_url || null;
      const video = videoRef.current;
      if (!video) return;

      if (!url) {
        loadedShotRef.current = index;
        video.pause();
        video.removeAttribute("src");
        video.load();
        return;
      }

      const needsLoad = loadedShotRef.current !== index || !video.currentSrc;
      if (needsLoad) {
        loadedShotRef.current = index;
        video.src = url;
        const seekAndMaybePlay = () => {
          try {
            video.currentTime = localTime;
          } catch {
            /* ignore seek before metadata */
          }
          if (shouldPlay) void video.play().catch(() => undefined);
          else video.pause();
        };
        video.addEventListener("loadedmetadata", seekAndMaybePlay, { once: true });
        video.load();
        return;
      }

      if (Math.abs(video.currentTime - localTime) > 0.25) {
        try {
          video.currentTime = localTime;
        } catch {
          /* ignore */
        }
      }
      if (shouldPlay) void video.play().catch(() => undefined);
      else video.pause();
    },
    [onActiveIndexChange, previewByShot, shots]
  );

  const syncMediaRef = useRef(syncMedia);
  syncMediaRef.current = syncMedia;

  const playFrom = useCallback((atTime: number) => {
    const start = atTime >= SEQUENCE_TOTAL ? 0 : Math.max(atTime, 0);
    lastShotRef.current = shotWindow(start).index;
    setSeqTime(start);
    syncMediaRef.current(start, true);
    setIsPlaying(true);
    setTransport({
      startSeq: start,
      startWall: performance.now(),
      epoch: Date.now(),
    });
  }, []);

  useEffect(() => {
    if (!isPlaying || !transport) return;

    let cancelled = false;
    const { startSeq, startWall } = transport;
    let id = 0;

    const tick = () => {
      if (cancelled) return;
      const next = startSeq + (performance.now() - startWall) / 1000;
      if (next >= SEQUENCE_TOTAL) {
        cancelled = true;
        window.clearInterval(id);
        setSeqTime(SEQUENCE_TOTAL);
        lastShotRef.current = SHOT_DURATIONS.length - 1;
        syncMediaRef.current(SEQUENCE_TOTAL, false);
        setIsPlaying(false);
        return;
      }

      setSeqTime(next);
      const nextIndex = shotWindow(next).index;
      if (nextIndex !== lastShotRef.current) {
        lastShotRef.current = nextIndex;
        syncMediaRef.current(next, true);
      }
    };

    tick();
    id = window.setInterval(tick, 100);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isPlaying, transport]);

  function handlePlayPause() {
    if (isPlaying) {
      setIsPlaying(false);
      videoRef.current?.pause();
      return;
    }
    playFrom(seqTime >= SEQUENCE_TOTAL ? 0 : seqTime);
  }

  function handlePlayFullSequence() {
    playFrom(0);
  }

  function handleSeek(clientX: number, target: HTMLDivElement) {
    const rect = target.getBoundingClientRect();
    const ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
    const next = Math.min(SEQUENCE_TOTAL, Math.max(0, ratio * SEQUENCE_TOTAL));
    if (isPlaying) {
      playFrom(next);
      return;
    }
    lastShotRef.current = shotWindow(next).index;
    setSeqTime(next);
    syncMedia(next, false);
  }

  const progress = SEQUENCE_TOTAL ? (seqTime / SEQUENCE_TOTAL) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Sequence Preview
        </h3>
        <span className="text-[11px] font-mono text-zinc-500">
          9:16 · {SEQUENCE_TOTAL}s
        </span>
      </div>

      <div className="relative mx-auto w-full max-w-[280px] aspect-[9/16] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${mediaUrl ? "opacity-100" : "opacity-0"}`}
          playsInline
          muted
          preload="auto"
        />

        {!mediaUrl && (
          <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-zinc-800 via-zinc-950 to-black px-4 pt-6">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Shot {windowAtTime.index + 1} · {activeShot?.time_marker}
            </span>
            <p className="mt-3 text-xs leading-snug text-zinc-200 line-clamp-5">
              {activeShot?.visual_cue}
            </p>
            <p className="mt-3 text-xs italic text-emerald-300 line-clamp-4">
              &ldquo;{activeShot?.voiceover}&rdquo;
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/55" />

        <div className="pointer-events-none absolute inset-x-0 top-[54%] px-3">
          <p
            className="text-center text-[1.35rem] font-black uppercase leading-[1.05] tracking-tight text-white"
            style={{
              textShadow:
                "0 1px 0 #000, 0 2px 0 #000, 2px 2px 0 #000, -1px -1px 0 #000, 0 8px 18px rgba(0,0,0,0.55)",
            }}
          >
            {hook}
          </p>
        </div>
      </div>

      <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handlePlayFullSequence}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Play Full Sequence
          </button>
          <button
            type="button"
            onClick={handlePlayPause}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 hover:border-zinc-500 transition"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <p
          className="text-[11px] font-medium text-emerald-400"
          data-seq-shot={windowAtTime.index + 1}
          data-seq-time={seqTime.toFixed(1)}
        >
          Playing Shot {windowAtTime.index + 1} of {shots.length || 3}
        </p>

        <div
          role="slider"
          aria-valuemin={0}
          aria-valuemax={SEQUENCE_TOTAL}
          aria-valuenow={Number(seqTime.toFixed(1))}
          aria-label="Sequence timeline"
          tabIndex={0}
          onClick={(event) => handleSeek(event.clientX, event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              const next = Math.min(SEQUENCE_TOTAL, seqTime + 0.5);
              isPlaying ? playFrom(next) : (setSeqTime(next), syncMedia(next, false));
            }
            if (event.key === "ArrowLeft") {
              const next = Math.max(0, seqTime - 0.5);
              isPlaying ? playFrom(next) : (setSeqTime(next), syncMedia(next, false));
            }
          }}
          className="h-2 w-full cursor-pointer rounded-full bg-zinc-800 overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <span>{formatClock(seqTime)}</span>
          <span>{formatClock(SEQUENCE_TOTAL)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const shotInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [prompt, setPrompt] = useState(
    "Signature Dish: Truffle Wagyu Smash Burger with caramelized onions and smoked cheddar. Target audience: Foodies in London."
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScriptResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [shots, setShots] = useState<StoredShot[]>([]);
  const [previewByShot, setPreviewByShot] = useState<Record<number, string>>({});
  const [uploadingByIndex, setUploadingByIndex] = useState<Record<number, boolean>>(
    {}
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [activeSeqShot, setActiveSeqShot] = useState(0);

  const revokePreviews = useCallback((urls: Record<number, string>) => {
    Object.values(urls).forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
  }, []);

  const displayShots = useMemo<StoredShot[]>(() => {
    if (shots.length > 0) return shots;
    if (!data) return [];
    return data.shots.map((shot, idx) => ({
      id: `local-${idx}`,
      shot_index: idx,
      time_marker: shot.time,
      visual_cue: shot.visual,
      voiceover: shot.voiceover,
      media_url: null,
    }));
  }, [data, shots]);

  const uploadShotVideo = useCallback(
    async (file: File, shot: StoredShot) => {
      if (!currentProjectId) {
        alert("Generate a script first so the project can be saved.");
        return;
      }
      if (!file.type.startsWith("video/")) {
        alert("Please upload a video file.");
        return;
      }

      const idx = shot.shot_index;
      const localUrl = URL.createObjectURL(file);
      setPreviewByShot((prev) => {
        const existing = prev[idx];
        if (existing?.startsWith("blob:")) URL.revokeObjectURL(existing);
        return { ...prev, [idx]: localUrl };
      });
      setUploadingByIndex((prev) => ({ ...prev, [idx]: true }));

      try {
        const ext = file.name.split(".").pop() || "mp4";
        const path = `projects/${currentProjectId}/shot-${idx}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("raw-footage")
          .upload(path, file, { contentType: file.type, upsert: true });

        if (uploadError) {
          alert(uploadError.message || "Upload failed");
          return;
        }

        const { data: publicData } = supabase.storage
          .from("raw-footage")
          .getPublicUrl(path);
        const mediaUrl = publicData.publicUrl;

        const { error: updateError } = await supabase
          .from("project_shots")
          .update({ media_url: mediaUrl })
          .eq("id", shot.id);

        if (updateError) {
          alert(updateError.message || "Could not save shot media URL");
          return;
        }

        setShots((prev) =>
          prev.map((row) =>
            row.id === shot.id ? { ...row, media_url: mediaUrl } : row
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        alert(message);
      } finally {
        setUploadingByIndex((prev) => ({ ...prev, [idx]: false }));
      }
    },
    [currentProjectId]
  );

  async function handleGenerate() {
    setLoading(true);
    setData(null);
    setCurrentProjectId(null);
    setShots([]);
    setActiveSeqShot(0);
    setPreviewByShot((prev) => {
      revokePreviews(prev);
      return {};
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Generation failed");
        return;
      }

      setData(json);

      const { dish_concept, target_audience } = parseDishAndAudience(prompt);
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          dish_concept,
          target_audience,
          hook: json.hook,
          call_to_action: json.callToAction,
          status: "draft",
        })
        .select("id")
        .single();

      if (projectError || !project) {
        alert(projectError?.message || "Could not save project");
        return;
      }

      const shotRows = (json.shots as ScriptShot[]).slice(0, 3).map((shot, idx) => ({
        project_id: project.id,
        shot_index: idx,
        time_marker: shot.time,
        visual_cue: shot.visual,
        voiceover: shot.voiceover,
      }));

      const { data: insertedShots, error: shotsError } = await supabase
        .from("project_shots")
        .insert(shotRows)
        .select("id, shot_index, time_marker, visual_cue, voiceover, media_url")
        .order("shot_index", { ascending: true });

      if (shotsError || !insertedShots) {
        alert(shotsError?.message || "Could not save storyboard shots");
        return;
      }

      setCurrentProjectId(project.id);
      setShots(insertedShots as StoredShot[]);
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
      <div className="max-w-6xl mx-auto space-y-8">
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
            Day 2 · Projects
          </span>
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
            onClick={() => void handleGenerate()}
            disabled={loading || !prompt.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold px-5 py-2.5 rounded-lg text-sm transition disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? "Generating Storyboard..." : "Generate 15s Script"}
          </button>
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
                {currentProjectId && (
                  <p className="mt-2 text-xs font-mono text-zinc-500">
                    Project {currentProjectId}
                  </p>
                )}
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

            <div className="grid gap-6 xl:grid-cols-[minmax(240px,280px)_1fr] items-start">
              <SequencePlayer
                key={currentProjectId ?? "draft"}
                hook={data.hook}
                shots={displayShots}
                previewByShot={previewByShot}
                onActiveIndexChange={setActiveSeqShot}
              />

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Storyboard Shots
                </h3>
                <div className="grid gap-4 md:grid-cols-3">
                  {displayShots.map((shot) => {
                    const idx = shot.shot_index;
                    const preview = previewByShot[idx] || shot.media_url;
                    const uploading = Boolean(uploadingByIndex[idx]);
                    const canUpload = Boolean(
                      currentProjectId && shot.id && !shot.id.startsWith("local-")
                    );
                    const isActive = activeSeqShot === idx;

                    return (
                      <div
                        key={shot.id}
                        className={`p-4 bg-zinc-950/70 rounded-xl space-y-3 border transition ${
                          isActive
                            ? "border-emerald-500/50 ring-1 ring-emerald-500/20"
                            : "border-zinc-800/80"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-emerald-400">
                            {SHOT_LABELS[idx] ?? `Shot ${idx + 1}`}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500">
                            <Clock className="w-3 h-3" />
                            {shot.time_marker}
                          </span>
                        </div>

                        <div
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (canUpload) setDraggingIndex(idx);
                          }}
                          onDragLeave={() => setDraggingIndex(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDraggingIndex(null);
                            const file = event.dataTransfer.files?.[0];
                            if (file && canUpload) void uploadShotVideo(file, shot);
                          }}
                          onClick={() => {
                            if (canUpload) shotInputRefs.current[idx]?.click();
                          }}
                          className={`relative mx-auto w-full max-w-[180px] aspect-[9/16] rounded-lg border-2 border-dashed overflow-hidden transition ${
                            canUpload
                              ? "cursor-pointer"
                              : "cursor-not-allowed opacity-70"
                          } ${
                            draggingIndex === idx
                              ? "border-emerald-400 bg-emerald-500/10"
                              : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"
                          }`}
                        >
                          <input
                            ref={(el) => {
                              shotInputRefs.current[idx] = el;
                            }}
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file && canUpload) void uploadShotVideo(file, shot);
                              event.target.value = "";
                            }}
                          />

                          {preview ? (
                            <video
                              src={preview}
                              className="absolute inset-0 h-full w-full object-cover"
                              controls
                              playsInline
                              muted
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
                              <Upload className="w-6 h-6 text-zinc-400" />
                              <p className="text-xs font-medium text-zinc-200">
                                Drop shot footage
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                9:16 · raw-footage
                              </p>
                            </div>
                          )}

                          {uploading && (
                            <div className="absolute inset-0 bg-zinc-950/70 flex flex-col items-center justify-center gap-2">
                              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                              <span className="text-xs text-zinc-300">Uploading...</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-start gap-2 text-sm text-zinc-300">
                          <Video className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                          <span>{shot.visual_cue}</span>
                        </div>
                        <div className="flex items-start gap-2 text-sm text-emerald-300">
                          <Mic className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span className="italic">&ldquo;{shot.voiceover}&rdquo;</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
