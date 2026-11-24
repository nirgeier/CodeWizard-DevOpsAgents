import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { FcGoogle } from "react-icons/fc";
import { FaGithub, FaLinkedin } from "react-icons/fa";
import { localPreviewAllowed } from "@/lib/auth";

export const metadata = { title: "התחברות" };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; message?: string; mode?: string }>;
}) {
  const { next, message, mode } = await searchParams;
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const signup = mode === "signup";
  const hostname = (await headers()).get("host")?.split(":")[0] ?? "";
  return (
    <section className="login-panel" aria-label="התחברות ל-CodeWizard">
      <Image className="login-logo" src="/codewizard-logo.png" width={365} height={100} alt="CodeWizard" priority />
      <p className="login-subtitle">משרות והזדמנויות במקום אחד</p>
      <nav className="login-modes" aria-label="בחירת סוג חשבון">
        <Link href={`/login?${new URLSearchParams({ next: destination })}`} aria-current={!signup ? "page" : undefined}>התחברות</Link>
        <Link href={`/login?${new URLSearchParams({ mode: "signup", next: destination })}`} aria-current={signup ? "page" : undefined}>יצירת חשבון</Link>
      </nav>
      {message === "error" && <p className="login-notice login-error" role="alert">{signup ? "יצירת החשבון נכשלה. בדקו את הפרטים ונסו שוב." : "ההתחברות נכשלה. בדקו את הפרטים או את הגדרות ספק ההתחברות."}</p>}
      {message === "mismatch" && signup && <p className="login-notice login-error" role="alert">הסיסמאות אינן תואמות.</p>}
      {message === "confirm" && <p className="login-notice" role="status">נשלח אימייל לאישור החשבון.</p>}
      {signup ? (
        <form action="/auth/action" method="post" className="login-form">
          <input type="hidden" name="next" value={destination} />
          <label htmlFor="signup-email">אימייל</label>
          <input id="signup-email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" dir="ltr" />
          <label htmlFor="signup-password">סיסמה</label>
          <input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <label htmlFor="signup-confirmation">אישור סיסמה</label>
          <input id="signup-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required />
          <button className="login-primary" type="submit" name="action" value="signup">יצירת חשבון</button>
        </form>
      ) : (
        <form action="/auth/action" method="post" className="login-form">
          <input type="hidden" name="next" value={destination} />
          <label htmlFor="login-email">אימייל</label>
          <input id="login-email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" dir="ltr" />
          <label htmlFor="login-password">סיסמה</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" minLength={8} required />
          <button className="login-primary" type="submit" name="action" value="login">התחברות</button>
        </form>
      )}
      <div className="login-divider"><span>או המשך עם</span></div>
      <div className="login-providers">
        {([ ["google", "Google", FcGoogle], ["github", "GitHub", FaGithub], ["linkedin_oidc", "LinkedIn", FaLinkedin] ] as const).map(([provider, label, Icon]) => (
          <form key={provider} action="/auth/action" method="post">
            <input type="hidden" name="next" value={destination} />
            <input type="hidden" name="provider" value={provider} />
            <button className={`login-provider login-provider-${provider}`} type="submit" name="action" value="oauth"><Icon aria-hidden="true" />המשך עם {label}</button>
          </form>
        ))}
      </div>
      {localPreviewAllowed(hostname) && (
        <form action="/auth/action" method="post" className="login-preview">
          <label><input type="checkbox" name="preview" required /> דלג על ההתחברות (תצוגה מקומית)</label>
          <button type="submit" name="action" value="preview">כניסה לאפליקציה</button>
        </form>
      )}
    </section>
  );
}