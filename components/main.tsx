"use client";

import { Copilot } from "@/components/copilot";
import History from "@/components/History";
import { HistoryData } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

export default function MainPage() {
  const isRendered = useRef(false);
  const [savedData, setSavedData] = useState<HistoryData[]>([]);

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
      <Copilot addInSavedData={addInSavedData} />
      <History data={savedData} deleteData={deleteData} />
    </main>
  );
}
