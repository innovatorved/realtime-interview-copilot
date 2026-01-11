"use client";

import { Card } from "@/components/ui/card";
import { ContentData } from "./ui/content";
import { HistoryData } from "@/lib/types";
import posthog from "posthog-js";

interface HistoryProps {
  data: HistoryData[];
  deleteData: (createdAt: string) => void;
}

export default function History({ data: savedData, deleteData }: HistoryProps) {
  return (
    <div className="flex flex-col w-full">
      <main className="overflow-auto p-4 space-y-4">
        {savedData &&
          savedData?.map((data, index) => (
            <Card key={index} className="p-4 glass border-0 shadow-none">
              <div className="flex mt-2 text-xs text-gray-300">
                {data.tag} • {data.createdAt} •{" "}
                <button
                  className="text-xs text-red-400 hover:text-red-300 underline ml-1"
                  onClick={() => {
                    // Capture history item deleted event with PostHog
                    posthog.capture("history_item_deleted", {
                      tag: data.tag,
                    });
                    deleteData(data.createdAt);
                  }}
                >
                  Delete
                </button>
              </div>
              <ContentData
                className="mt-2 text-sm text-white"
                contentMaxLength={100}
              >
                {data.data}
              </ContentData>
            </Card>
          ))}
      </main>
    </div>
  );
}
