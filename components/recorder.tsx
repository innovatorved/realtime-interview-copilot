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

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string) => void;
  addTranscriptionSegment?: (segment: TranscriptionSegment) => void;
}

export default function RecorderTranscriber({
  addTextinTranscription,
  addTranscriptionSegment,
}: RecorderTranscriberProps) {
  const isRendered = useRef(false);
  const { add, remove, first, size, queue } = useQueue<any>([]);
  const [apiKey, setApiKey] = useState<CreateProjectKeyResponse | null>();
  const [connection, setConnection] = useState<LiveClient | null>();
  const [isListening, setListening] = useState(false);
  const [isLoadingKey, setLoadingKey] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [isProcessing, setProcessing] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [microphone, setRecorderTranscriber] = useState<MediaRecorder | null>();
  const [userMedia, setUserMedia] = useState<MediaStream | null>();

  const [caption, setCaption] = useState<string | null>();
  const segmentCounterRef = useRef<number>(0);
  const connectionRef = useRef<LiveClient | null>(null);

  const toggleRecorderTranscriber = useCallback(async () => {
    let currentMedia = userMedia;
    if (micOpen) {
      // Stop listening
      microphone?.stop();
      setRecorderTranscriber(null);

      // Close Deepgram connection
      if (connectionRef.current) {
        connectionRef.current.finish();
        connectionRef.current = null;
        setConnection(null);
        setListening(false);
      }
    } else {
      // Start listening
      if (!userMedia) {
        const media = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        media.getVideoTracks().forEach((track) => track.stop());
        currentMedia = media;
        setUserMedia((_) => media);
      }

      if (!currentMedia) return;

      // Get API key if we don't have one
      if (!apiKey) {
        setLoadingKey(true);
        try {
          const res = await fetch("/api/deepgram", { cache: "no-store" });
          const object = await res.json();
          if (
            typeof object !== "object" ||
            object === null ||
            !("key" in object)
          )
            throw new Error("No api key returned");
          setApiKey(object as CreateProjectKeyResponse);
        } catch (e) {
          console.error("Failed to get API key:", e);
          setLoadingKey(false);
          return;
        }
        setLoadingKey(false);
      }

      // Create a fresh MediaRecorder instance
      const mic = new MediaRecorder(currentMedia);
      mic.start(500);

      mic.onstart = () => {
        setMicOpen((_) => true);
      };

      mic.onstop = () => {
        setMicOpen((_) => false);
      };

      mic.ondataavailable = (e) => {
        add(e.data);
      };

      setRecorderTranscriber((_) => mic);
    }
  }, [add, micOpen, userMedia, apiKey]);

  // Fetch API key only when component mounts
  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;
    // API key will be fetched when user starts listening, not on mount
  }, []);

  // Establish Deepgram connection only when user has clicked start AND we have an API key
  useEffect(() => {
    if (!apiKey || !micOpen || connectionRef.current) return;

    setLoading(true);
    const deepgram = createClient(apiKey?.key ?? "");
    const newConnection = deepgram.listen.live({
      model: "nova-2",
      interim_results: true,
      smart_format: true,
    });

    newConnection.on(LiveTranscriptionEvents.Open, () => {
      setListening(true);
      setLoading(false);
    });

    newConnection.on(LiveTranscriptionEvents.Close, () => {
      setListening(false);
      setConnection(null);
      connectionRef.current = null;
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

  return (
    <div className="w-full relative">
      <div className="grid mt-2 align-middle items-center gap-2">
        <Button
          className="h-9 bg-green-600 hover:bg-green-800 text-white"
          size="sm"
          variant="outline"
          onClick={() => toggleRecorderTranscriber()}
        >
          {!micOpen ? (
            <div className="flex items-center">
              <MicIcon className="h-4 w-4 -translate-x-0.5 mr-2" />
              Start listening
            </div>
          ) : (
            <div className="flex items-center">
              <MicOffIcon className="h-4 w-4 -translate-x-0.5 mr-2" />
              Stop listening
            </div>
          )}
        </Button>
      </div>
      <div
        className="z-20 text-white flex shrink-0 grow-0 justify-around items-center 
                  fixed bottom-0 right-5 rounded-lg mr-1 mb-5 lg:mr-5 lg:mb-5 xl:mr-10 xl:mb-10 gap-5"
      >
        <span className="text-sm text-gray-400">
          {isListening
            ? "✓ Connected to server"
            : !micOpen
              ? "Start listening to connect"
              : "Connecting..."}
        </span>
        <MicIcon
          className={cn("h-4 w-4 -translate-x-0.5 mr-2", {
            "fill-green-400 drop-shadow-glowBlue": isListening,
            "fill-yellow-400": micOpen && !isListening,
            "fill-gray-400": !micOpen,
          })}
        />
      </div>
    </div>
  );
}
