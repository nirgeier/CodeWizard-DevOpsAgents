"use client";

import React from "react";

interface ScanButtonProps {
  sourceId: string;
  companyName: string;
  disabled?: boolean;
}

export function ScanButton({ sourceId, companyName, disabled }: ScanButtonProps) {
  const [status, setStatus] = React.useState<"idle" | "scanning" | "completed" | "failed">("idle");
  const [result, setResult] = React.useState<string | null>(null);

  const handleScan = async () => {
    setStatus("scanning");
    setResult(null);
    try {
      const res = await fetch("/api/agents/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, options: { pages: 2 } }),
      });
      if (res.ok) {
        // Poll for completion
        let done = false;
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const statusRes = await fetch(`/api/agents/scan?sourceId=${sourceId}`);
          if (statusRes.ok) {
            const data = await statusRes.json();
            if (data.status === "completed") {
              setStatus("completed");
              setResult(`נמצאו ${data.result?.scanned || 0}, נשמרו ${data.result?.saved || 0}`);
              done = true;
              break;
            } else if (data.status === "failed") {
              setStatus("failed");
              setResult(data.error || "שגיאה");
              done = true;
              break;
            }
          }
        }
        if (!done) {
          setStatus("failed");
          setResult("Timeout - בדוק סטטוס בעמוד הסוכנים");
        }
      } else {
        setStatus("failed");
        setResult("שגיאה בהפעלה");
      }
    } catch (err) {
      setStatus("failed");
      setResult("שגיאת רשת");
    }
  };

  if (status === "scanning") {
    return (
      <button className="btn btn-primary loading" disabled style={{ fontSize: "12px", padding: "4px 10px" }}>
        <span className="spinner"></span> סורק...
      </button>
    );
  }
  if (status === "completed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span className="badge conf-green" style={{ fontSize: "11px" }}>הושלם</span>
        {result && <span style={{ fontSize: "11px", color: "var(--green)" }}>{result}</span>}
        <button 
          className="btn btn-secondary" 
          onClick={() => { setStatus("idle"); setResult(null); }}
          style={{ fontSize: "11px", padding: "3px 8px" }}
        >
          סרוק שוב
        </button>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span className="badge" style={{ background: "#fbe4e4", color: "#a52b2b", fontSize: "11px" }}>נכשל</span>
        {result && <span style={{ fontSize: "11px", color: "var(--red)" }}>{result}</span>}
        <button 
          className="btn btn-secondary" 
          onClick={() => { setStatus("idle"); setResult(null); }}
          style={{ fontSize: "11px", padding: "3px 8px" }}
        >
          נסה שוב
        </button>
      </div>
    );
  }

  return (
    <button 
      className="btn btn-primary" 
      onClick={handleScan} 
      disabled={disabled}
      style={{ fontSize: "12px", padding: "4px 10px" }}
    >
      סרוק
    </button>
  );
}