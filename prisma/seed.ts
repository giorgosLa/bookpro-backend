import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const slug = 'dr-test-kardiologos';
  const email = 'test.doctor@bookpro.gr';

  // Αν υπάρχει ήδη, διέγραψέ τον για fresh seed
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('⚠️  Ο γιατρός υπάρχει ήδη — γίνεται reset...');
    await prisma.appointments.deleteMany({ where: { profile_id: existing.id } });
    await prisma.services.deleteMany({ where: { profile_id: existing.id } });
    await prisma.working_hours.deleteMany({ where: { profile_id: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const hashed = await bcrypt.hash('password123', 12);

  // 1. Δημιουργία γιατρού
  const doctor = await prisma.user.create({
    data: {
      id: uuidv4(),
      email,
      password: hashed,
      role: 'DOCTOR',
      business_name: 'Δρ. Νίκος Παπαδάκης',
      full_name: 'Νίκος Παπαδάκης',
      profession: 'Καρδιολόγος',
      bio: 'Ειδικός Καρδιολόγος με 12 χρόνια εμπειρίας. Δέχεται ΕΟΠΥΥ.',
      booking_url_slug: slug,
      timezone: 'Europe/Athens',
      buffer_minutes: 0,
    },
  });

  console.log(`✅ Γιατρός: ${doctor.business_name} (${doctor.email})`);

  // 2. Υπηρεσίες
  const services = await Promise.all([
    prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        name: 'Γενική Καρδιολογική Εξέταση',
        description: 'Πλήρης καρδιολογικός έλεγχος με ΗΚΓ',
        duration_minutes: 30,
        price: 80,
        is_active: true,
      },
    }),
    prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        name: 'Τηλεϊατρική Επίσκεψη',
        description: 'Online διαβούλευση μέσω video call',
        duration_minutes: 20,
        price: 50,
        is_active: true,
      },
    }),
    prisma.services.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        name: 'Υπερηχοκαρδιογράφημα',
        description: 'Εκτενής απεικονιστικός έλεγχος καρδιάς',
        duration_minutes: 60,
        price: 150,
        is_active: true,
      },
    }),
  ]);

  console.log(`✅ Υπηρεσίες: ${services.map(s => s.name).join(', ')}`);

  // 3. Ωράριο — Δευτέρα έως Παρασκευή 09:00–17:00
  // day_of_week: 0=Κυρ, 1=Δευ, 2=Τρι, 3=Τετ, 4=Πεμ, 5=Παρ, 6=Σαβ
  const workdays = [1, 2, 3, 4, 5];
  const startTime = new Date('1970-01-01T09:00:00Z');
  const endTime   = new Date('1970-01-01T17:00:00Z');

  await Promise.all(
    workdays.map(day =>
      prisma.working_hours.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_enabled: true,
        },
      })
    )
  );

  console.log(`✅ Ωράριο: Δευτέρα–Παρασκευή 09:00–17:00`);

  console.log('\n🎉 Seed ολοκληρώθηκε!');
  console.log('─────────────────────────────');
  console.log(`📧 Email:    ${email}`);
  console.log(`🔑 Password: password123`);
  console.log(`🔗 Booking:  http://localhost:3000/book/${slug}`);
  console.log('─────────────────────────────');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
