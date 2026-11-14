"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, auth, NetworkError } from "@/lib/api";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // ล็อกอินอยู่แล้ว → เข้าเกมเลย
  useEffect(() => {
    auth
      .me()
      .then((me) => (me ? router.replace("/") : setChecking(false)))
      .catch((e) => {
        setChecking(false);
        if (e instanceof NetworkError) setError("เซิร์ฟเวอร์เกมยังไม่เปิด (รัน: cd server && go run ./cmd/gameserver)");
      });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await (mode === "login" ? auth.login : auth.register)(username.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError || err instanceof NetworkError ? err.message : "เกิดข้อผิดพลาด");
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="lg-page">
        <p className="lg-muted">กำลังตรวจสอบเซสชัน…</p>
      </main>
    );
  }

  return (
    <main className="lg-page">
      <form className="lg-card" onSubmit={submit} noValidate>
        <h1>
          RO <b>Cat Quest World</b>
        </h1>
        <p className="lg-muted">{mode === "login" ? "เข้าสู่ระบบเพื่อเล่นต่อ" : "สร้างบัญชีใหม่ (พร้อมตัวละครของคุณ)"}</p>

        <label>
          ชื่อผู้ใช้
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            maxLength={20}
            placeholder="a-z A-Z 0-9 _ (3–20 ตัว)"
          />
        </label>
        <label>
          รหัสผ่าน
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            maxLength={128}
            placeholder={mode === "register" ? "อย่างน้อย 8 ตัวอักษร" : ""}
          />
        </label>

        {error && (
          <p className="lg-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !username || !password}>
          {busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สมัครและเข้าเกม"}
        </button>
        <button
          type="button"
          className="lg-link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}
        </button>
      </form>
    </main>
  );
}
