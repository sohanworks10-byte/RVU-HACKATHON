# Devyntra Desktop Architecture & Diagrams

This document provides a simple overview of the Devyntra desktop software architecture through four key diagrams: Architecture, ER, DFD, and Sequence.

## 1. System Architecture
The system follows a dual-process architecture for security and performance.

```mermaid
graph TD
    subgraph "Desktop Application (Electron)"
        UI[Frontend UI - React/HTML]
        Main[Main Process - Node.js]
        IPC[IPC Bridge]
    end

    subgraph "External Services"
        SB[Supabase - Auth/DB]
        API[OpenRouter - AI Agent]
    end

    subgraph "Remote Nodes"
        Node[Target Server - SSH/Agent]
    end

    UI <--> IPC <--> Main
    Main <--> SB
    Main <--> API
    Main <--> Node
```

## 2. Entity Relationship (ER) Diagram
The core data structure focusing on servers and users.

```mermaid
erDiagram
    USER ||--o{ SERVER : "manages"
    USER {
        string id PK
        string email
        string full_name
        string avatar_url
    }
    SERVER {
        string id PK
        string user_id FK
        string name
        string host
        string username
        string auth_type
    }
```

## 3. Data Flow Diagram (DFD)
How data moves from the user interface to remote servers.

```mermaid
graph LR
    User([User]) -- "Enters Commands" --> UI[User Interface]
    UI -- "IPC Request" --> Main[Main Process]
    Main -- "SSH/TCP" --> Remote[Remote Server]
    Remote -- "Stream Output" --> Main
    Main -- "IPC Event" --> UI
    UI -- "Display results" --> User
```

## 4. Sequence Diagram
The flow of connecting to a remote server.

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend (React)
    participant M as Main Process (Electron)
    participant S as Remote Server

    U->>F: Clicks 'Connect'
    F->>M: ipcRenderer.invoke('ssh:connect', serverId)
    M->>M: Fetch credentials from Memory
    M->>S: Establish SSH Connection
    S-->>M: Auth Success
    M-->>F: Return { success: true }
    F->>U: Show Terminal/FileManager
```

## Simple Steps to Understand
1. **Frontend (React)**: What you see and interact with.
2. **Main Process (Node.js)**: The brain that handles security and connections.
3. **IPC Bridge**: The secure tunnel between the view and the brain.
4. **Remote Connection**: Securely managing your servers via SSH or the Devyntra Agent.
