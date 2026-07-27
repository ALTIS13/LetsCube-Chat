import { HumanVerificationCaptcha } from "@/components/security/HumanVerificationCaptcha";

interface AuthCaptchaProps {
  disabled?: boolean;
  onTokenChange: (token: string) => void;
  resetSignal?: number;
}

export function AuthCaptcha(props: AuthCaptchaProps) {
  return (
    <HumanVerificationCaptcha
      {...props}
      testId="auth-captcha"
      ariaLabel="Проверка защиты от автоматических регистраций"
    />
  );
}
