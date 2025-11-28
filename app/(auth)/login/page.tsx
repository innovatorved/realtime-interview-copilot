import { AuthWizard } from "@/components/auth/auth-wizard";

export default function LoginPage() {
  return <AuthWizard initialStep="signin" />;
}
