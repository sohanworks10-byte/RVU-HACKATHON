# AlphaOps - DevOps Control Center

**RVU Hackathon Submission**

AlphaOps is a comprehensive DevOps control center that provides unified server management, monitoring, CI/CD pipeline orchestration, and infrastructure automation through an intuitive web interface.

## 🚀 Features

### 1. **Agent-Based Server Management**
- Lightweight agent deployment on remote servers
- Real-time server monitoring and statistics
- Secure WebSocket-based communication
- No SSH required - works behind firewalls

### 2. **Real-Time Monitoring**
- CPU, Memory, Disk, and Network metrics
- Live process monitoring
- Custom refresh intervals (1s - 60s)
- Historical data tracking
- Alert thresholds and notifications

### 3. **CI/CD Pipeline Builder**
- Visual pipeline designer
- Multi-stage workflow support
- GitHub Actions integration
- Jenkins integration
- Terraform deployment automation
- Blue-Green deployment strategies

### 4. **File Manager**
- Remote file browsing and editing
- Bulk file operations
- File upload/download
- Syntax highlighting for code files

### 5. **Terminal Access**
- Web-based SSH terminal
- Command history
- Multiple session support
- Secure authentication

### 6. **Task Automation**
- Scheduled task execution
- Cron job management
- Script library
- Task templates

### 7. **Security & Access Control**
- Role-based access control (RBAC)
- Supabase authentication
- Encrypted credentials storage
- Audit logging

## 🏗️ Architecture

```
┌─────────────────┐
│   Web Frontend  │ (React + Tailwind CSS)
│  (apps/desktop) │
└────────┬────────┘
         │
         ├─── HTTP API ───┐
         │                │
         └─── WebSocket ──┤
                          │
                ┌─────────▼─────────┐
                │   Backend Server  │ (Node.js + Express)
                │  (apps/backend)   │
                └─────────┬─────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼────┐    ┌─────▼─────┐   ┌─────▼─────┐
    │ Supabase│    │   Redis   │   │  Agents   │
    │   DB    │    │   Cache   │   │ (Servers) │
    └─────────┘    └───────────┘   └───────────┘
```

## 📦 Project Structure

```
AlphaOps/
├── apps/
│   ├── backend/          # Node.js backend server
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── routes/
│   │   │   ├── migrations/
│   │   │   └── index.js
│   │   └── package.json
│   │
│   └── desktop/          # Web frontend
│       ├── index.html
│       ├── monitoring-modern.html
│       ├── web-shim.js
│       ├── server.js
│       └── package.json
│
├── agent-repo/           # Lightweight agent for servers
│   ├── agent.js
│   └── package.json
│
└── render.yaml          # Deployment configuration
```

## 🛠️ Technology Stack

### Frontend
- **Framework**: Vanilla JS + HTML5
- **Styling**: Tailwind CSS
- **Charts**: ApexCharts
- **Icons**: Font Awesome
- **Authentication**: Supabase Auth

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **Cache**: Redis
- **WebSocket**: ws library
- **Storage**: AWS S3
- **Deployment**: Render.com

### Agent
- **Runtime**: Node.js
- **System Info**: systeminformation library
- **Communication**: WebSocket client

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL (or Supabase account)
- Redis (optional, for caching)

### 1. Clone Repository
```bash
git clone https://github.com/sohanworks10-byte/RVU-HACKATHON.git
cd RVU-HACKATHON
```

### 2. Setup Backend
```bash
cd apps/backend
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npm run migrate

# Start backend
npm start
```

Backend will run on `http://localhost:3001`

### 3. Setup Frontend
```bash
cd apps/desktop
npm install

# Start web server
npm run web
```

Frontend will run on `http://localhost:3000`

### 4. Deploy Agent (on remote server)
```bash
# On your remote server
curl -o agent.js https://raw.githubusercontent.com/sohanworks10-byte/RVU-HACKATHON/main/agent-repo/agent.js

# Install dependencies
npm install ws systeminformation

# Run agent (get AGENT_ID from web UI)
AGENT_ID=your-agent-id BACKEND_URL=https://your-backend.com node agent.js
```

## 🔧 Configuration

### Backend Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Redis (optional)
REDIS_URL=redis://localhost:6379

# AWS S3 (for artifacts)
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
S3_BUCKET=your-bucket

# Server
PORT=3001
NODE_ENV=production
```

### Frontend Configuration
The frontend automatically detects the backend URL. To override:
```javascript
localStorage.setItem('AlphaOpsBackendUrl', 'http://localhost:3001');
```

## 📊 Database Schema

### Key Tables
- `servers` - Server/agent registrations
- `agents` - Agent connection metadata
- `pipelines` - CI/CD pipeline definitions
- `runs` - Pipeline execution history
- `artifacts` - Build artifacts
- `audit_logs` - Security audit trail
- `secrets` - Encrypted credentials

See `apps/backend/src/migrations/` for full schema.

## 🔐 Security Features

1. **Authentication**: Supabase Auth with JWT tokens
2. **Authorization**: Row-level security (RLS) policies
3. **Encryption**: Credentials encrypted at rest
4. **Audit Logging**: All actions logged with user context
5. **RBAC**: Role-based access control (Admin, Developer, Viewer)
6. **Secure Communication**: WSS for agent connections

## 🎯 Use Cases

1. **Startup Teams**: Manage multiple servers without complex tools
2. **DevOps Engineers**: Unified dashboard for all infrastructure
3. **CI/CD Automation**: Visual pipeline builder with deployment
4. **Server Monitoring**: Real-time metrics and alerts
5. **Remote Management**: Access servers from anywhere

## 🐛 Known Issues & Fixes

### Backend URL Not Loading
**Fix**: Applied in commit `42c2573` - Property name mismatch in web-shim.js

### Agent Connection Issues
**Fix**: Database schema updated with migration `007_servers_and_agents.sql`

See `BACKEND_URL_FIX.md` for detailed troubleshooting.

## 📈 Future Enhancements

- [ ] Kubernetes integration
- [ ] Docker container management
- [ ] Multi-cloud support (AWS, Azure, GCP)
- [ ] Mobile app
- [ ] Slack/Discord notifications
- [ ] Custom dashboard widgets
- [ ] AI-powered anomaly detection
- [ ] Cost optimization recommendations

## 🤝 Contributing

This is a hackathon project. Contributions welcome!

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

MIT License - See LICENSE file for details

## 👥 Team

**RVU Hackathon Team**
- Developer: Sohan
- Repository: https://github.com/sohanworks10-byte/RVU-HACKATHON

## 🙏 Acknowledgments

- Supabase for authentication and database
- Render.com for hosting
- Tailwind CSS for styling
- ApexCharts for visualizations

## 📞 Support

For issues or questions:
- GitHub Issues: https://github.com/sohanworks10-byte/RVU-HACKATHON/issues
- Email: sohan@AlphaOps.com

---

**Built with ❤️ for RVU Hackathon**
