"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RecorderTranscriber from "@/components/recorder";
import { useCallback, useRef, useState } from "react";

import { useCompletion } from "ai/react";
import { FLAGS } from "@/lib/types";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export function Copilot() {
  const bgRef = useRef<HTMLTextAreaElement>(null);

  const [transcribedText, setTranscribedText] = useState<string>("");

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const setFlag = (flag: FLAGS) => {
    router.push(
      `${pathname}?${createQueryString({
        flag,
      })}`,
      {
        scroll: false,
      },
    );
  };

  const createQueryString = useCallback(
    (params: Record<string, string | number | null>) => {
      const newSearchParams = new URLSearchParams(searchParams?.toString());

      for (const [key, value] of Object.entries(params)) {
        if (value === null) {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      return newSearchParams.toString();
    },
    [searchParams],
  );

  const { completion, stop, isLoading, error, setInput, handleSubmit } =
    useCompletion({
      api: "/api/openai/completion",
      body: {
        bg: bgRef.current?.value,
        flag: searchParams.get("flag") || FLAGS.COPILOT,
      },
    });

  const handleSummarize = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFlag(FLAGS.SUMMERIZER);
    handleSubmit(e);
  };
  const handleCopilot = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFlag(FLAGS.COPILOT);
    handleSubmit(e);
  };

  const addTextinTranscription = (text: string) => {
    setTranscribedText((prev) => prev + " " + text);
  };
  const handleTranscriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setInput(e.target.value);
    setTranscribedText(e.target.value);
  };

  return (
    <div className="grid w-full gap-4 mt-12">
      <h2 className="text-3xl underline text-green-700">
        Realtime Interview Copilot
      </h2>
      {error && (
        <div className="fixed top-0 left-0 w-full p-4 text-center text-xs bg-red-500 text-white">
          {error.message}
        </div>
      )}
      <div className="grid gap-4 grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="system_prompt" className="text-green-800">
            Interview Background
          </Label>
          <Textarea
            id="system_prompt"
            placeholder="Type or paste your text here."
            className="resize-none h-[50px] overflow-hidden"
            style={{ lineHeight: "1.5", maxHeight: "150px" }}
            ref={bgRef}
          />
          <RecorderTranscriber
            addTextinTranscription={addTextinTranscription}
          />
        </div>

        <div className="grid gap-1.5 my-2">
          <Label htmlFor="transcribtion" className="text-green-800">
            Transcription
          </Label>
          <Textarea
            id="transcribtion"
            className="h-[100px] min-h-[100px] mt-2"
            placeholder="Your transcribed text will appear here."
            value={transcribedText}
            onChange={handleTranscriptionChange}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <form onSubmit={handleCopilot}>
          <Button
            className="h-9 w-full bg-green-600 hover:bg-green-800 text-white"
            size="sm"
            variant="outline"
            disabled={isLoading}
            type="submit"
          >
            Suggest
          </Button>
        </form>
        <form onSubmit={handleSummarize}>
          <Button
            className="h-9 w-full bg-green-600 hover:bg-green-800 text-white"
            size="sm"
            variant="outline"
            disabled={isLoading}
            type="submit"
          >
            Summarize
          </Button>
        </form>
      </div>

      <div className="flex mx-2 md:mx-10 mt-4">{completion}</div>
    </div>
  );
}
