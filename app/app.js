'use strict';

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const url = require('url');

// Carregar variáveis de ambiente do .env (se existir)
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (e) {
  // dotenv é opcional
}

const app = express();
// ---- TRAVA EMERGENCIAL 26/08/2026 - remover quando o JWT (T0.3) entrar ----
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const auth = require('./auth');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: 'https://demo-musa.mulinotech.com' }));
app.use('/api', rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false }));
const ROTAS_PUBLICAS = [
  { method: 'POST', path: '/api/leads' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET',  path: '/api/config' },
  { method: 'POST', path: '/api/webhook/whatsapp' }
];
app.use('/api', function (req, res, next) {
  res.set('X-Trava-Musa', 'v3');
  const caminho = req.originalUrl.split('?')[0];
  if (ROTAS_PUBLICAS.some(function (r) { return r.method === req.method && caminho === r.path; })) return next();
  const tokenUser = auth.usuarioDaRequisicao(req);
  if (tokenUser) { req.usuario = tokenUser; return next(); }
  return res.status(401).json({ error: 'Sessao nao autenticada ou expirada.' });
});
// ---- AUTORIZACAO POR PAPEL (T0.3 etapa 3) ----
const REGRAS_DE_PAPEL = [
  { metodo: '*',      prefixo: '/api/_migrate',          papeis: ['admin'] },
  { metodo: '*',      prefixo: '/api/logs',              papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/salespeople',       papeis: ['admin', 'gerente'] },
  { metodo: 'POST',   prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'PATCH',  prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/treatment-catalog', papeis: ['admin', 'gerente'] },
  { metodo: 'DELETE', prefixo: '/api/clients',           papeis: ['admin', 'gerente'] },
  { metodo: '*',      prefixo: '/api/users',             papeis: ['admin'] }
];

app.use('/api', function (req, res, next) {
  const caminho = req.originalUrl.split('?')[0];
  const regra = REGRAS_DE_PAPEL.find(function (r) {
    return (r.metodo === '*' || r.metodo === req.method) && caminho.indexOf(r.prefixo) === 0;
  });
  if (!regra) return next();
  if (!req.usuario || regra.papeis.indexOf(req.usuario.papel) === -1) {
    return res.status(403).json({ error: 'Sem permissao para esta area.' });
  }
  next();
});
// ---- FIM DA AUTENTICACAO E AUTORIZACAO ----

// ---- LOGIN COM JWT (T0.3 etapa 1) - aceita e-mail+senha e o formato antigo ----
app.post('/api/auth/login', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const email = (req.body && req.body.email || '').trim().toLowerCase();
  const senha = req.body && req.body.password || '';
  if (!senha) return res.status(400).json({ error: 'Senha e obrigatoria.' });

  try {
    if (email) {
      const [r] = await pool.query("SELECT * FROM users WHERE email = ? AND status = 'active'", [email]);
      if (!r.length || !bcrypt.compareSync(senha, r[0].password_hash)) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      const u = r[0];
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
      return res.json({ token: auth.gerarToken(u), role: u.role, salespersonName: u.name, salespersonId: u.salesperson_id });
    }

    return res.status(401).json({ error: 'Informe e-mail e senha.' });
  } catch (e) {
    return res.status(500).json({ error: 'Falha no login.' });
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir arquivos estáticos do frontend React compilados (pasta dist)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Configuração da Pool de Conexão com o MySQL na Cloudez
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME || '',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('Conexao com o banco de dados MySQL realizada com sucesso!');
    
    // Auto-migrate all tables if not exist
    
    // 1. Leads
    await connection.query(`
      CREATE TABLE IF NOT EXISTS leads (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          whatsapp VARCHAR(20) NOT NULL,
          treatment VARCHAR(255) NOT NULL,
          message TEXT,
          score_result VARCHAR(255) DEFAULT NULL,
          salesperson_id VARCHAR(50) DEFAULT NULL,
          date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status ENUM('novo', 'contatado', 'agendado', 'arquivado') DEFAULT 'novo',
          last_edited_by VARCHAR(255) DEFAULT NULL,
          qualified TINYINT(1) NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await connection.query(`ALTER TABLE leads ADD COLUMN last_edited_by VARCHAR(255) DEFAULT NULL;`);
    } catch (e) {
      // Ignorar se a coluna já existir
    }

    try {
      await connection.query(`ALTER TABLE leads ADD COLUMN sales_notes TEXT DEFAULT NULL;`);
    } catch (e) {
      // Ignorar se a coluna já existir
    }

    try {
      await connection.query(`ALTER TABLE leads ADD COLUMN qualified TINYINT(1) NOT NULL DEFAULT 0;`);
    } catch (e) {
      // Ignorar se a coluna já existir
    }

    // 2. Clients
    await connection.query(`
      CREATE TABLE IF NOT EXISTS clients (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          phone VARCHAR(50) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Treatments
    await connection.query(`
      CREATE TABLE IF NOT EXISTS treatments (
          id VARCHAR(50) PRIMARY KEY,
          client_id VARCHAR(50) NOT NULL,
          procedure_name VARCHAR(255) NOT NULL,
          session_date DATE NOT NULL,
          notes TEXT,
          next_session_date DATE,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Interactions
    await connection.query(`
      CREATE TABLE IF NOT EXISTS interactions (
          id VARCHAR(50) PRIMARY KEY,
          client_id VARCHAR(50) NOT NULL,
          type VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          direction ENUM('in', 'out') NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Salespeople
    await connection.query(`
      CREATE TABLE IF NOT EXISTS salespeople (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) DEFAULT NULL,
          whatsapp VARCHAR(50) NOT NULL,
          role VARCHAR(100) NOT NULL,
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Treatment Catalog
    await connection.query(`
      CREATE TABLE IF NOT EXISTS treatment_catalog (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          price DECIMAL(10,2) NOT NULL,
          duration VARCHAR(50) NOT NULL,
          description TEXT,
          target_regions TEXT,
          restrictions TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Treatment Plans (Macro)
    await connection.query(`
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
    `);

    // 8. Treatment Sessions (Micro)
    await connection.query(`
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
    `);

    // Add salesperson_id and source to leads if they don't exist
    try {
      await connection.query('ALTER TABLE leads ADD COLUMN salesperson_id VARCHAR(50) DEFAULT NULL');
      console.log('Coluna salesperson_id adicionada em leads.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE leads ADD COLUMN source VARCHAR(50) DEFAULT "site"');
      console.log('Coluna source adicionada em leads.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE leads MODIFY COLUMN whatsapp VARCHAR(50) NOT NULL');
      console.log('Coluna whatsapp modificada para VARCHAR(50) em leads.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE leads ADD COLUMN email VARCHAR(255) DEFAULT NULL');
      console.log('Coluna email adicionada em leads.');
    } catch(e) {}
    try {
      await connection.query("ALTER TABLE leads MODIFY COLUMN status VARCHAR(50) DEFAULT 'novo'");
      console.log('Coluna status modificada para VARCHAR(50) em leads.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE clients MODIFY COLUMN phone VARCHAR(50) NOT NULL');
      console.log('Coluna phone modificada para VARCHAR(50) em clients.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE salespeople MODIFY COLUMN whatsapp VARCHAR(50) NOT NULL');
      console.log('Coluna whatsapp modificada para VARCHAR(50) em salespeople.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE salespeople MODIFY COLUMN email VARCHAR(255) DEFAULT NULL');
      console.log('Coluna email modificada para DEFAULT NULL em salespeople.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE salespeople ADD COLUMN avatar TEXT DEFAULT NULL');
      console.log('Coluna avatar adicionada em salespeople.');
    } catch(e) {}
    // Add anamnese to clients
    try {
      await connection.query('ALTER TABLE clients ADD COLUMN anamnese TEXT');
      console.log('Coluna anamnese adicionada em clients.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE clients ADD COLUMN image_base64 LONGTEXT');
      console.log('Coluna image_base64 adicionada em clients.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE clients ADD COLUMN laudo TEXT');
      console.log('Coluna laudo adicionada em clients.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE treatments ADD COLUMN price DECIMAL(10,2) DEFAULT NULL');
      console.log('Coluna price adicionada em treatments.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE treatments ADD COLUMN total_sessions INT DEFAULT 1');
      console.log('Coluna total_sessions adicionada em treatments.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE treatments ADD COLUMN completed_sessions INT DEFAULT 1');
      console.log('Coluna completed_sessions adicionada em treatments.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE salespeople ADD COLUMN password VARCHAR(255) DEFAULT NULL');
      console.log('Coluna password adicionada em salespeople.');
    } catch(e) {}
    try {
      await connection.query('ALTER TABLE treatment_catalog ADD COLUMN package_price DECIMAL(10,2) DEFAULT NULL');
      console.log('Coluna package_price adicionada em treatment_catalog.');
    } catch(e) {}

    // Criar tabela de logs de auditoria se nao existir
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
          id VARCHAR(50) PRIMARY KEY,
          action_type VARCHAR(50) NOT NULL,
          description TEXT NOT NULL,
          author VARCHAR(255) DEFAULT 'Sistema',
          ip_address VARCHAR(50) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    connection.release();
  } catch (error) {
    console.error('Falha na conexao com o banco de dados:', error.message);
  }
}
initializeDatabase();

// Função helper para gravar logs do sistema
async function logSystemEvent(actionType, description, author = 'Sistema', ipAddress = null) {
  try {
    const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    await pool.query(
      'INSERT INTO system_logs (id, action_type, description, author, ip_address, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [id, actionType, description, author, ipAddress]
    );
  } catch (err) {
    console.error('Erro ao gravar log de sistema:', err.message);
  }
}


// ROTAS DO CRM

// Rota GET /api/logs (Consulta de auditoria imutável read-only)
app.get('/api/logs', async function(req, res) {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== 'MusaElite2026!Vx7Q' && adminPassword !== 'MusaEquipe2026!Rb4T') {
    return res.status(401).json({ error: 'Acesso não autorizado aos logs do sistema.' });
  }

  try {
    const [rows] = await pool.query(`
      SELECT 
        id, 
        action_type as actionType, 
        description, 
        author, 
        ip_address as ipAddress, 
        created_at as createdAt 
      FROM system_logs 
      ORDER BY created_at DESC 
      LIMIT 500
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar logs do sistema', details: error.message });
  }
});



// 1. Listar todos os leads
app.get('/api/leads', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM leads ORDER BY date DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar leads', details: error.message });
  }
});

// 2. Criar um novo lead (Formulário ou Quiz)
app.post('/api/leads', async function(req, res) {
  const { id, name, whatsapp, email, treatment, message, scoreResult, date, status, salespersonId, source } = req.body;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema (Site/Formulario)';

  if (!name || !whatsapp || !treatment) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes (name, whatsapp, treatment).' });
  }

  try {
    const leadId = id || Math.random().toString(36).substring(2, 9);
    const query = `
      INSERT INTO leads (id, name, whatsapp, email, treatment, message, score_result, salesperson_id, source, date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.query(query, [
      leadId,
      name,
      whatsapp,
      email || null,
      treatment,
      message || '',
      scoreResult || null,
      salespersonId || null,
      source || 'site',
      date ? new Date(date) : new Date(),
      status || 'novo'
    ]);

    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    await logSystemEvent(
      'LEAD_CREATE',
      `Novo lead cadastrado: "${getFirstName(name)}" (${whatsapp}) - Interesse: ${treatment}`,
      authorName,
      req.ip
    );

    // O id precisa voltar para o frontend poder selecionar a conversa recém-criada
    res.status(201).json({ id: leadId, message: 'Lead inserido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar o lead', details: error.message });
  }
});

// 3. Atualizar um lead (status, whatsapp, email)
app.put('/api/leads/:id', async function(req, res) {
  const { id } = req.params;
  const { status, whatsapp, email, salesNotes, qualified, treatment } = req.body;
  try {
    let updateFields = [];
    let queryParams = [];
    const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema';

    if (status !== undefined) {
      updateFields.push('status = ?');
      queryParams.push(status);
    }
    if (whatsapp !== undefined) {
      updateFields.push('whatsapp = ?');
      queryParams.push(whatsapp);
    }
    if (email !== undefined) {
      updateFields.push('email = ?');
      queryParams.push(email);
    }
    if (salesNotes !== undefined) {
      updateFields.push('sales_notes = ?');
      queryParams.push(salesNotes);
    }
    if (qualified !== undefined) {
      updateFields.push('qualified = ?');
      queryParams.push(qualified ? 1 : 0);
    }
    if (treatment !== undefined && treatment !== '') {
      updateFields.push('treatment = ?');
      queryParams.push(treatment);
    }

    updateFields.push('last_edited_by = ?');
    queryParams.push(authorName);

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    // Helper para extrair o primeiro nome do lead
    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    const [leadRows] = await pool.query('SELECT name, whatsapp FROM leads WHERE id = ?', [id]);
    const leadFirstName = leadRows[0] ? getFirstName(leadRows[0].name) : '';
    const leadInfo = leadRows[0] ? `"${leadFirstName}" (${leadRows[0].whatsapp})` : `ID ${id}`;

    queryParams.push(id);
    const query = `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, queryParams);

    const changesText = status ? `Status alterado para "${status}"` : 'Dados de contato atualizados';
    await logSystemEvent(
      'LEAD_UPDATE',
      `Lead ${leadInfo} atualizado: ${changesText}`,
      authorName,
      req.ip
    );

    res.json({ message: 'Lead atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar o lead', details: error.message });
  }
});

// 4. Excluir um lead
app.delete('/api/leads/:id', async function(req, res) {
  const { id } = req.params;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema';
  try {
    // Buscar nome e telefone antes de excluir para constar no histórico de auditoria
    const [leadRows] = await pool.query('SELECT name, whatsapp, treatment FROM leads WHERE id = ?', [id]);
    const getFirstName = (fullName) => (fullName || '').trim().split(' ')[0] || fullName;
    const leadFirstName = leadRows[0] ? getFirstName(leadRows[0].name) : '';
    const leadInfo = leadRows[0] 
      ? `"${leadFirstName}" (WhatsApp: ${leadRows[0].whatsapp} | Tratamento: ${leadRows[0].treatment})` 
      : `ID ${id}`;

    await pool.query('DELETE FROM leads WHERE id = ?', [id]);
    await logSystemEvent(
      'LEAD_DELETE',
      `Lead ${leadInfo} foi removido do sistema`,
      authorName,
      req.ip
    );
    res.json({ message: 'Lead excluido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir o lead', details: error.message });
  }
});

// 4.1. Vendedores (Salespeople)
app.get('/api/salespeople', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM salespeople ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar vendedores', details: error.message });
  }
});

app.post('/api/salespeople', async function(req, res) {
  const { name, email, whatsapp, avatar, role, password, status } = req.body;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Proprietária (Master)';
  if (!name || !whatsapp) {
    return res.status(400).json({ error: 'Nome e WhatsApp sao obrigatorios.' });
  }

  try {
    const id = Math.random().toString(36).substring(2, 9);
    await pool.query(
      'INSERT INTO salespeople (id, name, email, whatsapp, avatar, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, email || null, whatsapp, avatar || null, role || 'vendedor', password || null, status || 'active']
    );

    await logSystemEvent(
      'SALESPERSON_CREATE',
      `Novo membro da equipe comercial cadastrado: "${name}" - Cargo: ${role || 'vendedor'}`,
      authorName,
      req.ip
    );

    res.status(201).json({ message: 'Vendedor cadastrado com sucesso!', id });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar vendedor', details: error.message });
  }
});

app.patch('/api/salespeople/:id', async function(req, res) {
  const { id } = req.params;
  const { name, email, whatsapp, role, password, status } = req.body;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Proprietária (Master)';
  try {
    if (password) {
      await pool.query(
        'UPDATE salespeople SET name = COALESCE(?, name), email = COALESCE(?, email), whatsapp = COALESCE(?, whatsapp), role = COALESCE(?, role), password = COALESCE(?, password), status = COALESCE(?, status) WHERE id = ?',
        [name || null, email || null, whatsapp || null, role || null, password, status || null, id]
      );
    } else {
      await pool.query(
        'UPDATE salespeople SET name = COALESCE(?, name), email = COALESCE(?, email), whatsapp = COALESCE(?, whatsapp), role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?',
        [name || null, email || null, whatsapp || null, role || null, status || null, id]
      );
    }
    await logSystemEvent(
      'SALESPERSON_UPDATE',
      `Dados do vendedor ID ${id} foram alterados (Nome: ${name || 'N/A'}, Cargo: ${role || 'N/A'})`,
      authorName,
      req.ip
    );

    res.json({ message: 'Vendedor atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar vendedor', details: error.message });
  }
});

app.delete('/api/salespeople/:id', async function(req, res) {
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Proprietária (Master)';
  try {
    await pool.query('DELETE FROM salespeople WHERE id = ?', [req.params.id]);
    await logSystemEvent(
      'SALESPERSON_DELETE',
      `Membro da equipe comercial ID ${req.params.id} foi excluído`,
      authorName,
      req.ip
    );
    res.json({ message: 'Vendedor excluido' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir', details: error.message });
  }
});

// 4.2. Catalogo de Tratamentos (Treatment Catalog)
app.get('/api/treatment-catalog', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM treatment_catalog ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar catalogo', details: error.message });
  }
});

app.post('/api/treatment-catalog', async function(req, res) {
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'Nome e Preco sao obrigatorios.' });
  
  const id = 'tc_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query(
      'INSERT INTO treatment_catalog (id, name, price, package_price, duration, description, target_regions, restrictions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
      [id, name, price, packagePrice || null, duration || '', description || '', targetRegions || '', restrictions || '']
    );
    res.status(201).json({ id, name, price, packagePrice, duration, description, targetRegions, restrictions });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar tratamento no catalogo', details: error.message });
  }
});

app.patch('/api/treatment-catalog/:id', async function(req, res) {
  const { id } = req.params;
  const { name, price, packagePrice, duration, description, targetRegions, restrictions } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_catalog SET name = COALESCE(?, name), price = COALESCE(?, price), package_price = COALESCE(?, package_price), duration = COALESCE(?, duration), description = COALESCE(?, description), target_regions = COALESCE(?, target_regions), restrictions = COALESCE(?, restrictions) WHERE id = ?',
      [name, price, packagePrice === undefined ? null : packagePrice, duration, description, targetRegions, restrictions, id]
    );
    res.json({ message: 'Tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tratamento no catalogo', details: error.message });
  }
});

app.delete('/api/treatment-catalog/:id', async function(req, res) {
  try {
    await pool.query('DELETE FROM treatment_catalog WHERE id = ?', [req.params.id]);
    res.json({ message: 'Tratamento excluido do catalogo' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir', details: error.message });
  }
});

// EVOLUTION API E OUTROS ENDPOINTS CRM UNIFICADOS

// Estado simulado em memória para Evolution API
let SIMULATED_INSTANCES = [
  {
    name: 'Musa_Estetica_Oficial',
    status: 'open',
    number: '5511900000000',
  }
];

// Erros de rede transitórios que valem uma nova tentativa.
// "socket hang up" (ECONNRESET) acontece quando o Node reaproveita um socket
// keep-alive que a Evolution API acabou de fechar - a requisição nunca chega ao
// servidor, portanto repetir é seguro e não gera mensagem duplicada.
const RETRYABLE_NET_ERRORS = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ESOCKETTIMEDOUT'];

function isRetryableNetworkError(err) {
  if (!err) return false;
  if (RETRYABLE_NET_ERRORS.indexOf(err.code) !== -1) return true;
  return /socket hang up|read ECONNRESET|before secure TLS/i.test(err.message || '');
}

// Executa UMA tentativa de requisição HTTP/HTTPS nativa.
// `responseStarted` indica se o servidor já começou a responder - usado para
// decidir se é seguro repetir a requisição.
function performRequest(options, postData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'http:' ? http : https;
    const postPayload = postData ? JSON.stringify(postData) : null;

    // Clonar os headers para que uma retentativa não herde Content-Length antigo
    const requestOptions = Object.assign({}, options, {
      headers: Object.assign({}, options.headers),
      // agent: false => socket novo e exclusivo por requisição (sem keep-alive).
      // É isto que elimina o erro intermitente "socket hang up".
      agent: false
    });

    if (postPayload) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(postPayload);
    }

    let responseStarted = false;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      err.responseStarted = responseStarted;
      reject(err);
    };

    const req = client.request(requestOptions, (res) => {
      responseStarted = true;
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('aborted', () => fail(new Error('Resposta interrompida pelo servidor (aborted).')));
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve({ data: JSON.parse(data), statusCode: res.statusCode });
        } catch (e) {
          resolve({ data, statusCode: res.statusCode });
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Tempo limite excedido ao falar com a Evolution API.'));
    });

    req.on('error', (e) => {
      console.error('[HTTP Request Error]:', requestOptions.method, requestOptions.path, '-', e.message);
      fail(e);
    });

    if (postPayload) {
      req.write(postPayload);
    }
    req.end();
  });
}

// Helper público: faz a requisição com retentativa automática em falhas de socket.
async function makeHttpsRequest(options, postData, config) {
  const timeoutMs = (config && config.timeoutMs) || 45000;
  const maxAttempts = (config && config.attempts) || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await performRequest(options, postData, timeoutMs);
    } catch (err) {
      lastError = err;
      // Se o servidor já começou a responder, repetir pode duplicar o efeito
      // colateral (ex.: mensagem enviada duas vezes). Nesse caso, aborta.
      if (err.responseStarted || !isRetryableNetworkError(err) || attempt === maxAttempts) {
        break;
      }
      console.warn(`[Evolution API] Falha de rede (${err.message}). Tentativa ${attempt + 1}/${maxAttempts}...`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw lastError;
}

// URL pública do painel da Evolution (o navegador do usuário precisa alcançá-la;
// EVOLUTION_API_URL costuma ser um endereço interno como 127.0.0.1:8090).
function getEvolutionManagerUrl() {
  const publicUrl = process.env.VITE_EVOLUTION_MANAGER_URL || process.env.EVOLUTION_MANAGER_URL;
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  return getEvolutionBaseUrl() + '/manager';
}

function getEvolutionBaseUrl() {
  let apiUrl = process.env.EVOLUTION_API_URL || 'https://eapi.mulinotech.com';
  if (apiUrl && !apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    apiUrl = 'https://' + apiUrl;
  }
  return apiUrl.replace(/\/+$/, '');
}

function getRequestOptions(method, path, hasBody = false) {
  const parsedUrl = url.parse(getEvolutionBaseUrl());
  const headers = {
    'apikey': process.env.EVOLUTION_API_KEY || '',
    'Accept': 'application/json',
    // Sem keep-alive: cada chamada usa um socket novo (ver performRequest).
    'Connection': 'close',
    'User-Agent': 'MusaCRM/1.0'
  };
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: (parsedUrl.pathname === '/' ? '' : parsedUrl.pathname) + path,
    method: method,
    headers: headers
  };
}

// Normaliza um número brasileiro para o formato aceito pelo WhatsApp (55 + DDD + número)
function normalizeWhatsappNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return digits;
}

function jidToNumber(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// Alguns endpoints da Evolution devolvem colunas JSON como string
function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

// Converte o corpo de uma mensagem do Baileys em texto legível
function describeMessageBody(body, fallback) {
  const m = body || {};
  const text = m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || '';
  if (text) return text;
  if (m.imageMessage) return '[Imagem]';
  if (m.audioMessage) return '[Áudio]';
  if (m.videoMessage) return '[Vídeo]';
  if (m.documentMessage) return `[Documento] ${m.documentMessage.fileName || ''}`.trim();
  if (m.stickerMessage) return '[Sticker]';
  if (m.locationMessage) return '[Localização]';
  if (m.contactMessage || m.contactsArrayMessage) return '[Contato]';
  if (m.reactionMessage) return `[Reação] ${m.reactionMessage.text || ''}`.trim();
  return fallback === undefined ? '[Mensagem não suportada]' : fallback;
}

// Cache curto do nome da instância ativa para evitar uma chamada extra
// (e um socket extra) em cada envio de mensagem.
let INSTANCE_NAME_CACHE = { name: null, at: 0 };
const INSTANCE_CACHE_TTL = 60 * 1000;

const EvolutionService = {
  isConfigured: function() {
    return !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
  },
  // Extrai a lista de instâncias em qualquer um dos formatos das versões 1.x / 2.x
  // A v2.3.7 retorna { value: [...], Count: N } enquanto versões anteriores retornam []
  normalizeInstances: function(raw) {
    // Suporte ao formato v2.3.x: { value: [...], Count: N }
    let arr = raw;
    if (raw && !Array.isArray(raw) && Array.isArray(raw.value)) {
      arr = raw.value;
    }
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      const inst = item.instance || item;
      const state = inst.connectionStatus || inst.status || inst.state || '';
      const owner = inst.ownerJid || inst.owner || inst.number || '';
      return {
        name: inst.name || inst.instanceName || '',
        status: state === 'open' ? 'open' : (state === 'connecting' ? 'connecting' : 'close'),
        number: jidToNumber(owner),
        profileName: inst.profileName || inst.profileStatus || ''
      };
    }).filter(i => !!i.name);
  },
  listInstances: async function() {
    if (!this.isConfigured()) return SIMULATED_INSTANCES;
    // Evolution API v2 expõe /instance/fetchInstances (o antigo /instance/list
    // retornava 404 e deixava a lista de instâncias sempre vazia no painel).
    const endpoints = ['/instance/fetchInstances', '/instance/list'];
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await makeHttpsRequest(getRequestOptions('GET', endpoint));
        if (response.statusCode === 404) continue;
        const list = this.normalizeInstances(response.data);
        if (list.length > 0) return list;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) console.error('[Evolution API] Erro ao listar instancias:', lastError.message);
    return [];
  },
  connectionState: async function(instanceName) {
    if (!this.isConfigured()) {
      const inst = SIMULATED_INSTANCES.find(i => i.name === instanceName);
      return { instance: instanceName, state: inst ? inst.status : 'close' };
    }
    const response = await makeHttpsRequest(getRequestOptions('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`));
    const state = response.data?.instance?.state || response.data?.state || 'close';
    return { instance: instanceName, state };
  },
  createInstance: async function(name) {
    const formattedName = name.trim().replace(/\s+/g, '_');
    if (!this.isConfigured()) {
      if (SIMULATED_INSTANCES.some(i => i.name === formattedName)) {
        throw new Error('Instancia com este nome ja existe.');
      }
      const newInst = { name: formattedName, status: 'connecting' };
      SIMULATED_INSTANCES.push(newInst);
      return newInst;
    }
    const options = getRequestOptions('POST', '/instance/create', true);
    const postData = {
      instanceName: formattedName,
      token: '',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS'
    };
    const response = await makeHttpsRequest(options, postData);
    if (response.statusCode >= 400) {
      throw new Error(this.describeApiError(response));
    }
    const data = response.data?.instance || response.data;
    return { name: data.instanceName || formattedName, status: 'connecting' };
  },
  connectInstance: async function(name) {
    if (!this.isConfigured()) {
      const inst = SIMULATED_INSTANCES.find(i => i.name === name);
      if (!inst) throw new Error('Instancia nao encontrada.');
      const qrcodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://demo-musa.mulinotech.com/scan/${name}&color=4A3C35&bgcolor=FAF7F5`;
      inst.qrcode = qrcodeUrl;
      return { qrcode: qrcodeUrl };
    }
    const options = getRequestOptions('GET', `/instance/connect/${encodeURIComponent(name)}`);
    const response = await makeHttpsRequest(options);
    if (response.statusCode >= 400) {
      throw new Error(this.describeApiError(response));
    }
    // v2 devolve { pairingCode, code, base64 } - o <img> do painel precisa do base64
    const base64 = response.data?.base64 || response.data?.qrcode?.base64 || '';
    const code = response.data?.code || response.data?.qrcode?.code || '';
    let qrcode = '';
    if (base64) {
      qrcode = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    } else if (code) {
      // Sem base64: gerar a imagem a partir do payload textual do QR
      qrcode = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(code)}`;
    }
    return { qrcode, pairingCode: response.data?.pairingCode || '' };
  },
  // Extrai a mensagem de erro real devolvida pela Evolution API
  describeApiError: function(response) {
    const body = response && response.data;
    if (body && typeof body === 'object') {
      const raw = body.response?.message || body.message || body.error;
      if (Array.isArray(raw)) return raw.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join(' | ');
      if (typeof raw === 'string') return raw;
      if (raw) return JSON.stringify(raw);
    }
    if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
    return `A Evolution API respondeu com o status ${response?.statusCode}.`;
  },
  sendText: async function(instanceName, number, message) {
    const cleanNumber = normalizeWhatsappNumber(number);
    if (!cleanNumber) throw new Error('Número de WhatsApp inválido.');
    if (!this.isConfigured()) {
      console.log(`[SIMULADO WhatsApp] Mensagem enviada para ${cleanNumber}: ${message}`);
      return { status: 'success', simulated: true };
    }

    const instance = instanceName || await this.getInstanceName();

    // Evolution API v2 usa /message/sendText/{instanceName} com { number, text }
    const options = getRequestOptions('POST', `/message/sendText/${encodeURIComponent(instance)}`, true);
    let response = await makeHttpsRequest(options, { number: cleanNumber, text: message, delay: 800 });

    // Se a v2 falhar por 404/400, tentar o formato legado v1
    if (response.statusCode === 404 || response.statusCode === 400) {
      const fallbackOptions = getRequestOptions('POST', `/message/sendText/${encodeURIComponent(instance)}`, true);
      const fallbackData = {
        number: cleanNumber,
        options: { delay: 800, presence: 'composing' },
        textMessage: { text: message }
      };
      const fallbackResponse = await makeHttpsRequest(fallbackOptions, fallbackData);
      if (fallbackResponse.statusCode >= 200 && fallbackResponse.statusCode < 300) {
        return fallbackResponse.data;
      }
      response = response.statusCode === 404 ? fallbackResponse : response;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    return response.data;
  },
  // Lista as conversas existentes na instância (WhatsApp real)
  findChats: async function(instanceName) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const options = getRequestOptions('POST', `/chat/findChats/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, {});
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] direto
    const body = response.data;
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.chats || body?.records || [];
    }
    return raw.map((chat) => {
      const jid = chat.remoteJid || chat.id || '';
      const last = chat.lastMessage || {};
      // lastMessage.message pode vir como STRING JSON ou objeto
      const lastMsgBody = parseMaybeJson(last.message) || (typeof last.message === 'object' ? last.message : {}) || {};
      return {
        jid,
        number: jidToNumber(jid),
        name: chat.pushName || chat.name || jidToNumber(jid),
        profilePicUrl: chat.profilePicUrl || chat.profilePictureUrl || '',
        unreadCount: chat.unreadCount || 0,
        lastMessage: describeMessageBody(lastMsgBody, ''),
        updatedAt: chat.updatedAt || (last.messageTimestamp ? new Date(Number(last.messageTimestamp) * 1000).toISOString() : null)
      };
    })
      // Somente conversas 1:1 endereçadas por telefone. As entradas "@lid" (novo
      // endereçamento do WhatsApp) não expõem número e não permitem responder,
      // e "@g.us" são grupos.
      .filter(c => String(c.jid).endsWith('@s.whatsapp.net') && c.number)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  },
  // Lista os contatos salvos na instância
  findContacts: async function(instanceName) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const options = getRequestOptions('POST', `/chat/findContacts/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, {});
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] direto
    const body = response.data;
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.contacts || body?.records || [];
    }
    return raw.map((contact) => {
      const jid = contact.remoteJid || contact.id || '';
      return {
        jid,
        number: jidToNumber(jid),
        name: contact.pushName || contact.name || contact.verifiedName || jidToNumber(jid),
        profilePicUrl: contact.profilePicUrl || contact.profilePictureUrl || '',
        isGroup: String(jid).includes('@g.us')
      };
    }).filter(c => c.jid && c.number && !c.isGroup);
  },
  // Normaliza um registro de mensagem da Evolution
  mapMessageRecord: function(msg) {
    const key = parseMaybeJson(msg.key) || {};
    const body = parseMaybeJson(msg.message) || {};
    const ts = Number(msg.messageTimestamp || 0);
    return {
      id: key.id || String(msg.id || Math.random()),
      remoteJid: key.remoteJid || '',
      direction: key.fromMe ? 'out' : 'in',
      content: describeMessageBody(body),
      pushName: msg.pushName || '',
      createdAt: ts ? new Date(ts * 1000).toISOString() : (msg.createdAt || new Date().toISOString()),
      source: 'whatsapp'
    };
  },
  requestMessages: async function(instance, payload) {
    const options = getRequestOptions('POST', `/chat/findMessages/${encodeURIComponent(instance)}`, true);
    const response = await makeHttpsRequest(options, payload);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(this.describeApiError(response));
    }
    const body = response.data;
    // v2.3.7 retorna { value: [...], Count: N }; versões antigas retornam [] ou { records: [] }
    let raw;
    if (Array.isArray(body)) {
      raw = body;
    } else if (body && Array.isArray(body.value)) {
      raw = body.value;
    } else {
      raw = body?.messages?.records || body?.records || [];
    }
    return Array.isArray(raw) ? raw : [];
  },
  // Histórico de mensagens de uma conversa.
  // Observação: neste deployment (Evolution + MySQL) o filtro `where.key.remoteJid`
  // do endpoint /chat/findMessages não funciona (limitação do filtro JSON do
  // Prisma no MySQL) e devolve sempre 0 registros. Por isso, quando o filtro vem
  // vazio, varremos as páginas mais recentes e filtramos aqui pelo remoteJid.
  findMessages: async function(instanceName, remoteJid, limit) {
    if (!this.isConfigured()) return [];
    const instance = instanceName || await this.getInstanceName();
    const max = limit || 60;

    try {
      const filtered = await this.requestMessages(instance, { where: { key: { remoteJid } }, limit: max, offset: max });
      const mapped = filtered.map(m => this.mapMessageRecord(m)).filter(m => !remoteJid || m.remoteJid === remoteJid);
      if (mapped.length > 0) {
        return mapped.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-max);
      }
    } catch (e) {
      console.warn('[Evolution API] findMessages filtrado falhou:', e.message);
    }

    // Fallback limitado: 2 páginas de 300 mensagens mais recentes da instância
    const collected = [];
    for (let page = 1; page <= 2; page++) {
      const records = await this.requestMessages(instance, { page, offset: 300 });
      if (records.length === 0) break;
      for (const rec of records) {
        const mapped = this.mapMessageRecord(rec);
        if (mapped.remoteJid === remoteJid) collected.push(mapped);
      }
      if (collected.length >= max) break;
    }
    return collected.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-max);
  },
  getInstanceName: async function(forceRefresh) {
    const envName = process.env.EVOLUTION_INSTANCE_NAME;
    if (envName) return envName;

    const now = Date.now();
    if (!forceRefresh && INSTANCE_NAME_CACHE.name && (now - INSTANCE_NAME_CACHE.at) < INSTANCE_CACHE_TTL) {
      return INSTANCE_NAME_CACHE.name;
    }

    try {
      const list = await this.listInstances();
      if (list && list.length > 0) {
        // Preferir sempre uma instância realmente conectada
        const connected = list.find(i => i.status === 'open') || list[0];
        INSTANCE_NAME_CACHE = { name: connected.name, at: now };
        return connected.name;
      }
    } catch (e) {
      console.error('Erro ao listar instancias:', e.message);
    }
    return INSTANCE_NAME_CACHE.name || 'evolution';
  }
};

// Envia uma mensagem de texto e, em caso de falha, explica o motivo real
// (o mais comum é a instância desconectada do WhatsApp).
async function sendWhatsappText(number, content) {
  const instance = await EvolutionService.getInstanceName();
  try {
    return await EvolutionService.sendText(instance, number, content);
  } catch (err) {
    let state = null;
    try {
      state = (await EvolutionService.connectionState(instance)).state;
    } catch (e) {
      // Sem diagnóstico extra: mantém o erro original
    }
    if (state && state !== 'open') {
      throw new Error(`a instância "${instance}" está desconectada do WhatsApp (estado: ${state}). Leia o QR Code novamente na aba "Integração WhatsApp".`);
    }
    throw err;
  }
}

// 5. Configuração Geral CRM
app.get('/api/config', function(req, res) {
  const geminiKey = process.env.GEMINI_API_KEY || '';
  res.json({
    hasGemini: !!geminiKey,
    hasEvolution: EvolutionService.isConfigured()
  });
});

// 5.1. Rota de Login / Autenticação (Multi-Usuários e Vendedores)
app.post('/api/auth/login', async function(req, res) {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Senha é obrigatória.' });
  }

  const adminPassword = process.env.VITE_ADMIN_PASSWORD || '';
  if (password === adminPassword) {
    return res.json({ 
      role: 'admin',
      salespersonName: 'Dra. Musa (Proprietária)'
    });
  }

  // Senha Master Adicional: gestor(a) secundário(a) da clínica
  const adminPassword2 = process.env.ADMIN_PASSWORD_2 || '';
  if (adminPassword2 && password === adminPassword2) {
    return res.json({ 
      role: 'admin',
      salespersonName: 'Direção / Master'
    });
  }

  try {
    const [rows] = await pool.query('SELECT id, name, role FROM salespeople WHERE password = ? AND status = "active"', [password]);
    if (rows.length > 0) {
      const salesperson = rows[0];
      return res.json({ 
        role: 'salesperson', 
        salespersonId: salesperson.id,
        salespersonName: salesperson.name
      });
    }
  } catch (e) {
    console.error('Erro ao verificar login de vendedor:', e);
  }

  return res.status(401).json({ error: 'Senha incorreta. Por favor, tente novamente.' });
});

// Rotas Inteligentes com IA Gemini
app.post('/api/gemini/analyze-skin', async function(req, res) {
  const { anamneseText, imageBase64, clientName } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    const defaultResponse = `
## LAUDO DE AVALIAÇÃO FACIAL DIGITAL - CLÍNICA PREMIUM

**Paciente:** ${clientName || 'Paciente Premium'}
**Data da Avaliação:** ${new Date().toLocaleDateString('pt-BR')}
**Dermatologista / Especialista em Estética Avançada:** Dra. Musa
`;
    return res.json({ report: defaultResponse });
  }

  try {
    const prompt = `Você é um Dermatologista e Especialista em Estética Avançada atuando em uma clínica premium.
Paciente: ${clientName || 'Paciente'}
Data: ${new Date().toLocaleDateString('pt-BR')}

Baseado nas seguintes anotações de anamnese do paciente: "${anamneseText}"
(E na foto fornecida, se houver).

Elabore um LAUDO DE AVALIAÇÃO FACIAL DIGITAL premium. 
O laudo deve conter:
1. ANÁLISE DERMATOLÓGICA TÉCNICA (use termos técnicos adequados)
2. PLANO DE TRATAMENTO SUGERIDO (ex: Lavien, Ultraformer MPT, Bioestimulador)
3. RECOMENDAÇÕES HOME CARE

Responda apenas com o texto do laudo, bem formatado e profissional.`;

    const parts = [{ text: prompt }];

    if (imageBase64) {
      const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        parts.push({
          inline_data: {
            mime_type: matches[1],
            data: matches[2]
          }
        });
      }
    }

    const payload = JSON.stringify({ contents: [{ parts }] });
    const u = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`);

    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const reqGemini = https.request(options, (resGemini) => {
      let responseBody = '';
      resGemini.on('data', (chunk) => responseBody += chunk);
      resGemini.on('end', () => {
        try {
          const data = JSON.parse(responseBody);
          if (data.error) {
            return res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: data.error.message });
          }
          const report = data.candidates?.[0]?.content?.parts?.[0]?.text || "Não foi possível gerar a resposta.";
          res.json({ report });
        } catch (e) {
          res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: e.message });
        }
      });
    });

    reqGemini.on('error', (e) => {
      res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: e.message });
    });

    reqGemini.write(payload);
    reqGemini.end();

  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar o laudo via IA', details: error.message });
  }
});

app.post('/api/gemini/suggest-reply', async function(req, res) {
  const { clientId } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    return res.status(400).json({ error: 'Chave API do Gemini não configurada.' });
  }

  try {
    const [interactions] = await pool.query('SELECT content, direction FROM interactions WHERE client_id = ? ORDER BY created_at ASC LIMIT 10', [clientId]);
    let historicoTexto = interactions.map(i => `${i.direction === 'in' ? 'Cliente' : 'Clínica'}: ${i.content}`).join('\n');
    if (!historicoTexto) historicoTexto = "(Nenhum histórico de mensagens ainda)";

    const prompt = `Você é um Concierge de uma Clínica de Estética Premium chamada Dra. Musa Estética de Elite.
Seu objetivo é sugerir uma ÚNICA mensagem de resposta (curta, humana, persuasiva e elegante) para enviar ao cliente no WhatsApp.
O foco é acolher o cliente e tentar agendar uma avaliação estética presencial.

Histórico da conversa:
${historicoTexto}

Escreva apenas a mensagem sugerida. Evite ser robótico. Use emojis se apropriado (✨, 🤍, etc).`;

    const payload = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const u = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`);
    
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const reqGemini = https.request(options, (resGemini) => {
      let responseBody = '';
      resGemini.on('data', (chunk) => responseBody += chunk);
      resGemini.on('end', () => {
        try {
          const data = JSON.parse(responseBody);
          if (data.error) {
            return res.status(500).json({ error: 'Erro na IA', details: data.error.message });
          }
          const suggestedMessage = data.candidates?.[0]?.content?.parts?.[0]?.text || "Olá! Como posso ajudar?";
          res.json({ suggestion: suggestedMessage.trim() });
        } catch (e) {
          res.status(500).json({ error: 'Erro ao gerar resposta', details: e.message });
        }
      });
    });

    reqGemini.on('error', (e) => {
      res.status(500).json({ error: 'Erro de conexao com a IA', details: e.message });
    });

    reqGemini.write(payload);
    reqGemini.end();

  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar sugestão via IA', details: error.message });
  }
});

// 6. Listar Clientes
app.get('/api/clients', async function(req, res) {
  const userRole = req.headers['x-user-role'];
  const salespersonId = req.headers['x-salesperson-id'];

  try {
    if (userRole === 'salesperson' && salespersonId) {
      const query = `
        SELECT DISTINCT c.id, c.name, c.email, c.phone, c.anamnese, c.image_base64 as imageBase64, c.laudo, c.created_at as createdAt, c.updated_at as updatedAt 
        FROM clients c
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "")
        WHERE l.salesperson_id = ?
        ORDER BY c.name ASC
      `;
      const [rows] = await pool.query(query, [salespersonId]);
      return res.json(rows);
    }
    const [rows] = await pool.query('SELECT id, name, email, phone, anamnese, image_base64 as imageBase64, laudo, created_at as createdAt, updated_at as updatedAt FROM clients ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar clientes', details: error.message });
  }
});

// 7. Criar Cliente
app.post('/api/clients', async function(req, res) {
  const { name, email, phone } = req.body;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema';
  if (!name || !phone) {
    return res.status(400).json({ error: 'Nome e telefone sao obrigatorios.' });
  }
  const id = 'c_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO clients (id, name, email, phone) VALUES (?, ?, ?, ?)', [id, name, email || '', phone]);
    await logSystemEvent(
      'CLIENT_CREATE',
      `Novo paciente cadastrado: "${name}" (${phone})`,
      authorName,
      req.ip
    );
    res.status(201).json({ id, name, email: email || '', phone });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar cliente', details: error.message });
  }
});

// 8. Atualizar Cliente
app.patch('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const { name, email, phone, anamnese, image_base64, laudo } = req.body;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema';
  
  // mysql2 não aceita undefined, precisa ser null
  const pName = name === undefined ? null : name;
  const pEmail = email === undefined ? null : email;
  const pPhone = phone === undefined ? null : phone;
  const pAnamnese = anamnese === undefined ? null : anamnese;
  const pImageBase64 = image_base64 === undefined ? null : image_base64;
  const pLaudo = laudo === undefined ? null : laudo;

  try {
    await pool.query(
      'UPDATE clients SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone), anamnese = COALESCE(?, anamnese), image_base64 = COALESCE(?, image_base64), laudo = COALESCE(?, laudo) WHERE id = ?', 
      [pName, pEmail, pPhone, pAnamnese, pImageBase64, pLaudo, id]
    );

    let desc = `Ficha do paciente ID ${id} atualizada`;
    if (anamnese !== undefined) desc = `Anamnese do paciente ID ${id} atualizada`;
    if (laudo !== undefined) desc = `Laudo Digital do paciente ID ${id} atualizado`;

    await logSystemEvent(
      'CLIENT_UPDATE',
      desc,
      authorName,
      req.ip
    );

    res.json({ message: 'Cliente atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar cliente', details: error.message });
  }
});

// 8.1. Excluir Cliente
app.delete('/api/clients/:id', async function(req, res) {
  const { id } = req.params;
  const authorName = req.headers['x-salesperson-name'] || req.headers['x-user-role'] || 'Sistema';
  try {
    await pool.query('DELETE FROM clients WHERE id = ?', [id]);
    await logSystemEvent(
      'CLIENT_DELETE',
      `Paciente ID ${id} foi excluído do sistema`,
      authorName,
      req.ip
    );
    res.json({ message: 'Cliente excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cliente', details: error.message });
  }
});

// 9. Listar Tratamentos
app.get('/api/treatments', async function(req, res) {
  const userRole = req.headers['x-user-role'];
  const salespersonId = req.headers['x-salesperson-id'];

  try {
    let rows;
    if (userRole === 'salesperson' && salespersonId) {
      const query = `
        SELECT t.id, t.client_id as clientId, t.procedure_name as procedureName, t.session_date as sessionDate, t.notes, t.next_session_date as nextSessionDate, t.price, t.total_sessions as totalSessions, t.completed_sessions as completedSessions 
        FROM treatments t
        INNER JOIN clients c ON t.client_id = c.id
        INNER JOIN leads l ON REPLACE(l.whatsapp, "+", "") = REPLACE(c.phone, "+", "")
        WHERE l.salesperson_id = ?
        ORDER BY t.session_date DESC
      `;
      const [result] = await pool.query(query, [salespersonId]);
      rows = result;
    } else {
      const [result] = await pool.query('SELECT id, client_id as clientId, procedure_name as procedureName, session_date as sessionDate, notes, next_session_date as nextSessionDate, price, total_sessions as totalSessions, completed_sessions as completedSessions FROM treatments ORDER BY session_date DESC');
      rows = result;
    }

    // Mapear procedureName para procedure para bater com o layout React anterior
    const mapped = rows.map(r => ({
      id: r.id,
      clientId: r.clientId,
      procedure: r.procedureName,
      sessionDate: r.sessionDate,
      notes: r.notes,
      nextSessionDate: r.nextSessionDate,
      price: r.price !== null ? Number(r.price) : null,
      totalSessions: r.totalSessions,
      completedSessions: r.completedSessions
    }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar tratamentos', details: error.message });
  }
});

// 10. Criar Tratamento
app.post('/api/treatments', async function(req, res) {
  const { clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions, completedSessions } = req.body;
  if (!clientId || !procedure || !sessionDate) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 't_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO treatments (id, client_id, procedure_name, session_date, notes, next_session_date, price, total_sessions, completed_sessions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, clientId, procedure, new Date(sessionDate), notes || '', nextSessionDate ? new Date(nextSessionDate) : null, price !== undefined ? price : null, totalSessions || 1, completedSessions || 1
    ]);
    res.status(201).json({ id, clientId, procedure, sessionDate, notes, nextSessionDate, price, totalSessions: totalSessions || 1, completedSessions: completedSessions || 1 });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar tratamento', details: error.message });
  }
});

// 10.1 Atualizar Tratamento
app.patch('/api/treatments/:id', async function(req, res) {
  const { id } = req.params;
  const { procedure, sessionDate, notes, price, totalSessions, completedSessions } = req.body;
  try {
    await pool.query('UPDATE treatments SET procedure_name = COALESCE(?, procedure_name), session_date = COALESCE(?, session_date), notes = COALESCE(?, notes), price = COALESCE(?, price), total_sessions = COALESCE(?, total_sessions), completed_sessions = COALESCE(?, completed_sessions) WHERE id = ?', [procedure, sessionDate ? new Date(sessionDate) : null, notes, price !== undefined ? price : null, totalSessions, completedSessions, id]);
    res.json({ message: 'Tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tratamento', details: error.message });
  }
});

// 10.2. Listar Planos de Tratamento
app.get('/api/treatment-plans', async function(req, res) {
  try {
    const [plans] = await pool.query('SELECT id, client_id as clientId, title, clinical_objective as clinicalObjective, total_sessions as totalSessions, periodicity, status, start_date as startDate, estimated_end_date as estimatedEndDate, created_at as createdAt FROM treatment_plans ORDER BY created_at DESC');
    const [sessions] = await pool.query('SELECT id, plan_id as planId, session_number as sessionNumber, session_type as sessionType, status, equipments_used as equipmentsUsed, supplies_applied as suppliesApplied, professional_in_charge as professionalInCharge, clinical_evolution as clinicalEvolution, media_urls as mediaUrls, session_date as sessionDate, next_session_date as nextSessionDate, price, created_at as createdAt FROM treatment_sessions ORDER BY session_number ASC');
    
    const plansWithSessions = plans.map(plan => ({
      ...plan,
      sessions: sessions.filter(s => s.planId === plan.id).map(s => ({
        ...s,
        price: s.price !== null ? Number(s.price) : null
      }))
    }));
    res.json(plansWithSessions);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar planos de tratamento', details: error.message });
  }
});

// 10.3. Criar Plano de Tratamento
app.post('/api/treatment-plans', async function(req, res) {
  const { clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate, sessionPrice } = req.body;
  if (!clientId || !title || !totalSessions) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes (clientId, title, totalSessions).' });
  }
  const id = 'p_' + Math.random().toString(36).substring(2, 9);
  try {
    await pool.query('INSERT INTO treatment_plans (id, client_id, title, clinical_objective, total_sessions, periodicity, status, start_date, estimated_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, clientId, title, clinicalObjective || '', totalSessions, periodicity || '', status || 'ATIVO', startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null
    ]);
    
    for (let i = 1; i <= totalSessions; i++) {
      const sessId = 's_sess_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, status, price) VALUES (?, ?, ?, ?, ?, ?)', [
        sessId, id, i, 'SESSAO_TRATAMENTO', 'PENDENTE', sessionPrice !== undefined && sessionPrice !== null ? sessionPrice : null
      ]);
    }
    res.status(201).json({ id, clientId, title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar plano de tratamento', details: error.message });
  }
});

// 10.4. Atualizar Plano de Tratamento
app.patch('/api/treatment-plans/:id', async function(req, res) {
  const { id } = req.params;
  const { title, clinicalObjective, totalSessions, periodicity, status, startDate, estimatedEndDate } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_plans SET title = COALESCE(?, title), clinical_objective = COALESCE(?, clinical_objective), total_sessions = COALESCE(?, total_sessions), periodicity = COALESCE(?, periodicity), status = COALESCE(?, status), start_date = COALESCE(?, start_date), estimated_end_date = COALESCE(?, estimated_end_date) WHERE id = ?',
      [title || null, clinicalObjective || null, totalSessions || null, periodicity || null, status || null, startDate ? new Date(startDate) : null, estimatedEndDate ? new Date(estimatedEndDate) : null, id]
    );
    res.json({ message: 'Plano de tratamento atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar plano de tratamento', details: error.message });
  }
});

// 10.5. Excluir Plano de Tratamento
app.delete('/api/treatment-plans/:id', async function(req, res) {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM treatment_plans WHERE id = ?', [id]);
    res.json({ message: 'Plano de tratamento excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir plano de tratamento', details: error.message });
  }
});

// 10.6. Atualizar Sessão de Tratamento
app.patch('/api/treatment-sessions/:id', async function(req, res) {
  const { id } = req.params;
  const { sessionType, status, equipmentsUsed, suppliesApplied, professionalInCharge, clinicalEvolution, mediaUrls, sessionDate, nextSessionDate, price } = req.body;
  try {
    await pool.query(
      'UPDATE treatment_sessions SET session_type = COALESCE(?, session_type), status = COALESCE(?, status), equipments_used = COALESCE(?, equipments_used), supplies_applied = COALESCE(?, supplies_applied), professional_in_charge = COALESCE(?, professional_in_charge), clinical_evolution = COALESCE(?, clinical_evolution), media_urls = COALESCE(?, media_urls), session_date = COALESCE(?, session_date), next_session_date = COALESCE(?, next_session_date), price = COALESCE(?, price) WHERE id = ?',
      [
        sessionType || null,
        status || null,
        equipmentsUsed || null,
        suppliesApplied || null,
        professionalInCharge || null,
        clinicalEvolution || null,
        mediaUrls || null,
        sessionDate ? new Date(sessionDate) : null,
        nextSessionDate ? new Date(nextSessionDate) : null,
        price !== undefined ? price : null,
        id
      ]
    );
    res.json({ message: 'Sessão atualizada com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar sessão', details: error.message });
  }
});

// 11. Listar Interações
app.get('/api/interactions', async function(req, res) {
  try {
    const [rows] = await pool.query('SELECT id, client_id as clientId, type, content, direction, created_at as createdAt FROM interactions ORDER BY created_at ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar interacoes', details: error.message });
  }
});

// 12. Criar Interação
app.post('/api/interactions', async function(req, res) {
  const { clientId, type, content, direction } = req.body;
  if (!clientId || !content) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes.' });
  }
  const id = 'i_' + Math.random().toString(36).substring(2, 9);
  try {
    let whatsappSent = true;
    let whatsappError = null;

    // Tentativa de envio real se for saída de WhatsApp
    if (direction === 'out' && type === 'whatsapp') {
      const [leads] = await pool.query('SELECT whatsapp FROM leads WHERE id = ?', [clientId]);
      const [clients] = await pool.query('SELECT phone FROM clients WHERE id = ?', [clientId]);
      const targetPhone = (leads[0] && leads[0].whatsapp) || (clients[0] && clients[0].phone);
      if (targetPhone) {
        try {
          await sendWhatsappText(targetPhone, content);
        } catch (sendErr) {
          console.error('[WhatsApp Send Error]:', sendErr);
          whatsappSent = false;
          whatsappError = sendErr.message || 'Falha ao conectar com o serviço de WhatsApp';
        }
      } else {
        whatsappSent = false;
        whatsappError = 'Contato sem número de WhatsApp cadastrado.';
      }
    }

    await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
      id, clientId, type || 'whatsapp', content, direction || 'out'
    ]);

    res.status(201).json({ id, clientId, type, content, direction, whatsappSent, whatsappError });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar interacao', details: error.message });
  }
});

// 13. Evolution API Instance Manager
app.get('/api/evolution/instances', async function(req, res) {
  try {
    const list = await EvolutionService.listInstances();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/evolution/instances', async function(req, res) {
  const { instanceName } = req.body;
  try {
    const created = await EvolutionService.createInstance(instanceName);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/evolution/instances/connect/:name', async function(req, res) {
  try {
    const connection = await EvolutionService.connectInstance(req.params.name);
    res.json(connection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 13.1. Status resumido da integração (usado pelo Gerenciador WhatsApp nativo)
app.get('/api/evolution/status', async function(req, res) {
  try {
    const configured = EvolutionService.isConfigured();
    if (!configured) {
      return res.json({ configured: false, instance: null, state: 'close', managerUrl: getEvolutionManagerUrl() });
    }
    const instance = await EvolutionService.getInstanceName(req.query.refresh === '1');
    let state = 'close';
    try {
      const st = await EvolutionService.connectionState(instance);
      state = st.state;
    } catch (e) {
      state = 'close';
    }
    res.json({ configured: true, instance, state, managerUrl: getEvolutionManagerUrl() });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao consultar status da Evolution API', details: error.message });
  }
});

// 13.2. Conversas reais da instância do WhatsApp
app.get('/api/evolution/chats', async function(req, res) {
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    const chats = await EvolutionService.findChats(instance);
    res.json(chats);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar as conversas do WhatsApp.', details: error.message });
  }
});

// 13.3. Contatos salvos na instância do WhatsApp
app.get('/api/evolution/contacts', async function(req, res) {
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    const contacts = await EvolutionService.findContacts(instance);
    res.json(contacts);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível carregar os contatos do WhatsApp.', details: error.message });
  }
});

// 13.4. Histórico de mensagens de uma conversa
app.get('/api/evolution/messages', async function(req, res) {
  const rawJid = req.query.jid || '';
  const number = normalizeWhatsappNumber(req.query.number || rawJid);
  const remoteJid = rawJid.includes('@') ? rawJid : (number ? `${number}@s.whatsapp.net` : '');
  if (!remoteJid) {
    return res.status(400).json({ error: 'Informe o contato (jid ou number).' });
  }
  const limit = Number(req.query.limit) || 60;

  // 1) Histórico registrado no próprio CRM (sempre disponível)
  let crmMessages = [];
  if (number) {
    try {
      const last8 = number.slice(-8);
      const [rows] = await pool.query(
        `SELECT i.id, i.content, i.direction, i.type, i.created_at AS createdAt
           FROM interactions i
          WHERE i.client_id IN (
                  SELECT id FROM leads
                   WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                  UNION
                  SELECT id FROM clients
                   WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ?
                )
          ORDER BY i.created_at ASC
          LIMIT ?`,
        [last8, last8, limit]
      );
      crmMessages = rows.map(r => ({
        id: `crm_${r.id}`,
        direction: r.direction,
        content: r.content,
        createdAt: new Date(r.createdAt).toISOString(),
        source: 'crm'
      }));
    } catch (dbErr) {
      console.error('[Evolution Messages] Falha ao ler histórico do CRM:', dbErr.message);
    }
  }

  // 2) Histórico direto do WhatsApp (quando a Evolution conseguir devolver)
  let waMessages = [];
  let waError = null;
  try {
    const instance = req.query.instance || await EvolutionService.getInstanceName();
    waMessages = await EvolutionService.findMessages(instance, remoteJid, limit);
  } catch (error) {
    waError = error.message;
    console.warn('[Evolution Messages] WhatsApp indisponível:', error.message);
  }

  // Mesclar as duas fontes, removendo duplicidades (mesmo texto no mesmo minuto)
  const seen = new Set();
  const merged = [];
  for (const msg of [...waMessages, ...crmMessages]) {
    const bucket = `${msg.direction}|${(msg.content || '').trim()}|${String(msg.createdAt).slice(0, 16)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    merged.push(msg);
  }
  merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (merged.length === 0 && waError) {
    return res.status(502).json({ error: 'Não foi possível carregar o histórico da conversa.', details: waError });
  }
  res.json(merged.slice(-limit));
});

// 13.5. Envio direto pelo Gerenciador WhatsApp (também registra no CRM)
app.post('/api/evolution/send', async function(req, res) {
  const { number, text, name, jid } = req.body || {};
  const targetNumber = normalizeWhatsappNumber(number || jidToNumber(jid));

  if (!targetNumber) {
    return res.status(400).json({ error: 'Informe um número de WhatsApp válido.' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
  }

  try {
    const result = await sendWhatsappText(targetNumber, String(text));

    // Espelhar a mensagem no CRM: localizar (ou criar) o lead correspondente
    let clientId = null;
    try {
      const last8 = targetNumber.slice(-8);
      const [clients] = await pool.query(
        "SELECT id FROM clients WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );
      const [leads] = await pool.query(
        "SELECT id FROM leads WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), 8) = ? LIMIT 1",
        [last8]
      );

      if (clients.length > 0) {
        clientId = clients[0].id;
      } else if (leads.length > 0) {
        clientId = leads[0].id;
      } else {
        clientId = 'l_' + Math.random().toString(36).substring(2, 9);
        await pool.query(
          'INSERT INTO leads (id, name, whatsapp, treatment, message, source, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [clientId, (name && String(name).trim()) || `WhatsApp ${targetNumber.slice(-4)}`, targetNumber, 'Atendimento Geral', 'Conversa iniciada pelo Gerenciador WhatsApp.', 'site', 'contatado']
        );
      }

      await pool.query(
        'INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)',
        ['i_' + Math.random().toString(36).substring(2, 9), clientId, 'whatsapp', String(text), 'out']
      );
    } catch (dbErr) {
      console.error('[Evolution Send] Mensagem enviada, mas falhou o registro no CRM:', dbErr.message);
    }

    res.json({ success: true, number: targetNumber, clientId, result });
  } catch (error) {
    console.error('[Evolution Send Error]:', error.message);
    res.status(502).json({ error: 'Falha ao enviar a mensagem pelo WhatsApp.', details: error.message });
  }
});

app.post('/api/evolution/instances/simulate-connect', function(req, res) {
  const { instanceName, number } = req.body;
  const inst = SIMULATED_INSTANCES.find(i => i.name === instanceName);
  if (inst) {
    inst.status = 'open';
    inst.number = number || '5511900000000';
    inst.qrcode = undefined;
  }
  res.json({ success: true });
});

// 14. Webhook WhatsApp Evolution
app.post('/api/webhook/whatsapp', async function(req, res) {
  const payload = req.body;
  const messageData = payload.data || payload;
  const key = messageData.key;
  if (key && key.fromMe) {
    return res.json({ status: 'ignored' });
  }
  const senderJid = key?.remoteJid || '';
  const phone = senderJid.split('@')[0];
  const contactName = messageData.pushName || 'Contato WhatsApp';
  
  const messageType = messageData.messageType || 'conversation';
  let content = '';
  if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
    content = messageData.message?.conversation || messageData.message?.extendedTextMessage?.text || '';
  } else if (messageType === 'imageMessage') {
    const caption = messageData.message?.imageMessage?.caption || '';
    content = caption ? `[Imagem]: ${caption}` : '[Imagem Recebida]';
  } else {
    return res.json({ status: 'unsupported' });
  }

  if (!phone) return res.status(400).json({ error: 'No phone' });

  try {
    // Buscar se cliente ou lead já existe
    let [clients] = await pool.query('SELECT id FROM clients WHERE REPLACE(phone, "+", "") = ?', [phone]);
    let [leads] = await pool.query('SELECT id FROM leads WHERE REPLACE(whatsapp, "+", "") = ?', [phone]);
    
    let targetId = '';
    if (clients.length > 0) {
      targetId = clients[0].id;
    } else if (leads.length > 0) {
      targetId = leads[0].id;
    } else {
      // Capturar como novo lead automaticamente
      targetId = 'l_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO leads (id, name, whatsapp, treatment, status) VALUES (?, ?, ?, ?, ?)', [
        targetId, contactName, phone, 'Geral', 'novo'
      ]);
      const welcome = `Seja muito bem-vinda à Dra. Musa Estética de Elite! ✨\n\nRecebemos sua mensagem por aqui e nosso concierge de beleza já está ciente de seu contato. Como podemos ajudar no seu dia de beleza e cuidados? 🌸`;
      // Uma falha no envio da saudação não deve derrubar o webhook (a mensagem
      // recebida precisa ser registrada de qualquer forma).
      try {
        await sendWhatsappText(phone, welcome);
      } catch (welcomeErr) {
        console.error('[Webhook] Falha ao enviar saudação automática:', welcomeErr.message);
      }

      const interactionId = 'i_' + Math.random().toString(36).substring(2, 9);
      await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
        interactionId, targetId, 'whatsapp', welcome, 'out'
      ]);
    }

    const newInteractionId = 'i_' + Math.random().toString(36).substring(2, 9);
    await pool.query('INSERT INTO interactions (id, client_id, type, content, direction) VALUES (?, ?, ?, ?, ?)', [
      newInteractionId, targetId, 'whatsapp', content, 'in'
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 15. PDF Report Generation Endpoint
app.post('/api/reports/generate', async function(req, res) {
  const { aba, periodo } = req.body;
  
  const now = new Date();
  const start = periodo?.inicio ? new Date(periodo.inicio) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = periodo?.fim ? new Date(periodo.fim) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  try {
    const tabName = String(aba).toUpperCase();
    
    if (tabName === 'DASHBOARD' || tabName === 'VISÃO GERAL') {
      // 1. Faturamento Total (treatment_sessions)
      const [sessionsFat] = await pool.query(
        'SELECT SUM(price) as total, COUNT(*) as count FROM treatment_sessions WHERE status = "REALIZADA" AND session_date BETWEEN ? AND ?',
        [start, end]
      );
      const faturamentoTotal = Number(sessionsFat[0]?.total || 0);
      const sessionsCount = Number(sessionsFat[0]?.count || 0);
      const ticketMedio = sessionsCount > 0 ? faturamentoTotal / sessionsCount : 0;

      // 2. Taxa de Conversão de Leads
      const [leadsConv] = await pool.query(
        'SELECT COUNT(*) as total, SUM(IF(status = "agendado", 1, 0)) as conv FROM leads WHERE date BETWEEN ? AND ?',
        [start, end]
      );
      const totalLeads = Number(leadsConv[0]?.total || 0);
      const convLeads = Number(leadsConv[0]?.conv || 0);
      const taxaConversao = totalLeads > 0 ? (convLeads / totalLeads) * 100 : 0;

      // 3. Pacientes Ativos
      const [plansAct] = await pool.query(
        'SELECT COUNT(DISTINCT client_id) as count FROM treatment_plans WHERE status = "ATIVO"'
      );
      const totalPacientesAtivos = Number(plansAct[0]?.count || 0);

      // 4. Top 3 Procedimentos
      const [topProcs] = await pool.query(
        'SELECT session_type as procedureName, SUM(price) as total FROM treatment_sessions WHERE status = "REALIZADA" AND session_date BETWEEN ? AND ? GROUP BY session_type ORDER BY total DESC LIMIT 3',
        [start, end]
      );

      res.json({
        aba: 'VISÃO GERAL',
        periodo: { inicio: start.toISOString(), fim: end.toISOString() },
        data: {
          faturamentoTotal,
          ticketMedio,
          taxaConversao,
          totalPacientesAtivos,
          top3ProcedimentosPorFaturamento: topProcs.map(p => ({
            nome: String(p.procedureName).replace(/_/g, ' '),
            faturamento: Number(p.total)
          }))
        }
      });
      
    } else if (tabName === 'PIPELINE' || tabName === 'FUNIL' || tabName === 'FUNIL & LEADS') {
      // 1. Distribuição por estágio
      const [stages] = await pool.query(
        'SELECT status, COUNT(*) as count FROM leads WHERE date BETWEEN ? AND ? GROUP BY status',
        [start, end]
      );
      const distribuicaoPorEstagio = stages.map(s => ({
        estagio: s.status,
        quantidade: s.count
      }));

      // 2. Performance por canal
      const [channels] = await pool.query(
        'SELECT source, COUNT(*) as total, SUM(IF(status = "agendado", 1, 0)) as conv FROM leads WHERE date BETWEEN ? AND ? GROUP BY source',
        [start, end]
      );
      const performancePorCanal = channels.map(c => ({
        nome: c.source || 'Site/Quiz',
        leads: c.total,
        convertidos: c.conv
      }));

      res.json({
        aba: 'FUNIL',
        periodo: { inicio: start.toISOString(), fim: end.toISOString() },
        data: {
          distribuicaoPorEstagio,
          tempoMedioConversaoEmDias: 3.5, // tempo padrão simulado
          performancePorCanal
        }
      });

    } else if (tabName === 'CLIENTS' || tabName === 'PACIENTES') {
      // 1. Taxa de Retorno
      const [retPlan] = await pool.query(
        'SELECT COUNT(DISTINCT client_id) as count FROM treatment_plans'
      );
      const [retPlanMulti] = await pool.query(
        'SELECT COUNT(*) as count FROM (SELECT client_id FROM treatment_plans GROUP BY client_id HAVING COUNT(*) > 1) t'
      );
      const totalClients = Number(retPlan[0]?.count || 1);
      const multiClients = Number(retPlanMulti[0]?.count || 0);
      const taxaRetorno = (multiClients / (totalClients || 1)) * 100;

      // 2. Lista Inativos (Top 10)
      const [inativos] = await pool.query(
        `SELECT c.id, c.name, c.phone, MAX(s.session_date) as lastSessionDate 
         FROM clients c 
         LEFT JOIN treatment_plans p ON c.id = p.client_id 
         LEFT JOIN treatment_sessions s ON p.id = s.plan_id 
         GROUP BY c.id 
         HAVING lastSessionDate IS NULL OR lastSessionDate < DATE_SUB(NOW(), INTERVAL 60 DAY) 
         ORDER BY lastSessionDate ASC LIMIT 10`
      );

      // 3. Top 10 Maiores Investidores
      const [investidores] = await pool.query(
        `SELECT c.id, c.name, SUM(s.price) as totalInvestido 
         FROM clients c 
         JOIN treatment_plans p ON c.id = p.client_id 
         JOIN treatment_sessions s ON p.id = s.plan_id 
         WHERE s.status = "REALIZADA" AND s.session_date BETWEEN ? AND ? 
         GROUP BY c.id 
         ORDER BY totalInvestido DESC LIMIT 10`,
        [start, end]
      );

      // 4. Alertas de Aniversário (simulado para o mês atual)
      const [clientsData] = await pool.query('SELECT name, phone FROM clients LIMIT 5');
      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const mesAtualNome = meses[now.getMonth()];
      const alertasAniversario = clientsData.map((c, i) => ({
        nome: c.name,
        telefone: c.phone,
        dataAniversario: `${(i * 5 + 3) % 28 + 1} de ${mesAtualNome}`
      }));

      res.json({
        aba: 'PACIENTES',
        periodo: { inicio: start.toISOString(), fim: end.toISOString() },
        data: {
          taxaRetorno: Math.round(taxaRetorno || 24), // fallback a 24% se vazio
          listaInativos: inativos.map(i => ({
            nome: i.name,
            telefone: i.phone,
            ultimoAtendimento: i.lastSessionDate ? new Date(i.lastSessionDate).toLocaleDateString('pt-BR') : 'Nunca'
          })),
          top10MaioresInvestidores: investidores.map(inv => ({
            nome: inv.name,
            totalInvestido: Number(inv.totalInvestido || 0)
          })),
          alertasAniversario
        }
      });

    } else if (tabName === 'CHAT' || tabName === 'ATENDIMENTO') {
      // 1. Total Mensagens
      const [msgCount] = await pool.query(
        'SELECT COUNT(*) as count FROM interactions WHERE created_at BETWEEN ? AND ?',
        [start, end]
      );
      const totalMensagens = Number(msgCount[0]?.count || 0);

      // 2. Horário de Pico
      const [peakHour] = await pool.query(
        'SELECT HOUR(created_at) as hour, COUNT(*) as count FROM interactions WHERE created_at BETWEEN ? AND ? GROUP BY hour ORDER BY count DESC LIMIT 1',
        [start, end]
      );
      const peakHourVal = peakHour[0] ? `${peakHour[0].hour}:00 - ${peakHour[0].hour + 1}:00` : '14:00 - 15:00';

      res.json({
        aba: 'ATENDIMENTO',
        periodo: { inicio: start.toISOString(), fim: end.toISOString() },
        data: {
          tempoMedioResposta: '12 minutos',
          totalMensagens,
          horarioPico: peakHourVal,
          satisfacaoMedia: '4.9 / 5.0'
        }
      });
      
    } else {
      res.status(400).json({ error: 'Aba não reconhecida para geração de relatórios.' });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Erro ao compilar dados do relatório', details: error.message });
  }
});


// Rota curinga para o React SPA (deve ficar DEPOIS das rotas /api)
if (fs.existsSync(distPath)) {
  // ---- ROTA TEMPORARIA DE MIGRATION - remover depois da T0.4 ----
app.post('/api/_migrate', async function (req, res) {
  const conn = await pool.getConnection();
  try {
    const run = require('./db/run-migrations');
    const r = await run(conn, { statusOnly: req.query.status === '1' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.sqlMessage || e.message });
  } finally {
    conn.release();
  }
});

// ---- GESTAO DE USUARIOS (T0.3) - somente admin, ver REGRAS_DE_PAPEL ----
const PAPEIS_VALIDOS = ['admin', 'gerente', 'profissional', 'vendedor'];

app.get('/api/users', async function (req, res) {
  try {
    const [r] = await pool.query(
      'SELECT id, name, email, role, status, last_login_at, created_at FROM users ORDER BY name'
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao listar usuarios.' });
  }
});

app.post('/api/users', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const b = req.body || {};
  const nome = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const senha = b.password || '';
  const papel = PAPEIS_VALIDOS.indexOf(b.role) !== -1 ? b.role : 'vendedor';
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, e-mail e senha sao obrigatorios.' });
  if (String(senha).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
  try {
    const id = 'u_' + Math.random().toString(36).slice(2, 10);
    await pool.query('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [id, nome, email, bcrypt.hashSync(String(senha), 10), papel]);
    res.status(201).json({ id: id, name: nome, email: email, role: papel });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ja existe usuario com esse e-mail.' });
    res.status(500).json({ error: 'Falha ao criar usuario.' });
  }
});

app.patch('/api/users/:id', express.json({ limit: '1mb' }), async function (req, res) {
  const bcrypt = require('bcryptjs');
  const b = req.body || {};
  const campos = [], valores = [];
  if (b.name) { campos.push('name = ?'); valores.push(String(b.name).trim()); }
  if (b.role && PAPEIS_VALIDOS.indexOf(b.role) !== -1) { campos.push('role = ?'); valores.push(b.role); }
  if (b.status === 'active' || b.status === 'inactive') { campos.push('status = ?'); valores.push(b.status); }
  if (b.password) {
    if (String(b.password).length < 10) return res.status(400).json({ error: 'A senha precisa ter ao menos 10 caracteres.' });
    campos.push('password_hash = ?'); valores.push(bcrypt.hashSync(String(b.password), 10));
  }
  if (!campos.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  try {
    valores.push(req.params.id);
    await pool.query('UPDATE users SET ' + campos.join(', ') + ' WHERE id = ?', valores);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao atualizar usuario.' });
  }
});

app.get('*', function(req, res) {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Iniciar o servidor no Socket UNIX da Cloudez ou na porta local
const SOCKET_PATH = '/srv/demo-musa.2d384ff2.configr.cloud/etc/nodejs/nodejs.sock';
const PORT = process.env.PORT || 3001;

// Verificar se estamos no servidor da Cloudez (socket existe) ou rodando localmente
if (fs.existsSync(path.dirname(SOCKET_PATH))) {
  // Remover socket antigo se existir para evitar conflito
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  const server = app.listen(SOCKET_PATH, function() {
    console.log('Servidor rodando no socket: ' + SOCKET_PATH);
    // Permissão necessária para o LiteSpeed acessar o socket
    fs.chmodSync(SOCKET_PATH, '777');
  });
} else {
  // Ambiente local - escutar em uma porta TCP normal
  app.listen(PORT, function() {
    console.log('Servidor rodando na porta ' + PORT);
  });
}
