import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const destination = new URL('../.env', import.meta.url);
if (existsSync(destination)) {
  console.log('Existing .env preserved.');
} else {
  const dbPassword = randomBytes(18).toString('hex');
  const seedPassword = randomBytes(18).toString('hex');
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(destination, template.replaceAll('change-this-local-password', dbPassword).replace(/^SEED_PASSWORD=.*$/m, `SEED_PASSWORD=${seedPassword}`), { mode: 0o600 });
  console.log('Created private .env with random database and seed passwords. Read SEED_PASSWORD locally to log in.');
}
