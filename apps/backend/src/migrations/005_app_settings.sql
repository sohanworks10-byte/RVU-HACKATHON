CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings (key, value)
VALUES
  ('agent_binary_url_linux_amd64', ''),
  ('agent_binary_url_linux_arm64', '')
ON CONFLICT (key) DO NOTHING;
