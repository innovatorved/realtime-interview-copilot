"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { MinusIcon, PlusIcon, Cross1Icon } from "@radix-ui/react-icons";

export default function TopBar() {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [transparency, setTransparency] = useState(1);

  const handleMinimize = () => {
    window.electron.minimize();
  };

  const handleMaximize = () => {
    window.electron.maximize();
  };

  const handleClose = () => {
    window.electron.close();
  };

  const handleAlwaysOnTop = () => {
    setIsAlwaysOnTop(!isAlwaysOnTop);
    window.electron.setAlwaysOnTop(!isAlwaysOnTop);
  };

  const handleTransparencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTransparency = parseFloat(e.target.value);
    setTransparency(newTransparency);
    window.electron.setOpacity(newTransparency);
  };

  return (
    <div
      className="flex items-center justify-between h-8 bg-gray-800 text-white"
      style={{
        // @ts-ignore
        "-webkit-app-region": "drag",
      }}
    >
      <div className="flex items-center">
        <Button
          onClick={handleMinimize}
          className="w-8 h-8 flex items-center justify-center"
          style={{
            // @ts-ignore
            "-webkit-app-region": "no-drag",
          }}
        >
          <MinusIcon />
        </Button>
        <Button
          onClick={handleMaximize}
          className="w-8 h-8 flex items-center justify-center"
          style={{
            // @ts-ignore
            "-webkit-app-region": "no-drag",
          }}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="flex items-center">
        <label htmlFor="transparency">Transparency</label>
        <input
          type="range"
          id="transparency"
          min="0.1"
          max="1"
          step="0.1"
          value={transparency}
          onChange={handleTransparencyChange}
          style={{
            // @ts-ignore
            "-webkit-app-region": "no-drag",
          }}
        />
        <Button
          onClick={handleAlwaysOnTop}
          className="w-8 h-8 flex items-center justify-center"
          style={{
            // @ts-ignore
            "-webkit-app-region": "no-drag",
          }}
        >
          {isAlwaysOnTop ? "AOT" : "Not AOT"}
        </Button>
        <Button
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center"
          style={{
            // @ts-ignore
            "-webkit-app-region": "no-drag",
          }}
        >
          <Cross1Icon />
        </Button>
      </div>
    </div>
  );
}
