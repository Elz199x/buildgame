import "../globals.css";

// สไตล์ของหน้าทดสอบ Gateway ใช้เฉพาะ /online (ไม่ให้รั่วไปทับหน้าเกมหลัก)
export default function OnlineLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
