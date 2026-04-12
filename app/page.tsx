import MainPage from "@/components/main";
import { AuthGuard } from "@/components/auth/auth-guard";

// export const runtime = "edge";

export default function Home() {
  return (
    <AuthGuard>
      <MainPage />
    </AuthGuard>
  );
}
