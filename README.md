# AlphaOps

**AlphaOps** is a lightweight, high-performance server management platform. It allows you to securely connect to and manage remote Linux servers via SSH or a custom WebSocket-based Agent.

---

## 🚀 Key Features

*   **Server Management:** Connect, monitor, and manage remote Linux servers.
*   **Real-time Monitoring:** Live telemetry for CPU, RAM, Disk I/O, and critical system services.
*   **Secure Remote Access:** Support for both direct SSH connections and a secure, lightweight WebSocket-based Agent.
*   **AI Assitant (AlphaAI):** Built-in AI chat system to instantly generate shell commands or scripts based on live server context.
*   **File Management:** Integrated file explorer for remote systems.

---

## 🏗️ System Architecture

- **Backend:** Node.js server orchestrating SSH and Agent connections.
- **Web Client:** React-based dashboard for managing your infrastructure.
- **Server Agent:** Minimal standalone Node.js daemon for secure, firewall-bypassing connections.

---

## 🏁 Getting Started

### Prerequisites

*   **Node.js:** v18 or v20+ recommended.
*   **Supabase:** A Supabase project (URL and Anon keys).

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Servers

```bash
# Start backend
npm run dev:backend

# Start frontend
npm run dev:web
```

---

## 📜 License

MIT
