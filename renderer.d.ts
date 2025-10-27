export {};

declare global {
  interface Window {
    electron: {
      getSources: () => Promise<{ id: string; name: string }[]>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      setAlwaysOnTop: (isAlwaysOnTop: boolean) => void;
      setOpacity: (opacity: number) => void;
    };
  }
}
