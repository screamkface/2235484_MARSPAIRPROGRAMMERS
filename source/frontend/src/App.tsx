import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8002";

function App() {
  const [status, setStatus] = useState("loading...");
  const [wsMessage, setWsMessage] = useState("waiting...");

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(JSON.stringify(data)))
      .catch((err) => {
        console.error("Health check failed:", err);
        setStatus("engine-service not reachable");
      });

    const ws = new WebSocket(`ws://localhost:8002/ws`);
    ws.onmessage = (event) => setWsMessage(event.data);

    return () => ws.close();
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Mars Habitat Dashboard</h1>
      <p><strong>Engine status:</strong> {status}</p>
      <p><strong>Realtime:</strong> {wsMessage}</p>
    </div>
  );
}

export default App;