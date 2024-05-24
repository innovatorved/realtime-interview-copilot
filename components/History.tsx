"use client";

import { Card } from "@/components/ui/card";
import { ContentData } from "./ui/content";
import { HistoryData } from "@/lib/types";

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
            <Card key={index} className="p-4 bg-green-100">
              <div className="flex mt-2 text-xs">
                {data.tag} • {data.createdAt} •{" "}
                <button
                  className="text-xs text-red-500 hover:text-red-800 underline"
                  onClick={() => {
                    deleteData(data.createdAt);
                  }}
                >
                  Delete
                </button>
              </div>
              <ContentData className="mt-2 text-sm" contentMaxLength={100}>
                {data.data}
              </ContentData>
            </Card>
          ))}
      </main>
    </div>
  );
}
