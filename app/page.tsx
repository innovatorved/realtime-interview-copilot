import MainPage from "@/components/main";
import { AuthGuard } from "@/components/auth/auth-guard";

// export const runtime = "edge";

export default function Home() {
  return (
    <AuthGuard>
      <main className="mt-8 overscroll-none">
        <MainPage />
      </main>
    </AuthGuard>
  );
}
