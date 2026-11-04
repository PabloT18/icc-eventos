CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL CHECK(email=lower(trim(email))),
 name text NOT NULL DEFAULT '', global_role text NOT NULL DEFAULT 'USER' CHECK(global_role IN ('ADMIN','USER')), active boolean NOT NULL DEFAULT true);
INSERT INTO users(email,name,global_role) VALUES ('ptorresp@ups.edu.ec','Administrador','ADMIN');
CREATE TABLE events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, item text NOT NULL,
 period text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','CLOSED')),
 email_enabled boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE event_readers(event_id uuid REFERENCES events, user_id uuid REFERENCES users, role text NOT NULL CHECK(role IN ('LECTOR','LECTOR_SUPER')), active boolean NOT NULL DEFAULT true, PRIMARY KEY(event_id,user_id));
CREATE TABLE otp_challenges(email text PRIMARY KEY, digest text NOT NULL, expires_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0, sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits(key text PRIMARY KEY, count int NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE sessions(digest text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, expires_at timestamptz NOT NULL);
CREATE TABLE scan_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events, actor_id uuid NOT NULL REFERENCES users, valid boolean NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE qr_validations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events, actor_id uuid NOT NULL REFERENCES users, student jsonb NOT NULL, expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false);
CREATE TABLE deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events, student_code text NOT NULL, student_name text NOT NULL, student_email text NOT NULL, actor_id uuid NOT NULL REFERENCES users, method text NOT NULL CHECK(method IN ('QR','MANUAL')), observation text NOT NULL DEFAULT '', validation_id uuid REFERENCES qr_validations, status text NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','CANCELLED')), delivered_at timestamptz NOT NULL DEFAULT now(), cancellation_reason text, cancelled_by uuid REFERENCES users, cancelled_at timestamptz, request_id uuid NOT NULL UNIQUE, CHECK(method!='MANUAL' OR length(trim(observation))>=5), CHECK(method!='QR' OR validation_id IS NOT NULL));
CREATE UNIQUE INDEX uq_active_delivery ON deliveries(event_id,student_code) WHERE status='CONFIRMED';
CREATE INDEX delivery_report ON deliveries(event_id,delivered_at);
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users, action text NOT NULL, entity_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE email_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid UNIQUE NOT NULL REFERENCES deliveries, recipient text NOT NULL, body text NOT NULL, attempts int NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
