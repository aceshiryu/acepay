/* eslint-disable no-console */
import { hashPassword } from '../common/crypto';
import dataSource from './data-source'; // also loads .env via path-resolved dotenv
import { User } from './entities';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env');
  }

  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email: email.toLowerCase() } });
    const passwordHash = await hashPassword(password);

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      await repo.save(existing);
      console.log(`✓ Updated admin user ${email}`);
    } else {
      const user = repo.create({
        email: email.toLowerCase(),
        passwordHash,
        name: 'Ace',
        isActive: true,
      });
      await repo.save(user);
      console.log(`✓ Created admin user ${email}`);
    }
    console.log('');
    console.log('Login with:');
    console.log(`  email:    ${email}`);
    console.log(`  password: ${password}`);
    console.log('');
    console.log('  POST /admin/auth/login  →  { token: "..." }');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
