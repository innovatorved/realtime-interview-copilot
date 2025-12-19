"use client";

import { Copilot } from "@/components/copilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { HistoryData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

import { useTab } from "@/components/TabContext";

export default function MainPage() {
  const isRendered = useRef(false);
  const [savedData, setSavedData] = useState<HistoryData[]>([]);
  const { activeTab } = useTab();

  const addInSavedData = (data: HistoryData) => {
    setSavedData((prevData) => [data, ...prevData]);
  };

  const deleteData = (createdAt: string) => {
    setSavedData((prevData) =>
      prevData.filter((data) => data.createdAt !== createdAt),
    );
  };

  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;
    const savedData = localStorage.getItem("savedData");
    if (savedData) {
      setSavedData(JSON.parse(savedData) as HistoryData[]);
    }
  }, []);

  useEffect(() => {
    if (savedData) {
      localStorage.setItem("savedData", JSON.stringify(savedData));
    }
  }, [savedData]);

  return (
    <main className="m-2 overscroll-none">
      <div className="mt-10">
        <div className={activeTab === "copilot" ? "block" : "hidden"}>
          <Copilot
            addInSavedData={addInSavedData}
            isActive={activeTab === "copilot"}
          />
          <History data={savedData} deleteData={deleteData} />
        </div>
        <div className={activeTab === "ask-ai" ? "block" : "hidden"}>
          <QuestionAssistant isActive={activeTab === "ask-ai"} />
        </div>
      </div>
    </main>
  );
}
