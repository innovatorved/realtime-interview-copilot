import { AuthGuard } from "@/components/auth/auth-guard";
import { ByokSettingsPage } from "@/components/settings/ByokSettings";

export default function ByokPage() {
  return (
    <AuthGuard>
      <ByokSettingsPage />
    </AuthGuard>
  );
}
