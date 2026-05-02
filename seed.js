const bcrypt = require('bcrypt');
const db = require('./config/db'); // adjust path if needed

async function seed() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const password = await bcrypt.hash('password123', 12);

    // ── ADMIN ──────────────────────────────────────────────────────────────────
    const admin = await client.query(`
      INSERT INTO "user" (first_name, last_name, email, phone, password, role, status, domain)
      VALUES ('Karim', 'Messaoud', 'admin@talentbridge.dz', '0550000001', $1, 'admin', 'active', NULL)
      ON CONFLICT (email) DO UPDATE SET password = $1
      RETURNING id, email, role
    `, [password]);
    console.log('✅ Admin:', admin.rows[0].email);

    // ── EXPERT ─────────────────────────────────────────────────────────────────
    const expert = await client.query(`
      INSERT INTO "user" (first_name, last_name, email, phone, password, role, status, domain)
      VALUES ('Yacine', 'Belkacem', 'expert1@talentbridge.dz', '0550000002', $1, 'expert', 'active', 'web_dev')
      ON CONFLICT (email) DO UPDATE SET password = $1
      RETURNING id, email, role
    `, [password]);
    console.log('✅ Expert:', expert.rows[0].email);

    await client.query(`
      INSERT INTO expert (user_id, specialty, bio, available)
      VALUES ($1, 'Full-stack · Web Dev', 'Senior web dev with 8 years experience.', true)
      ON CONFLICT (user_id) DO NOTHING
    `, [expert.rows[0].id]);

    // ── STUDENT ────────────────────────────────────────────────────────────────
    const student = await client.query(`
      INSERT INTO "user" (first_name, last_name, email, phone, password, role, status, domain)
      VALUES ('Mohamed', 'Benali', 'student@talentbridge.dz', '0550000003', $1, 'student', 'active', 'web_dev')
      ON CONFLICT (email) DO UPDATE SET password = $1
      RETURNING id, email, role
    `, [password]);
    console.log('✅ Student:', student.rows[0].email);

    await client.query(`
      INSERT INTO student (user_id, university, wilaya, cv_url, portfolio_url, global_rating, consecutive_projects)
      VALUES ($1, 'ESI Algiers', 'Alger', NULL, NULL, 4.7, 0)
      ON CONFLICT (user_id) DO NOTHING
    `, [student.rows[0].id]);

    // ── CLIENT ─────────────────────────────────────────────────────────────────
    const clientUser = await client.query(`
      INSERT INTO "user" (first_name, last_name, email, phone, password, role, status, domain)
      VALUES ('Samira', 'Haddad', 'client@talentbridge.dz', '0550000004', $1, 'client', 'active', NULL)
      ON CONFLICT (email) DO UPDATE SET password = $1
      RETURNING id, email, role
    `, [password]);
    console.log('✅ Client:', clientUser.rows[0].email);

    await client.query(`
      INSERT INTO client (user_id, company, city)
      VALUES ($1, 'NovaClinic SARL', 'Alger')
      ON CONFLICT (user_id) DO NOTHING
    `, [clientUser.rows[0].id]);

    // ── SAMPLE PROJECT ─────────────────────────────────────────────────────────
    const project = await client.query(`
      INSERT INTO project (client_id, expert_id, title, service_type, description, status, team_size, total_price)
      VALUES ($1, $2, 'NovaClinic Patient Portal', 'web_dev', 'Arabic-first patient portal with booking and SMS reminders.', 'in_progress', 3, 420000)
      ON CONFLICT DO NOTHING
      RETURNING id, title
    `, [clientUser.rows[0].id, expert.rows[0].id]);

    if (project.rows.length > 0) {
      console.log('✅ Project:', project.rows[0].title);

      await client.query(`
        INSERT INTO application (student_id, project_id, message, status)
        VALUES ($1, $2, 'I have 3 years of React + Next.js experience.', 'pending')
        ON CONFLICT DO NOTHING
      `, [student.rows[0].id, project.rows[0].id]);
      console.log('✅ Application created');

      const tasks = [
        ['Auth flow — phone + OTP', 'Patient signup via phone + OTP', 10],
        ['Booking engine', 'Doctor availability + slot booking', 18],
        ['Patient dashboard', 'Profile, history, prescriptions', 12],
      ];
      for (const [title, desc, weight] of tasks) {
        await client.query(`
          INSERT INTO task (project_id, title, description, weight_pct, status, ai_proposed)
          VALUES ($1, $2, $3, $4, 'open', false)
          ON CONFLICT DO NOTHING
        `, [project.rows[0].id, title, desc, weight]);
      }
      console.log('✅ Tasks created');
    }

    await client.query('COMMIT');
    console.log('\n🎉 Seed complete!\n');
    console.log('─────────────────────────────────────────');
    console.log('  Role     Email                          Password');
    console.log('─────────────────────────────────────────');
    console.log('  admin    admin@talentbridge.dz          password123');
    console.log('  expert   expert1@talentbridge.dz        password123');
    console.log('  student  student@talentbridge.dz        password123');
    console.log('  client   client@talentbridge.dz         password123');
    console.log('─────────────────────────────────────────');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    console.error(err);
  } finally {
    client.release();
    await db.pool.end();
  }
}

seed();