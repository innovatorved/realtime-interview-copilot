import MainPage from "@/components/main";
import { AuthGuard } from "@/components/auth/auth-guard";

// export const runtime = "edge";

export default function Home() {
  return (
    <AuthGuard>
      <main className="mt-12 m-2 overscroll-none">
        <MainPage />
      </main>
    </AuthGuard>
  );
}
