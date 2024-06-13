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

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string) => void;
}

export default function RecorderTranscriber({
  addTextinTranscription,
}: RecorderTranscriberProps) {
  const isRendered = useRef(false);
  const { add, remove, first, size, queue } = useQueue<any>([]);
  const [apiKey, setApiKey] = useState<CreateProjectKeyResponse | null>();
  const [connection, setConnection] = useState<LiveClient | null>();
  const [isListening, setListening] = useState(false);
  const [isLoadingKey, setLoadingKey] = useState(true);
  const [isLoading, setLoading] = useState(true);
  const [isProcessing, setProcessing] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [microphone, setRecorderTranscriber] = useState<MediaRecorder | null>();
  const [userMedia, setUserMedia] = useState<MediaStream | null>();

  const [caption, setCaption] = useState<string | null>();

  const toggleRecorderTranscriber = useCallback(async () => {
    let currentMedia = userMedia;
    if (microphone && userMedia) {
      microphone.stop();
      setRecorderTranscriber(null);
    } else {
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
  }, [add, microphone, userMedia]);

  useEffect(() => {
    console.log({ apiKey });
    if (apiKey) return;
    // if (isRendered.current) return;
    isRendered.current = true;
    console.log("getting a new api key");
    fetch("/api/deepgram", { cache: "no-store" })
      .then((res) => res.json())
      .then((object) => {
        console.log(object);
        if (!("key" in object)) throw new Error("No api key returned");

        setApiKey(object);
        setLoadingKey(false);
      })
      .catch((e) => {
        console.error(e);
      });
  }, [apiKey]);

  useEffect(() => {
    if (apiKey && "key" in apiKey) {
      console.log("connecting to deepgram");
      const deepgram = createClient(apiKey?.key ?? "");
      const connection = deepgram.listen.live({
        model: "nova-2",
        interim_results: true,
        smart_format: true,
      });

      connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("connection established");
        setListening(true);
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        console.log("connection closed");
        setListening(false);
        setApiKey(null);
        setConnection(null);
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const words = data.channel.alternatives[0].words;
        const caption = words
          .map((word: any) => word.punctuated_word ?? word.word)
          .join(" ");
        if (caption !== "") {
          setCaption(caption);
          addTextinTranscription(caption);
        }
      });

      setConnection(connection);
      setLoading(false);
    }
  }, [apiKey]);

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
        Loading temporary API key...
      </span>
    );
  if (isLoading)
    return (
      <span className="w-full p-2 text-center text-xs bg-red-500 text-white">
        Loading the app...
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
            ? "Deepgram connection open!"
            : "Deepgram is connecting..."}
        </span>
        <MicIcon
          className={cn("h-4 w-4 -translate-x-0.5 mr-2", {
            "fill-green-400 drop-shadow-glowBlue": isListening,
            "fill-green-600": !isListening,
          })}
        />
      </div>
    </div>
  );
}
