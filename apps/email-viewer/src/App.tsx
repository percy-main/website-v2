import { useEffect, useState } from "react";

interface EmailEntry {
  id: string;
  to: string;
  subject: string;
}

export function App() {
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    fetch("/api/emails")
      .then((r) => r.json())
      .then(setEmails);
  }, []);

  useEffect(() => {
    if (!selected) {
      setHtml("");
      return;
    }
    fetch(`/api/email/${encodeURIComponent(selected)}`)
      .then((r) => r.text())
      .then(setHtml);
  }, [selected]);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui" }}>
      {/* Email list */}
      <div
        style={{
          width: 360,
          borderRight: "1px solid #ddd",
          overflowY: "auto",
          background: "#fafafa",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #ddd",
            fontWeight: 600,
            fontSize: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Local Emails ({emails.length})</span>
          <button
            onClick={() =>
              fetch("/api/emails")
                .then((r) => r.json())
                .then(setEmails)
            }
            style={{
              border: "1px solid #ccc",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 12,
              background: "white",
            }}
          >
            Refresh
          </button>
        </div>
        {emails.length === 0 && (
          <div style={{ padding: 16, color: "#888", fontSize: 13 }}>
            No emails yet. They&apos;ll appear here when the API sends them
            locally.
          </div>
        )}
        {emails.map((e) => (
          <div
            key={e.id}
            onClick={() => setSelected(e.id)}
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #eee",
              cursor: "pointer",
              background: selected === e.id ? "#e8f0fe" : "transparent",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: selected === e.id ? 600 : 400,
                marginBottom: 2,
              }}
            >
              {e.subject}
            </div>
            <div style={{ fontSize: 11, color: "#666" }}>
              {e.to} &middot; {formatTime(e.id)}
            </div>
          </div>
        ))}
      </div>

      {/* Email preview */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {!selected ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#888",
            }}
          >
            Select an email to preview
          </div>
        ) : (
          <iframe
            srcDoc={html}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="Email preview"
          />
        )}
      </div>
    </div>
  );
}
