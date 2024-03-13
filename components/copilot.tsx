"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RecorderTranscriber from "@/components/recorder";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCompletion } from "ai/react";
import { FLAGS } from "@/lib/types";
import { Switch } from "@/components/ui/switch";

export function Copilot() {
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");

  const { completion, stop, isLoading, error, setInput, handleSubmit } =
    useCompletion({
      api: "/api/groq/completion",
      body: {
        bg,
        flag,
      },
    });

  const handleFlag = useCallback((checked: boolean) => {
    if (!checked) {
      setFlag(FLAGS.SUMMERIZER);
    } else {
      setFlag(FLAGS.COPILOT);
    }
  }, []);

  const addTextinTranscription = (text: string) => {
    setInput((prev) => prev + " " + text);
    setTranscribedText((prev) => prev + " " + text);
  };
  const handleTranscriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setInput(e.target.value);
    setTranscribedText(e.target.value);
  };

  useEffect(() => {
    const savedBg = localStorage.getItem("bg");
    if (savedBg) {
      setBg(savedBg);
    }
  }, []);

  useEffect(() => {
    if (!bg) return;
    localStorage.setItem("bg", bg);
  }, [bg]);

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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="system_prompt" className="text-green-800">
            Interview Background
          </Label>
          <Textarea
            id="system_prompt"
            placeholder="Type or paste your text here."
            className="resize-none h-[50px] overflow-hidden"
            style={{ lineHeight: "1.5", maxHeight: "150px" }}
            value={bg}
            onChange={(e) => setBg(e.target.value)}
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
      <div>
        <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-2">
          <div className="flex items-center justify-center w-full border">
            <Label className="text-green-800">Summerizer</Label>
            <Switch
              className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-200 m-2"
              onCheckedChange={handleFlag}
              defaultChecked
            />
            <Label className="text-green-800">Copilot</Label>
          </div>

          <Button
            className="h-9 w-full bg-green-600 hover:bg-green-800 text-white"
            size="sm"
            variant="outline"
            disabled={isLoading}
            type="submit"
          >
            Process
          </Button>
        </form>
      </div>

      <div className="flex mx-2 md:mx-10 mt-4">{completion}</div>
    </div>
  );
}
