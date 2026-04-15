"use client";

import {
  CreateProjectKeyResponse,
  LiveClient,
  LiveTranscriptionEvents,
  createClient,
} from "@deepgram/sdk";
import { useState, useEffect, useCallback, useRef } from "react";
import { MicIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, MicOffIcon } from "lucide-react";
import { TranscriptionSegment, TranscriptionWord } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClientReady } from "@/hooks/useClientReady";
import { BACKEND_API_URL } from "@/lib/constant";
import posthog from "posthog-js";

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string) => void;
  addTranscriptionSegment?: (segment: TranscriptionSegment) => void;
}

interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: string;
}

type SessionState = "idle" | "fetching-key" | "connecting" | "live";

export default function RecorderTranscriber({
  addTextinTranscription,
  addTranscriptionSegment,
}: RecorderTranscriberProps) {
  const isClientReady = useClientReady();

  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");

  const connectionRef = useRef<LiveClient | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const segmentCounterRef = useRef<number>(0);
  const sessionIdRef = useRef<number>(0);

  const addTextRef = useRef(addTextinTranscription);
  addTextRef.current = addTextinTranscription;
  const addSegmentRef = useRef(addTranscriptionSegment);
  addSegmentRef.current = addTranscriptionSegment;

  const loadAudioDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        tempStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Permission not yet granted; device labels may be empty
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(
        (device) => device.kind === "audioinput",
      );

      const deviceList: AudioDeviceInfo[] = audioInputs.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
        kind: d.kind,
      }));

      setAudioDevices(deviceList);

      const blackholeDevice = audioInputs.find((device) =>
        device.label.toLowerCase().includes("blackhole"),
      );
      const virtualDevice =
        blackholeDevice ||
        audioInputs.find(
          (device) =>
            device.label.toLowerCase().includes("vb-audio") ||
            device.label.toLowerCase().includes("virtual cable") ||
            device.label.toLowerCase().includes("loopback"),
        );

      if (virtualDevice) {
        setSelectedDeviceId(virtualDevice.deviceId);
      } else if (audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error("Error loading audio devices:", error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  const teardown = useCallback(() => {
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (connectionRef.current) {
      try { connectionRef.current.finish(); } catch { /* already closed */ }
      connectionRef.current = null;
    }

    setSessionState("idle");
  }, []);

  const startSession = useCallback(async () => {
    teardown();

    const thisSession = ++sessionIdRef.current;
    const isStale = () => sessionIdRef.current !== thisSession;

    setSessionState("fetching-key");

    let media: MediaStream;
    try {
      if (isElectron) {
        if (!selectedDeviceId) {
          alert("Please select an audio device first!");
          setSessionState("idle");
          return;
        }

        const selectedDevice = audioDevices.find(
          (d) => d.deviceId === selectedDeviceId,
        );

        if (!selectedDevice) {
          alert("Selected audio device not found. Please select again.");
          await loadAudioDevices();
          setSessionState("idle");
          return;
        }

        media = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: selectedDevice.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 2,
          } as MediaTrackConstraints,
          video: false,
        });
      } else {
        media = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        media.getVideoTracks().forEach((track) => track.stop());
      }
    } catch (error) {
      alert(
        "Could not access audio. Please ensure:\n" +
          "- On Mac: BlackHole is installed and set as input device\n" +
          "- On Windows: VB-Audio Virtual Cable or similar is configured\n" +
          "- Microphone permissions are granted\n\n" +
          `Error: ${error}`,
      );
      setSessionState("idle");
      return;
    }

    if (isStale()) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }

    mediaStreamRef.current = media;

    let apiKeyResponse: CreateProjectKeyResponse;
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/deepgram`, {
        cache: "no-store",
        credentials: "include",
      });
      const object = await res.json();
      if (typeof object !== "object" || object === null || !("key" in object)) {
        throw new Error("No api key returned");
      }
      apiKeyResponse = object as CreateProjectKeyResponse;
    } catch (e) {
      console.error("Failed to get API key:", e);
      alert("Failed to get API key. Please try again.");
      teardown();
      return;
    }

    if (isStale()) {
      teardown();
      return;
    }

    setSessionState("connecting");

    const deepgram = createClient(apiKeyResponse.key ?? "");
    const conn = deepgram.listen.live({
      model: "nova-2",
      interim_results: true,
      smart_format: true,
    });

    connectionRef.current = conn;

    conn.on(LiveTranscriptionEvents.Open, () => {
      if (isStale()) {
        try { conn.finish(); } catch { /* ignore */ }
        return;
      }

      setSessionState("live");

      const mic = new MediaRecorder(media);
      mediaRecorderRef.current = mic;

      mic.ondataavailable = (e) => {
        if (isStale() || !connectionRef.current) return;
        if (e.data.size > 0) {
          try { connectionRef.current.send(e.data); } catch { /* connection gone */ }
        }
      };

      mic.start(500);

      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        device_label: isElectron
          ? audioDevices.find((d) => d.deviceId === selectedDeviceId)?.label
          : "screen_capture",
      });
    });

    conn.on(LiveTranscriptionEvents.Close, () => {
      if (connectionRef.current === conn) {
        teardown();
      }
    });

    conn.on(LiveTranscriptionEvents.Error, (error) => {
      console.error("Deepgram connection error:", error);
      if (connectionRef.current === conn) {
        teardown();
      }
    });

    conn.on(LiveTranscriptionEvents.Transcript, (data) => {
      if (isStale()) return;

      const words = data.channel.alternatives[0].words;
      const caption = words
        .map((word: any) => word.punctuated_word ?? word.word)
        .join(" ");

      if (caption === "") return;

      addTextRef.current(caption);

      if (addSegmentRef.current) {
        const startTime = words.length > 0 ? (words[0].start ?? 0) : 0;
        const endTime =
          words.length > 0 ? (words[words.length - 1].end ?? 0) : 0;

        const wordsData: TranscriptionWord[] = words.map((word: any) => ({
          word: word.word,
          punctuated_word: word.punctuated_word,
          start: word.start,
          end: word.end,
          confidence: word.confidence,
          speaker: data.channel.speaker,
        }));

        const segment: TranscriptionSegment = {
          id: `segment-${segmentCounterRef.current++}`,
          text: caption,
          words: wordsData,
          startTime,
          endTime,
          confidence:
            words.reduce(
              (acc: number, w: any) => acc + (w.confidence ?? 0),
              0,
            ) / words.length,
          speaker: data.channel.speaker,
          isFinal: data.is_final ?? false,
          timestamp: new Date().toISOString(),
        };

        addSegmentRef.current(segment);
      }
    });
  }, [
    isElectron,
    selectedDeviceId,
    audioDevices,
    loadAudioDevices,
    teardown,
  ]);

  const stopSession = useCallback(() => {
    sessionIdRef.current++;
    teardown();
    posthog.capture("recording_stopped", {
      platform: isElectron ? "electron" : "browser",
    });
  }, [teardown, isElectron]);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
    loadAudioDevices();
  }, [loadAudioDevices]);

  useEffect(() => {
    return () => {
      sessionIdRef.current++;
      teardown();
    };
  }, [teardown]);

  const isActive = sessionState !== "idle";
  const isBusy = sessionState === "fetching-key" || sessionState === "connecting";

  return (
    <div className="w-full relative">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 p-1 bg-zinc-950/50 rounded-lg border border-white/5 h-10">
          {isBusy ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-zinc-400 text-xs" role="status" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500/80" />
              <span>{sessionState === "fetching-key" ? "Fetching API key…" : "Connecting…"}</span>
            </div>
          ) : (
            <>
              {isElectron && (
                <div className="relative flex-1 min-w-0">
                  <Select
                    value={selectedDeviceId}
                    onValueChange={setSelectedDeviceId}
                    disabled={isActive || isLoadingDevices}
                  >
                    <SelectTrigger className="h-8 bg-transparent border-0 text-zinc-300 text-xs hover:text-white focus:ring-0 px-2 shadow-none w-full">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-zinc-500 text-[10px] uppercase tracking-wider font-semibold">
                          Input
                        </span>
                        <SelectValue placeholder="Select device..." />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-zinc-100">
                      {audioDevices.map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                          className="text-white text-xs"
                        >
                          <div className="flex items-center gap-1.5">
                            {(device.label.toLowerCase().includes("blackhole") ||
                              device.label.toLowerCase().includes("vb-audio") ||
                              device.label
                                .toLowerCase()
                                .includes("virtual cable") ||
                              device.label.toLowerCase().includes("loopback")) && (
                              <span className="text-green-400 text-xs">✓</span>
                            )}
                            <span className="truncate max-w-[180px]">
                              {device.label}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isElectron && <div className="w-px h-4 bg-white/10 mx-1" />}
            </>
          )}

          <Button
            className={cn(
              "h-8 px-4 text-xs font-medium transition-all duration-300 shrink-0",
              sessionState === "live"
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20"
                : "bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 border border-green-500/20",
            )}
            size="sm"
            onClick={isActive ? stopSession : startSession}
            disabled={(isElectron === true && !selectedDeviceId) || isBusy}
          >
            {!isActive ? (
              <div className="flex items-center gap-2">
                <MicIcon className="h-3 w-3" />
                Start Listening
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MicOffIcon className="h-3 w-3" />
                Stop
              </div>
            )}
          </Button>
        </div>

        <div className="flex items-center justify-between px-1 h-4">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                sessionState === "live"
                  ? "bg-green-500 animate-pulse"
                  : isActive
                    ? "bg-yellow-500"
                    : "bg-zinc-700",
              )}
            />
            <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
              {sessionState === "live"
                ? "Live & Connected"
                : sessionState === "idle"
                  ? "Ready"
                  : "Connecting..."}
            </span>
          </div>
          {sessionState === "live" && (
            <span className="text-[10px] text-green-500/70 font-mono animate-pulse">
              REC
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
