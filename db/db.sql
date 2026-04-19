CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--  ENUMS

CREATE TYPE user_role AS ENUM ('admin','expert','student','client');

CREATE TYPE user_status AS ENUM ('active','inactive','suspended','pending');

CREATE TYPE service_domain AS ENUM ('web_dev','mobile_dev','ui_ux_design','video_editing','other');

CREATE TYPE project_status AS ENUM ('submitted','under_review','accepted','in_progress','in_review','delivered','rejected','cancelled');

CREATE TYPE task_status AS ENUM ('open','in_progress','in_review','completed','blocked');

CREATE TYPE application_status AS ENUM ('pending','selected','rejected','withdrawn');

CREATE TYPE payment_status AS ENUM ('pending','processed','failed','refunded');

CREATE TYPE payment_method AS ENUM ('baridimob','ccp','bank_transfer','cash');

CREATE TYPE recipient_type AS ENUM ('student','expert','referral');

CREATE TYPE interview_status AS ENUM ('scheduled','completed','cancelled','rescheduled');

CREATE TYPE interview_result AS ENUM ('admitted','rejected','pending');

CREATE TYPE ai_agent_type AS ENUM ('task_breakdown','team_matching');

CREATE TYPE referral_status AS ENUM ('pending','converted','rejected','bonus_paid');

CREATE TYPE commit_frequency AS ENUM ('daily','every_two_days','weekly');

--  TABLE: user
--  Base table for all users (admin, expert, student, client)
CREATE TABLE "user" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    last_name VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(30) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role user_role NOT NULL,
    status user_status NOT NULL DEFAULT 'pending',
    domain service_domain,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_email ON "user" (email);

CREATE INDEX idx_user_role ON "user" (role);

CREATE INDEX idx_user_domain ON "user" (domain);
--  TABLE: student
--  Extends user for role = 'student'


CREATE TABLE student (
    user_id UUID PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
    cv_url TEXT,
    portfolio_url TEXT,
    global_rating NUMERIC(4, 2) DEFAULT 0.00 CHECK (
        global_rating BETWEEN 0 AND 10
    ),
    consecutive_projects INTEGER NOT NULL DEFAULT 0,
    enrollment_proof_expiry DATE,
    wilaya VARCHAR(100),
    university VARCHAR(255)
);

--  TABLE: expert
--  Extends user for role = 'expert'

CREATE TABLE expert (
    user_id UUID PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
    specialty VARCHAR(255),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    bio TEXT
);

--  TABLE: client
--  Extends user for role = 'client'

CREATE TABLE client (
    user_id UUID PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
    company VARCHAR(255),
    city VARCHAR(100)
);

--  TABLE: enrollment_proof
--  Annual enrollment proof submitted by students

CREATE TABLE enrollment_proof (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    academic_year VARCHAR(9) NOT NULL,
    document_url TEXT NOT NULL,
    valid BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated_at TIMESTAMPTZ,
    validated_by UUID REFERENCES "user" (id)
);

CREATE INDEX idx_enrollment_proof_student ON enrollment_proof (student_id);

--  TABLE: interview
--  Online interview between expert and student
CREATE TABLE interview (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    expert_id UUID NOT NULL REFERENCES expert (user_id),
    scheduled_at TIMESTAMPTZ NOT NULL,
    meeting_link TEXT,
    status interview_status NOT NULL DEFAULT 'scheduled',
    result interview_result,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_student ON interview (student_id);

CREATE INDEX idx_interview_expert ON interview (expert_id);
--  TABLE: project
--  Core project entity

CREATE TABLE project (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    client_id UUID NOT NULL REFERENCES client (user_id),
    expert_id UUID REFERENCES expert (user_id),
    title VARCHAR(255) NOT NULL,
    service_type service_domain NOT NULL,
    description TEXT NOT NULL,
    status project_status NOT NULL DEFAULT 'submitted',
    total_price NUMERIC(10, 2) CHECK (total_price > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    team_size INTEGER DEFAULT 1 CHECK (team_size > 0),
    expert_notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_client ON project (client_id);

CREATE INDEX idx_project_expert ON project (expert_id);

CREATE INDEX idx_project_status ON project (status);

CREATE INDEX idx_project_domain ON project (service_type);

--  TABLE: application
--  Student application to a project

CREATE TABLE application (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    status application_status NOT NULL DEFAULT 'pending',
    referral_priority BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, project_id)
);

CREATE INDEX idx_application_student ON application (student_id);

CREATE INDEX idx_application_project ON application (project_id);

CREATE INDEX idx_application_status ON application (status);

--  TABLE: project_group
--  Workspace opened once team is selected

CREATE TABLE project_group (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    project_id UUID NOT NULL UNIQUE REFERENCES project (id) ON DELETE CASCADE,
    comm_channel TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--  TABLE: group_member
--  Junction: student ↔ project_group

CREATE TABLE group_member (
    group_id UUID NOT NULL REFERENCES project_group (id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, student_id)
);

CREATE INDEX idx_group_member_student ON group_member (student_id);
--  TABLE: task
--  Task within a project, AI-proposed then expert-approved
CREATE TABLE task (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    student_id UUID REFERENCES student (user_id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    weight_pct NUMERIC(5, 2) NOT NULL CHECK (
        weight_pct > 0
        AND weight_pct <= 100
    ),
    status task_status NOT NULL DEFAULT 'open',
    commit_freq commit_frequency,
    due_date TIMESTAMPTZ,
    domain_tag service_domain,
    ai_proposed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_project ON task (project_id);

CREATE INDEX idx_task_student ON task (student_id);

CREATE INDEX idx_task_status ON task (status);

-- Note: weight_pct sum per project must equal 100
-- Enforced at Express application level before DB write

--  TABLE: rating
--  Multi-dimensional student rating per project

CREATE TABLE rating (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    expert_id UUID NOT NULL REFERENCES expert (user_id),
    quality NUMERIC(3, 1) CHECK (quality BETWEEN 0 AND 10),
    deadline NUMERIC(3, 1) CHECK (deadline BETWEEN 0 AND 10),
    communication NUMERIC(3, 1) CHECK (
        communication BETWEEN 0 AND 10
    ),
    collaboration NUMERIC(3, 1) CHECK (
        collaboration BETWEEN 0 AND 10
    ),
    technical NUMERIC(3, 1) CHECK (technical BETWEEN 0 AND 10),
    global_score NUMERIC(4, 2) GENERATED ALWAYS AS (
        ROUND(
            (
                quality + deadline + communication + collaboration + technical
            ) / 5.0,
            2
        )
    ) STORED,
    comment TEXT,
    rated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, project_id)
);

CREATE INDEX idx_rating_student ON rating (student_id);

CREATE INDEX idx_rating_project ON rating (project_id);
--  TABLE: certificate
--  Auto-generated PDF certificate after project delivery
CREATE TABLE certificate (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    service_type service_domain NOT NULL,
    duration_days INTEGER,
    pdf_url TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, project_id)
);

CREATE INDEX idx_certificate_student ON certificate (student_id);

--  TABLE: referral
--  Student referral of a client

CREATE TABLE referral (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id UUID NOT NULL REFERENCES student (user_id) ON DELETE CASCADE,
    project_id UUID REFERENCES project (id),
    client_contact VARCHAR(255) NOT NULL,
    bonus_amount NUMERIC(10, 2),
    status referral_status NOT NULL DEFAULT 'pending',
    referred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_student ON referral (student_id);

CREATE INDEX idx_referral_project ON referral (project_id);

--  TABLE: payment
--  Payment disbursement record (student, expert, or referral bonus)

CREATE TABLE payment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    project_id UUID NOT NULL REFERENCES project (id),
    recipient_id UUID NOT NULL REFERENCES "user" (id),
    recipient_type recipient_type NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL DEFAULT 'baridimob',
    status payment_status NOT NULL DEFAULT 'pending',
    transaction_ref VARCHAR(255),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_project ON payment (project_id);

CREATE INDEX idx_payment_recipient ON payment (recipient_id);

CREATE INDEX idx_payment_status ON payment (status);


--  TABLE: ai_log
--  Audit log for every AI agent API call

CREATE TABLE ai_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    project_id UUID REFERENCES project (id),
    agent_type ai_agent_type NOT NULL,
    input_summary TEXT,
    output_valid BOOLEAN NOT NULL DEFAULT FALSE,
    expert_approved BOOLEAN,
    edits_made BOOLEAN,
    tokens_used INTEGER,
    called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_log_project ON ai_log (project_id);

CREATE INDEX idx_ai_log_type ON ai_log (agent_type);

--  TABLE: team_suggestion
--  AI team suggestion output (Student Matching Agent)
CREATE TABLE team_suggestion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    log_id UUID REFERENCES ai_log (id),
    ai_output JSONB NOT NULL,
    expert_approved BOOLEAN NOT NULL DEFAULT FALSE,
    edits_made BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_suggestion_project ON team_suggestion (project_id);

--  TABLE: notification
--  In-app and push notifications for all users

CREATE TABLE notification (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_user ON notification (user_id);

CREATE INDEX idx_notification_read ON notification (read);
--  TRIGGER: auto-update updated_at on user, project, task
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON "user"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_project_updated_at
    BEFORE UPDATE ON project
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_task_updated_at
    BEFORE UPDATE ON task
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--  TRIGGER: update student.global_rating after rating insert/update

CREATE OR REPLACE FUNCTION update_global_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE student
    SET global_rating = (
        SELECT ROUND(AVG(global_score), 2)
        FROM rating
        WHERE student_id = NEW.student_id
    )
    WHERE user_id = NEW.student_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_global_rating
    AFTER INSERT OR UPDATE ON rating
    FOR EACH ROW EXECUTE FUNCTION update_global_rating();

--  VIEW: v_payment_breakdown
--  Financial breakdown per project (40/30/30 split)

CREATE VIEW v_payment_breakdown AS
SELECT
    p.id AS project_id,
    p.title,
    p.total_price,
    ROUND(p.total_price * 0.40, 2) AS organization_share,
    ROUND(p.total_price * 0.30, 2) AS expert_share,
    ROUND(p.total_price * 0.30, 2) AS student_pool
FROM project p
WHERE
    p.total_price IS NOT NULL;

--  VIEW: v_student_stats
--  Student performance overview — used as input for AI matching

CREATE VIEW v_student_stats AS
SELECT
    s.user_id,
    u.last_name,
    u.first_name,
    u.domain,
    s.global_rating,
    s.consecutive_projects,
    COUNT(DISTINCT a.project_id) FILTER (
        WHERE
            a.status = 'selected'
    ) AS completed_projects,
    COUNT(DISTINCT r.project_id) AS ratings_received
FROM
    student s
    JOIN "user" u ON u.id = s.user_id
    LEFT JOIN application a ON a.student_id = s.user_id
    LEFT JOIN rating r ON r.student_id = s.user_id
GROUP BY
    s.user_id,
    u.last_name,
    u.first_name,
    u.domain,
    s.global_rating,
    s.consecutive_projects;

--  VIEW: v_project_board
--  Project board view for expert portal and admin panel
CREATE VIEW v_project_board AS
SELECT
    p.id AS project_id,
    p.title,
    p.service_type,
    p.status,
    p.total_price,
    p.created_at,
    p.delivered_at,
    p.team_size,
    CONCAT(
        uc.first_name,
        ' ',
        uc.last_name
    ) AS client_name,
    CONCAT(
        ue.first_name,
        ' ',
        ue.last_name
    ) AS expert_name,
    COUNT(DISTINCT a.id) FILTER (
        WHERE
            a.status = 'pending'
    ) AS pending_applications,
    COUNT(DISTINCT t.id) AS total_tasks,
    COUNT(DISTINCT t.id) FILTER (
        WHERE
            t.status = 'completed'
    ) AS completed_tasks
FROM
    project p
    JOIN "user" uc ON uc.id = p.client_id
    LEFT JOIN "user" ue ON ue.id = p.expert_id
    LEFT JOIN application a ON a.project_id = p.id
    LEFT JOIN task t ON t.project_id = p.id
GROUP BY
    p.id,
    p.title,
    p.service_type,
    p.status,
    p.total_price,
    p.created_at,
    p.delivered_at,
    p.team_size,
    uc.first_name,
    uc.last_name,
    ue.first_name,
    ue.last_name;
--  SAMPLE SEED DATA (development only)
INSERT INTO
    "user" (
        id,
        last_name,
        first_name,
        email,
        phone,
        password,
        role,
        status
    )
VALUES (
        uuid_generate_v4 (),
        'Admin',
        'TalentBridge',
        'admin@talentbridge.dz',
        '+213000000000',
        crypt (
            'admin_password',
            gen_salt ('bf')
        ),
        'admin',
        'active'
    );