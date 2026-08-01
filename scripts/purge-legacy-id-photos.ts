import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const APPLY = process.argv.includes('--apply');

function publicIdFrom(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/);
  return match?.[1] ?? null;
}

async function main() {
  const profiles = await prisma.doctorProfile.findMany({
    where: { id_photo_url: { not: null } },
    select: { id: true, user_id: true, id_photo_url: true },
  });

  console.log(`${profiles.length} legacy ID photos on public delivery URLs.`);
  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to delete them from Cloudinary and clear the column.');
    for (const p of profiles) console.log(`  ${p.user_id}  ${p.id_photo_url}`);
    return;
  }

  let deleted = 0;
  let failed = 0;

  for (const p of profiles) {
    const publicId = publicIdFrom(p.id_photo_url!);
    if (!publicId) {
      console.warn(`  ! unparseable URL for ${p.user_id}: ${p.id_photo_url}`);
      failed++;
      continue;
    }
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'image' });
      await prisma.doctorProfile.update({ where: { id: p.id }, data: { id_photo_url: null } });
      deleted++;
    } catch (err) {
      console.error(`  ! failed for ${p.user_id}:`, err);
      failed++;
    }
  }

  console.log(`Deleted ${deleted}, failed ${failed}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
