import MainPage from "@/components/main";
import TopBar from "@/components/TopBar";

// export const runtime = "edge";

export default function Home() {
  return (
    <main className="m-2 overscroll-none">
      <TopBar />
      <MainPage />
    </main>
  );
}
