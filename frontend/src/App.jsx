import { useMemo, useState } from "react";

export default function App() {
  const [files, setFiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [question, setQuestion] = useState("");
  const [chatBySession, setChatBySession] = useState({});
  const [loading, setLoading] = useState(false);

  const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";



  const activeChat = useMemo(
    () => chatBySession[activeSessionId] || [],
    [chatBySession, activeSessionId]
  );

  const uploadFile = async (file) => {
    if (!API) throw new Error("API URL is not configured.");
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || "Upload failed.");
    }

    return {
      id: data.session_id,
      name: data.filename || file.name || "unnamed.pdf",
    };
  };

  const handleUpload = async () => {
    if (!files.length) return alert("Upload at least one PDF.");
    setLoading(true);

    try {
      const results = [];
      for (const f of files) {
        const s = await uploadFile(f);
        results.push(s);
      }

      setSessions((prev) => [...results, ...prev]);
      const firstId = results[0]?.id;
      if (firstId) setActiveSessionId(firstId);
      setFiles([]);
      alert("PDF(s) ready! Ask questions.");
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const askQuestion = async () => {
    if (!question.trim()) return;
    if (!activeSessionId) return alert("Select a PDF first.");
    if (!API) return alert("API URL is not configured.");

    const userMsg = { role: "user", text: question };
    setChatBySession((prev) => ({
      ...prev,
      [activeSessionId]: [...(prev[activeSessionId] || []), userMsg],
    }));

    setLoading(true);

    try {
      const res = await fetch(
        `${API}/ask?session_id=${encodeURIComponent(activeSessionId)}&question=${encodeURIComponent(question)}`
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Request failed.");
      }

      const botMsg = {
        role: "bot",
        text: data.answer || "No response.",
      };

      setChatBySession((prev) => ({
        ...prev,
        [activeSessionId]: [...(prev[activeSessionId] || []), botMsg],
      }));

      setQuestion("");
    } catch (err) {
      alert(err.message || "Failed to fetch response.");
    } finally {
      setLoading(false);
    }
  };

  const deleteFile = async (sessionId) => {
    if (!sessionId) return;
    if (!API) return alert("API URL is not configured.");

    setLoading(true);

    try {
      const res = await fetch(
        `${API}/delete?session_id=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Delete failed.");
      }

      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setChatBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      if (sessionId === activeSessionId) {
        const nextActive = sessions.find((s) => s.id !== sessionId)?.id || null;
        setActiveSessionId(nextActive);
      }
    } catch (err) {
      alert(err.message || "Delete failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      <div className="max-w-6xl mx-auto px-4">
        <header className="py-6 border-b border-white/10">
          <div className="flex items-center justify-center gap-3 text-2xl font-semibold tracking-wide">
            <span className="text-2xl">📄</span>
            <span>AI PDF Chat</span>
          </div>
        </header>

        <div className="py-6 grid gap-6">
          <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">Upload PDFs</p>
              <p className="text-sm text-white/70 mb-4">
                Upload multiple PDFs and choose which one to chat with.
              </p>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-center gap-4">
              <input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="w-full md:w-auto text-sm bg-black/30 border border-white/20 rounded-lg px-3 py-2"
              />
              <button
                onClick={handleUpload}
                disabled={loading}
                className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                Upload
              </button>
            </div>

            {files.length > 0 && (
              <div className="mt-4 text-center text-sm text-white/70">
                {files.length} file(s) selected
              </div>
            )}
          </section>

          <section className="grid md:grid-cols-[280px_1fr] gap-6">
            <aside className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="font-semibold mb-3 text-center">Your PDFs</div>
              {sessions.length === 0 && (
                <div className="text-sm text-white/60 text-center">
                  Upload a PDF to start chatting.
                </div>
              )}
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`w-full px-3 py-2 rounded-lg border flex items-center gap-2 ${
                      s.id === activeSessionId
                        ? "bg-white/15 border-white/30"
                        : "bg-black/20 border-white/10"
                    }`}
                  >
                    <button
                      onClick={() => setActiveSessionId(s.id)}
                      className="flex-1 text-left"
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() => deleteFile(s.id)}
                      disabled={loading}
                      className="text-xs text-red-300 hover:text-red-200"
                      title="Delete PDF"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col min-h-[420px]">
              <div className="flex-1 overflow-y-auto space-y-3 pb-4">
                {activeChat.length === 0 && (
                  <div className="text-white/60 text-center mt-8">
                    Select a PDF and ask a question.
                  </div>
                )}

                {activeChat.map((msg, i) => (
                  <div
                    key={i}
                    className={`max-w-xl p-3 rounded-xl ${
                      msg.role === "user"
                        ? "bg-emerald-600 text-black ml-auto"
                        : "bg-black/30"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}

                {loading && (
                  <div className="text-white/60">AI thinking...</div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4 flex flex-col md:flex-row gap-3 items-center">
                <input
                  className="flex-1 w-full bg-black/30 p-3 rounded-xl outline-none"
                  placeholder="Ask anything about the selected PDF..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <div className="flex gap-3">
                  <button
                    onClick={askQuestion}
                    disabled={loading || !activeSessionId}
                    className="bg-emerald-500 text-black px-6 py-2 rounded-xl font-semibold hover:bg-emerald-400 disabled:opacity-60"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => deleteFile(activeSessionId)}
                    disabled={loading || !activeSessionId}
                    className="bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-400 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
