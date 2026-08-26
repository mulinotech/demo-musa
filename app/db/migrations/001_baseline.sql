-- 001_baseline.sql
-- Esquema atual do Musa CRM, na forma final que o app.js produz hoje.
--
-- Fonte: initializeDatabase() em app.js (9 CREATE TABLE + os ALTER acumulados)
-- em 26/08/2026. O schema.sql antigo descrevia apenas 6 tabelas e ficou defasado
-- — este arquivo passa a ser a fonte de verdade do esquema.
--
-- Todos os CREATE usam IF NOT EXISTS: rodar contra o banco de producao existente
-- e um no-op. Contra um banco vazio, cria tudo do zero.

CREATE TABLE IF NOT EXISTS leads (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    whatsapp VARCHAR(50) NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    treatment VARCHAR(255) NOT NULL,
    message TEXT,
    score_result VARCHAR(255) DEFAULT NULL,
    salesperson_id VARCHAR(50) DEFAULT NULL,
    source VARCHAR(50) DEFAULT 'site',
    sales_notes TEXT DEFAULT NULL,
    last_edited_by VARCHAR(255) DEFAULT NULL,
    qualified TINYINT(1) NOT NULL DEFAULT 0,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'novo'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    anamnese TEXT,
    image_base64 LONGTEXT,
    laudo TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatments (
    id VARCHAR(50) PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    procedure_name VARCHAR(255) NOT NULL,
    session_date DATE NOT NULL,
    notes TEXT,
    next_session_date DATE,
    price DECIMAL(10,2) DEFAULT NULL,
    total_sessions INT DEFAULT 1,
    completed_sessions INT DEFAULT 1,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interactions (
    id VARCHAR(50) PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    direction ENUM('in', 'out') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salespeople (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    whatsapp VARCHAR(50) NOT NULL,
    role VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    avatar TEXT DEFAULT NULL,
    password VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatment_catalog (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    package_price DECIMAL(10,2) DEFAULT NULL,
    duration VARCHAR(50) NOT NULL,
    description TEXT,
    target_regions TEXT,
    restrictions TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatment_plans (
    id VARCHAR(50) PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    clinical_objective TEXT,
    total_sessions INT NOT NULL,
    periodicity VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'ATIVO',
    start_date DATE,
    estimated_end_date DATE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatment_sessions (
    id VARCHAR(50) PRIMARY KEY,
    plan_id VARCHAR(50) NOT NULL,
    session_number INT NOT NULL,
    session_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
    equipments_used TEXT,
    supplies_applied TEXT,
    professional_in_charge VARCHAR(255),
    clinical_evolution TEXT,
    media_urls TEXT,
    session_date DATE,
    next_session_date DATE,
    price DECIMAL(10,2) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES treatment_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_logs (
    id VARCHAR(50) PRIMARY KEY,
    action_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    author VARCHAR(255) DEFAULT 'Sistema',
    ip_address VARCHAR(50) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
