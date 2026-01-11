"use client";

import {
  CreateProjectKeyResponse,
  LiveClient,
  LiveTranscriptionEvents,
  createClient,
} from "@deepgram/sdk";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueue } from "@uidotdev/usehooks";
import { MicIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MicOffIcon } from "lucide-react";
import { TranscriptionSegment, TranscriptionWord } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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

export default function RecorderTranscriber({
  addTextinTranscription,
  addTranscriptionSegment,
}: RecorderTranscriberProps) {
  const isClientReady = useClientReady();
  const isRendered = useRef(false);
  const { add, remove, first, size, queue } = useQueue<any>([]);
  const [apiKey, setApiKey] = useState<CreateProjectKeyResponse | null>(null);
  const [connection, setConnection] = useState<LiveClient | null>(null);
  const [isListening, setListening] = useState(false);
  const [isLoadingKey, setLoadingKey] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [isProcessing, setProcessing] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [microphone, setRecorderTranscriber] = useState<MediaRecorder | null>(
    null,
  );
  const [userMedia, setUserMedia] = useState<MediaStream | null>(null);

  // Audio device selection states
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isElectron, setIsElectron] = useState<boolean | null>(null); // null initially to prevent hydration mismatch

  const [caption, setCaption] = useState<string | null>(null);
  const segmentCounterRef = useRef<number>(0);
  const connectionRef = useRef<LiveClient | null>(null);

  // Load available audio devices
  const loadAudioDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      console.log("🎤 Loading audio devices...");

      // Request permission first if needed
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        tempStream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        console.log("Permission request for enumerating devices:", e);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(
        (device) => device.kind === "audioinput",
      );

      console.log("📋 All available devices:");
      devices.forEach((device, index) => {
        console.log(
          `  ${index + 1}. [${device.kind}] ${device.label || "Unnamed device"} (ID: ${device.deviceId})`,
        );
      });

      console.log("\n🎧 Audio Input devices:");
      audioInputs.forEach((device, index) => {
        console.log(
          `  ${index + 1}. ${device.label || "Unnamed device"} (ID: ${device.deviceId})`,
        );
      });

      const deviceList: AudioDeviceInfo[] = audioInputs.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
        kind: d.kind,
      }));

      setAudioDevices(deviceList);

      // Auto-select BlackHole or similar virtual device if available
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
        console.log(
          `✅ Auto-selected virtual audio device: ${virtualDevice.label}`,
        );
        setSelectedDeviceId(virtualDevice.deviceId);
      } else if (audioInputs.length > 0) {
        console.warn(
          "⚠️ No virtual audio device found. Please select one manually.",
        );
        console.log(
          "Available devices:",
          audioInputs.map((d) => d.label).join(", "),
        );
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error("❌ Error loading audio devices:", error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  const toggleRecorderTranscriber = useCallback(async () => {
    let currentMedia = userMedia;
    if (micOpen) {
      // Stop listening
      console.log("🛑 Stopping recording...");
      microphone?.stop();
      setRecorderTranscriber(null);

      // Stop all tracks to release the device
      if (userMedia) {
        userMedia.getTracks().forEach((track) => {
          track.stop();
          console.log(`   Stopped track: ${track.label}`);
        });
        setUserMedia(null);
      }

      // Close Deepgram connection
      if (connectionRef.current) {
        connectionRef.current.finish();
        connectionRef.current = null;
        setConnection(null);
        setListening(false);
      }

      // Clear the API key so a fresh one is fetched next time
      setApiKey(null);

      // Capture recording stopped event with PostHog
      posthog.capture("recording_stopped", {
        platform: isElectron ? "electron" : "browser",
      });

      console.log("✅ Recording stopped and device released");
    } else {
      // Start listening - always fetch a fresh API key
      console.log("🎙️ Starting new recording session...");

      // Ensure we start fresh - clear any existing connection
      if (connectionRef.current) {
        console.log("Cleaning up old connection...");
        connectionRef.current.finish();
        connectionRef.current = null;
        setConnection(null);
        setListening(false);
      }

      // Clear old API key and fetch a new one
      setApiKey(null);

      if (!userMedia) {
        try {
          // Check if we're in Electron using state
          if (isElectron) {
            console.log("🖥️ Running in Electron mode");

            // Check if a device is selected
            if (!selectedDeviceId) {
              alert("Please select an audio device first!");
              return;
            }

            // Find the selected device
            const selectedDevice = audioDevices.find(
              (d) => d.deviceId === selectedDeviceId,
            );

            if (!selectedDevice) {
              console.error("❌ Selected device not found!");
              alert("Selected audio device not found. Please select again.");
              await loadAudioDevices();
              return;
            }

            console.log(
              `🎤 Attempting to use selected audio device: ${selectedDevice.label}`,
            );
            console.log(`   Device ID: ${selectedDevice.deviceId}`);

            const media = await navigator.mediaDevices.getUserMedia({
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

            // Verify we got the correct device
            const audioTrack = media.getAudioTracks()[0];
            console.log(
              `✅ Successfully captured audio from: ${audioTrack.label}`,
            );
            console.log(`   Track ID: ${audioTrack.id}`);
            console.log(`   Track settings:`, audioTrack.getSettings());
            console.log(
              `   Track enabled: ${audioTrack.enabled}, muted: ${audioTrack.muted}, readyState: ${audioTrack.readyState}`,
            );

            // Verify this is the correct device
            if (
              !audioTrack.label
                .toLowerCase()
                .includes(selectedDevice.label.toLowerCase().split(" ")[0])
            ) {
              console.error(
                `❌ WARNING: Expected device "${selectedDevice.label}" but got "${audioTrack.label}"`,
              );
              console.error(`   This might be the wrong device!`);
              alert(
                `⚠️ Device Mismatch Warning!\n\n` +
                  `Expected: ${selectedDevice.label}\n` +
                  `Got: ${audioTrack.label}\n\n` +
                  `The audio might be captured from the wrong device.`,
              );
            } else {
              console.log(
                `✅✅ VERIFIED: Using correct device "${audioTrack.label}"`,
              );
            }

            currentMedia = media;
            setUserMedia((_) => media);
          } else {
            // In browser: Use screen capture with audio (original behavior)
            const media = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });
            media.getVideoTracks().forEach((track) => track.stop());
            currentMedia = media;
            setUserMedia((_) => media);
          }
        } catch (error) {
          console.error("❌ Error accessing audio:", error);
          alert(
            "Could not access audio. Please ensure:\n" +
              "- On Mac: BlackHole is installed and set as input device\n" +
              "- On Windows: VB-Audio Virtual Cable or similar is configured\n" +
              "- Microphone permissions are granted\n\n" +
              `Error: ${error}`,
          );
          return;
        }
      }

      if (!currentMedia) return;

      // Always get a fresh API key for each session
      setLoadingKey(true);
      try {
        console.log("🔑 Fetching fresh API key...");
        const res = await fetch(`${BACKEND_API_URL}/api/deepgram`, {
          cache: "no-store",
          credentials: "include", // Important: Send cookies for auth
        });
        const object = await res.json();
        if (typeof object !== "object" || object === null || !("key" in object))
          throw new Error("No api key returned");
        setApiKey(object as CreateProjectKeyResponse);
        console.log("✅ Fresh API key obtained");
      } catch (e) {
        console.error("Failed to get API key:", e);
        alert("Failed to get API key. Please try again.");
        setLoadingKey(false);
        // Clean up media on error
        if (currentMedia) {
          currentMedia.getTracks().forEach((track) => track.stop());
          setUserMedia(null);
        }
        return;
      }
      setLoadingKey(false);

      // Create a fresh MediaRecorder instance
      const mic = new MediaRecorder(currentMedia);
      mic.start(500);

      mic.onstart = () => {
        console.log("🎙️ MediaRecorder started");
        setMicOpen((_) => true);
        // Capture recording started event with PostHog
        posthog.capture("recording_started", {
          platform: isElectron ? "electron" : "browser",
          device_label: isElectron
            ? audioDevices.find((d) => d.deviceId === selectedDeviceId)?.label
            : "screen_capture",
        });
      };

      mic.onstop = () => {
        console.log("🛑 MediaRecorder stopped");
        setMicOpen((_) => false);
      };

      mic.ondataavailable = (e) => {
        add(e.data);
      };

      setRecorderTranscriber((_) => mic);
    }
  }, [
    add,
    micOpen,
    userMedia,
    apiKey,
    selectedDeviceId,
    audioDevices,
    loadAudioDevices,
    isElectron,
  ]);

  // Fetch API key only when component mounts
  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;

    // Check if running in Electron (client-side only)
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);

    // Load audio devices when component mounts
    loadAudioDevices();
    // API key will be fetched when user starts listening, not on mount
  }, [loadAudioDevices]);

  // Establish Deepgram connection only when user has clicked start AND we have an API key
  useEffect(() => {
    // Only create connection if we have API key, mic is open, and no existing connection
    if (!apiKey || !micOpen || connectionRef.current) return;

    console.log("🌐 Creating new Deepgram connection...");
    setLoading(true);

    const deepgram = createClient(apiKey?.key ?? "");
    const newConnection = deepgram.listen.live({
      model: "nova-2",
      interim_results: true,
      smart_format: true,
    });

    newConnection.on(LiveTranscriptionEvents.Open, () => {
      console.log("✅ Deepgram connection opened");
      setListening(true);
      setLoading(false);
    });

    newConnection.on(LiveTranscriptionEvents.Close, () => {
      console.log("🔌 Deepgram connection closed");
      setListening(false);
      setConnection(null);
      connectionRef.current = null;
    });

    newConnection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error("❌ Deepgram connection error:", error);
      setListening(false);
      setLoading(false);
      // Clean up on error
      if (connectionRef.current) {
        connectionRef.current.finish();
        connectionRef.current = null;
        setConnection(null);
      }
    });

    newConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const words = data.channel.alternatives[0].words;
      const caption = words
        .map((word: any) => word.punctuated_word ?? word.word)
        .join(" ");
      if (caption !== "") {
        setCaption(caption);
        addTextinTranscription(caption);

        // Extract detailed segment data if callback is provided
        if (addTranscriptionSegment) {
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

          addTranscriptionSegment(segment);
        }
      }
    });

    connectionRef.current = newConnection;
    setConnection(newConnection);
  }, [apiKey, micOpen, addTextinTranscription, addTranscriptionSegment]);

  useEffect(() => {
    const processQueue = async () => {
      if (size > 0 && !isProcessing) {
        setProcessing(true);

        if (isListening) {
          const blob = first;
          connection?.send(blob);
          remove();
        }

        const waiting = setTimeout(() => {
          clearTimeout(waiting);
          setProcessing(false);
        }, 250);
      }
    };

    processQueue();
  }, [connection, queue, remove, first, size, isProcessing, isListening]);

  if (isLoadingKey)
    return (
      <span className="w-full p-2 text-center text-xs bg-red-500 text-white">
        Fetching API key...
      </span>
    );
  if (isLoading)
    return (
      <span className="w-full p-2 text-center text-xs bg-red-500 text-white">
        Connecting to Deepgram...
      </span>
    );
  if (!isClientReady) {
    return <RecorderSkeleton />;
  }

  return (
    <div className="w-full relative">
      <div className="flex flex-col gap-2">
        {/* Controls Row */}
        <div className="flex items-center gap-2 p-1 bg-zinc-950/50 rounded-lg border border-white/5">
          {/* Compact Audio Device Selector - only show in Electron */}
          {isElectron && (
            <div className="relative flex-1 min-w-0">
              <Select
                value={selectedDeviceId}
                onValueChange={setSelectedDeviceId}
                disabled={micOpen || isLoadingDevices}
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

          {/* Divider if selector is present */}
          {isElectron && <div className="w-px h-4 bg-white/10 mx-1" />}

          <Button
            className={cn(
              "h-8 px-4 text-xs font-medium transition-all duration-300",
              isListening
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20"
                : "bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 border border-green-500/20",
            )}
            size="sm"
            onClick={() => toggleRecorderTranscriber()}
            disabled={isElectron === true && !selectedDeviceId}
          >
            {!micOpen ? (
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

        {/* Status Line - Integrated below controls instead of fixed */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                isListening
                  ? "bg-green-500 animate-pulse"
                  : micOpen
                    ? "bg-yellow-500"
                    : "bg-zinc-700",
              )}
            />
            <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
              {isListening
                ? "Live & Connected"
                : !micOpen
                  ? "Ready"
                  : "Connecting..."}
            </span>
          </div>
          {isListening && (
            <span className="text-[10px] text-green-500/70 font-mono animate-pulse">
              REC
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RecorderSkeleton() {
  return (
    <div className="w-full">
      <div className="mt-2 h-9 w-full animate-pulse rounded bg-gray-900/40" />
    </div>
  );
}
