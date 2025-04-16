"use client";

import {
  CreateProjectKeyResponse,
  LiveClient,
  LiveTranscriptionEvents,
  LiveSchema,
  createClient,
} from "@deepgram/sdk";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueue } from "@uidotdev/usehooks";
import { MicIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MicOffIcon } from "lucide-react";

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string) => void;
  language: "ru" | "en";
}

export default function RecorderTranscriber({
  addTextinTranscription,
  language,
}: RecorderTranscriberProps) {
  const { add, remove, first, size, queue } = useQueue<any>([]);
  const [connection, setConnection] = useState<LiveClient | null>();
  const [isListening, setListening] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [isProcessing, setProcessing] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [microphone, setRecorderTranscriber] = useState<MediaRecorder | null>();
  const [userMedia, setUserMedia] = useState<MediaStream | null>();
  const [nextApiKey, setNextApiKey] = useState<CreateProjectKeyResponse | null>(null);
  const keepAliveRef = useRef<number | null>(null);

  const fetchKey = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/deepgram", { cache: "no-store", signal });
      const keyObject = await res.json();
      if (!keyObject || !("key" in keyObject)) {
        throw new Error("No valid API key returned from fetch");
      }
      return keyObject as CreateProjectKeyResponse;
    } catch (error: any) {
      if (error.name === 'AbortError') {
      } else {
        return null;
      }
    }
  }, []);

  const connectToDeepgram = useCallback(async () => {
    setLoading(true);
    try {
      const keyObj = await fetchKey();
      if (!keyObj) {
        setLoading(false);
        return;
      }
      const dg = createClient(keyObj.key);
      const opts: LiveSchema = {
        model: "nova-2",
        language,
        interim_results: true,
        smart_format: true,
      };
      const conn = dg.listen.live(opts);
      setConnection(conn);

      conn.on(LiveTranscriptionEvents.Open, () => {
        setListening(true);
        setLoading(false);
        // set up keepalive every 8 seconds
        keepAliveRef.current = window.setInterval(() => {
          if (conn.getReadyState?.() === 1) {
            conn.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8000);
      });
      conn.on(LiveTranscriptionEvents.Transcript, (data) => {
        if (data.is_final) {
          const caption = data.channel.alternatives[0].words
            .map((w: any) => w.punctuated_word ?? w.word)
            .join(" ");
          if (caption) addTextinTranscription(caption);
        }
      });
      const teardown = () => {
        setConnection(null);
        setListening(false);
        setLoading(false);
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };
      conn.on(LiveTranscriptionEvents.Close, teardown);
      conn.on(LiveTranscriptionEvents.Error, teardown);
    } catch (err) {
      console.error("Error in connectToDeepgram:", err);
      setLoading(false);
    }
  }, [language, fetchKey, addTextinTranscription]);

  const toggleRecorderTranscriber = useCallback(async () => {
    // stop if already recording
    if (micOpen) {
      microphone?.stop();
      setRecorderTranscriber(null);
      setMicOpen(false);
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      connection?.finish();
      setConnection(null);
      setListening(false);
      return;
    }
    // start recording
    let media = userMedia;
    if (!media) {
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
        setUserMedia(media);
      } catch (e) {
        console.error("User media error:", e);
        return;
      }
    }
    const mic = new MediaRecorder(media, { mimeType: 'audio/webm' });
    mic.onstart = () => { setMicOpen(true); };
    mic.onstop = () => { setMicOpen(false); };
    mic.onerror = (e) => console.error("MediaRecorder error:", e);
    mic.ondataavailable = (e) => { if (e.data.size > 0) add(e.data); };
    mic.start(500);
    setRecorderTranscriber(mic);
    // connect to Deepgram
    await connectToDeepgram();
  }, [
    add, microphone, userMedia, micOpen, connection, connectToDeepgram
  ]);

  useEffect(() => {
    const processQueue = async () => {
      const readyState = connection?.getReadyState();
      if (connection && size > 0 && !isProcessing && readyState === 1) {
        setProcessing(true);
        const blob = first;
        connection.send(blob);
        remove();
        const waiting = setTimeout(() => { clearTimeout(waiting); setProcessing(false); }, 100);
      }
    };
    processQueue();
  }, [connection, queue, remove, first, size, isProcessing]);

  return (
    <div className="w-full relative">
      <div className="grid mt-2 align-middle items-center gap-2">
        <Button
          className={cn(
            "h-9 text-white",
            micOpen ? "bg-red-600 hover:bg-red-800" : "bg-green-600 hover:bg-green-800"
          )}
          size="sm"
          variant="outline"
          onClick={toggleRecorderTranscriber}
          disabled={isLoading}
        >
          <div className="flex items-center">
            {micOpen ? <MicOffIcon className="h-4 w-4 -translate-x-0.5 mr-2" /> : <MicIcon className="h-4 w-4 -translate-x-0.5 mr-2" />}
            {isLoading ? "Connecting..." : micOpen ? "Stop listening" : "Start listening"}
          </div>
        </Button>
        {!isListening && !isLoading && !micOpen && (
          <span className="text-xs text-red-500">Deepgram disconnected.</span>
        )}
      </div>
      <div
        className="z-20 text-white flex shrink-0 grow-0 justify-around items-center 
                  fixed bottom-0 right-5 rounded-lg mr-1 mb-5 lg:mr-5 lg:mb-5 xl:mr-10 xl:mb-10 gap-5"
      >
        <span className="text-sm text-gray-400">
          {isListening ? "Connected" : "Disconnected"}
        </span>
        <MicIcon
          className={cn("h-4 w-4 -translate-x-0.5 mr-2", {
            "fill-green-400 drop-shadow-glowBlue": isListening,
            "fill-gray-600": !isListening,
          })}
        />
      </div>
    </div>
  );
}
