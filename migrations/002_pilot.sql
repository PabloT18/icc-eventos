CREATE TABLE pilot_invites (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);
