-- Set agent binary URLs for global distribution
-- These URLs are used by the install.sh script to download prebuilt binaries

INSERT INTO app_settings (key, value) 
VALUES 
  ('agent_binary_url_linux_amd64', 'https://github.com/sohan20051519/devyntra-agent/releases/download/v0.1.0/devyntra-agent-linux-amd64'),
  ('agent_binary_url_linux_arm64', 'https://github.com/sohan20051519/devyntra-agent/releases/download/v0.1.0/devyntra-agent-linux-arm64')
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value, 
    updated_at = NOW();
