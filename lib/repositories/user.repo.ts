import type { Pool } from 'pg';

export interface UserRow {
  id: string;
  email: string;
  doktor_neve: string | null;
  role: string;
  active: boolean;
  restricted_view: boolean;
  intezmeny: string | null;
  hozzaferes_indokolas: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

export class UserRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query(
      'SELECT id, email, doktor_neve, role, active, restricted_view, intezmeny, hozzaferes_indokolas, created_at, updated_at, last_login FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query(
      'SELECT id, email, doktor_neve, role, active, restricted_view, intezmeny, hozzaferes_indokolas, created_at, updated_at, last_login FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    return result.rows[0] ?? null;
  }

  async findAll(): Promise<UserRow[]> {
    const result = await this.pool.query(
      'SELECT id, email, doktor_neve, role, active, restricted_view, intezmeny, hozzaferes_indokolas, created_at, updated_at, last_login FROM users ORDER BY email ASC'
    );
    return result.rows;
  }

  async findDoctors(): Promise<Array<{ id: string; email: string; doktor_neve: string | null; intezmeny: string | null }>> {
    const result = await this.pool.query(
      `SELECT id, email, doktor_neve, intezmeny FROM users WHERE role IN ('sebészorvos', 'fogpótlástanász') AND active = true ORDER BY doktor_neve ASC`
    );
    return result.rows;
  }

  async findAdminEmails(): Promise<string[]> {
    const result = await this.pool.query(
      "SELECT email FROM users WHERE role = 'admin' AND active = true"
    );
    return result.rows.map((r: { email: string }) => r.email);
  }

  async getInstitutionForUser(email: string): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT intezmeny FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0]?.intezmeny ?? null;
  }
}
