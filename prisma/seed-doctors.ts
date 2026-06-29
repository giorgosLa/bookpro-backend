import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ── Helpers ───────────────────────────────────────────────────────────────
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

type ServiceTpl = {
  name: string;
  description: string;
  duration: number;
  price: number;
};
type CategoryTpl = { name: string; services: ServiceTpl[] };
type SpecialtyTpl = {
  specialty: string; // MedicalSpecialty enum value
  profession: string; // Greek label
  categories: CategoryTpl[];
};

// ── Per-specialty service templates ─────────────────────────────────────────
const TEMPLATES: SpecialtyTpl[] = [
  {
    specialty: 'CARDIOLOGIST',
    profession: 'Καρδιολόγος',
    categories: [
      {
        name: 'Διαγνωστικά',
        services: [
          { name: 'Καρδιολογική Εξέταση', description: 'Πλήρης κλινική εξέταση με ΗΚΓ', duration: 30, price: 80 },
          { name: 'Υπερηχοκαρδιογράφημα', description: 'Triplex καρδιάς', duration: 45, price: 120 },
          { name: 'Test Κόπωσης', description: 'Δοκιμασία κοπώσεως σε κυλιόμενο τάπητα', duration: 60, price: 100 },
        ],
      },
      {
        name: 'Παρακολούθηση',
        services: [
          { name: 'Holter Ρυθμού 24ωρο', description: '24ωρη καταγραφή καρδιακού ρυθμού', duration: 20, price: 70 },
          { name: 'Τηλεϊατρική Επίσκεψη', description: 'Online διαβούλευση', duration: 20, price: 50 },
        ],
      },
    ],
  },
  {
    specialty: 'DERMATOLOGIST',
    profession: 'Δερματολόγος - Αφροδισιολόγος',
    categories: [
      {
        name: 'Δερματολογία',
        services: [
          { name: 'Δερματολογική Εξέταση', description: 'Γενικός δερματολογικός έλεγχος', duration: 30, price: 60 },
          { name: 'Χαρτογράφηση Σπίλων', description: 'Ψηφιακή δερματοσκόπηση', duration: 40, price: 90 },
        ],
      },
      {
        name: 'Αισθητική',
        services: [
          { name: 'Botox', description: 'Έγχυση botulinum toxin', duration: 30, price: 200 },
          { name: 'Κρυοθεραπεία', description: 'Αφαίρεση βλαβών με κρυοπηξία', duration: 20, price: 50 },
        ],
      },
    ],
  },
  {
    specialty: 'PEDIATRICIAN',
    profession: 'Παιδίατρος',
    categories: [
      {
        name: 'Παιδιατρική',
        services: [
          { name: 'Παιδιατρική Εξέταση', description: 'Γενική εξέταση παιδιού', duration: 30, price: 50 },
          { name: 'Εμβολιασμός', description: 'Προγραμματισμένος εμβολιασμός', duration: 20, price: 40 },
          { name: 'Έλεγχος Ανάπτυξης', description: 'Αξιολόγηση σωματικής ανάπτυξης', duration: 30, price: 50 },
        ],
      },
      {
        name: 'Νεογνικά',
        services: [
          { name: 'Εξέταση Νεογνού', description: 'Έλεγχος νεογέννητου', duration: 40, price: 60 },
        ],
      },
    ],
  },
  {
    specialty: 'ORTHOPEDIC_SURGEON',
    profession: 'Ορθοπαιδικός Χειρουργός',
    categories: [
      {
        name: 'Διαγνωστικά',
        services: [
          { name: 'Ορθοπαιδική Εξέταση', description: 'Κλινική εξέταση μυοσκελετικού', duration: 30, price: 60 },
          { name: 'Έγχυση Ενδαρθρικά', description: 'Ενδαρθρική έγχυση υαλουρονικού', duration: 20, price: 90 },
        ],
      },
      {
        name: 'Αποκατάσταση',
        services: [
          { name: 'Επανεξέταση', description: 'Επανέλεγχος μετά από θεραπεία', duration: 20, price: 40 },
          { name: 'Νάρθηκας / Επίδεση', description: 'Τοποθέτηση νάρθηκα', duration: 25, price: 55 },
        ],
      },
    ],
  },
  {
    specialty: 'OBSTETRICIAN_GYNECOLOGIST',
    profession: 'Μαιευτήρας - Γυναικολόγος',
    categories: [
      {
        name: 'Γυναικολογία',
        services: [
          { name: 'Γυναικολογική Εξέταση', description: 'Γενική γυναικολογική εξέταση', duration: 30, price: 60 },
          { name: 'Test ΠΑΠ', description: 'Λήψη και ανάλυση τεστ Παπανικολάου', duration: 20, price: 40 },
        ],
      },
      {
        name: 'Μαιευτική',
        services: [
          { name: 'Υπέρηχος Εγκυμοσύνης', description: 'Μαιευτικός υπέρηχος', duration: 40, price: 80 },
          { name: 'Προγεννητικός Έλεγχος', description: 'Παρακολούθηση κύησης', duration: 30, price: 70 },
        ],
      },
    ],
  },
  {
    specialty: 'PSYCHIATRIST',
    profession: 'Ψυχίατρος',
    categories: [
      {
        name: 'Συνεδρίες',
        services: [
          { name: 'Πρώτη Εκτίμηση', description: 'Αρχική ψυχιατρική αξιολόγηση', duration: 60, price: 90 },
          { name: 'Συνεδρία Παρακολούθησης', description: 'Επαναληπτική συνεδρία', duration: 45, price: 70 },
          { name: 'Τηλε-συνεδρία', description: 'Online συνεδρία', duration: 45, price: 70 },
        ],
      },
    ],
  },
  {
    specialty: 'DENTIST',
    profession: 'Οδοντίατρος',
    categories: [
      {
        name: 'Γενική Οδοντιατρική',
        services: [
          { name: 'Οδοντιατρικός Έλεγχος', description: 'Εξέταση & σχέδιο θεραπείας', duration: 30, price: 30 },
          { name: 'Καθαρισμός Δοντιών', description: 'Αποτρύγωση & στίλβωση', duration: 40, price: 50 },
          { name: 'Σφράγισμα', description: 'Αποκατάσταση τερηδόνας', duration: 45, price: 70 },
        ],
      },
      {
        name: 'Αισθητική',
        services: [
          { name: 'Λεύκανση Δοντιών', description: 'Λεύκανση σε μία συνεδρία', duration: 60, price: 180 },
        ],
      },
    ],
  },
  {
    specialty: 'OPHTHALMOLOGIST',
    profession: 'Οφθαλμίατρος',
    categories: [
      {
        name: 'Οφθαλμολογία',
        services: [
          { name: 'Οφθαλμολογική Εξέταση', description: 'Πλήρης έλεγχος όρασης', duration: 30, price: 50 },
          { name: 'Μέτρηση Πίεσης Ματιού', description: 'Τονομέτρηση για γλαύκωμα', duration: 20, price: 40 },
          { name: 'Βυθοσκόπηση', description: 'Έλεγχος βυθού οφθαλμού', duration: 25, price: 60 },
        ],
      },
    ],
  },
  {
    specialty: 'NEUROLOGIST',
    profession: 'Νευρολόγος',
    categories: [
      {
        name: 'Νευρολογία',
        services: [
          { name: 'Νευρολογική Εξέταση', description: 'Κλινική νευρολογική εκτίμηση', duration: 40, price: 70 },
          { name: 'Ηλεκτρομυογράφημα', description: 'ΗΜΓ άνω/κάτω άκρων', duration: 45, price: 110 },
        ],
      },
    ],
  },
  {
    specialty: 'ENDOCRINOLOGIST',
    profession: 'Ενδοκρινολόγος',
    categories: [
      {
        name: 'Ενδοκρινολογία',
        services: [
          { name: 'Ενδοκρινολογική Εξέταση', description: 'Έλεγχος ορμονικού προφίλ', duration: 30, price: 60 },
          { name: 'Έλεγχος Θυρεοειδούς', description: 'Υπέρηχος & αξιολόγηση θυρεοειδούς', duration: 30, price: 70 },
        ],
      },
    ],
  },
  {
    specialty: 'GENERAL_PRACTITIONER',
    profession: 'Γενικός Ιατρός',
    categories: [
      {
        name: 'Πρωτοβάθμια Φροντίδα',
        services: [
          { name: 'Γενική Εξέταση', description: 'Γενικός κλινικός έλεγχος', duration: 30, price: 40 },
          { name: 'Συνταγογράφηση', description: 'Έκδοση & ανανέωση συνταγών', duration: 15, price: 20 },
          { name: 'Check-up', description: 'Προληπτικός έλεγχος υγείας', duration: 45, price: 80 },
        ],
      },
    ],
  },
  {
    specialty: 'PHYSIOTHERAPIST',
    profession: 'Φυσικοθεραπευτής',
    categories: [
      {
        name: 'Φυσικοθεραπεία',
        services: [
          { name: 'Συνεδρία Φυσικοθεραπείας', description: 'Εξατομικευμένη συνεδρία', duration: 45, price: 35 },
          { name: 'Χειροθεραπεία', description: 'Manual therapy', duration: 40, price: 40 },
          { name: 'Αξιολόγηση & Πρόγραμμα', description: 'Αρχική αξιολόγηση & πλάνο', duration: 60, price: 50 },
        ],
      },
    ],
  },
  {
    specialty: 'NUTRITIONIST',
    profession: 'Διαιτολόγος - Διατροφολόγος',
    categories: [
      {
        name: 'Διατροφή',
        services: [
          { name: 'Πρώτη Επίσκεψη', description: 'Λιπομέτρηση & διατροφικό πλάνο', duration: 60, price: 50 },
          { name: 'Επανεκτίμηση', description: 'Παρακολούθηση προόδου', duration: 30, price: 30 },
        ],
      },
    ],
  },
  {
    specialty: 'PSYCHOLOGIST',
    profession: 'Ψυχολόγος',
    categories: [
      {
        name: 'Ψυχοθεραπεία',
        services: [
          { name: 'Ατομική Συνεδρία', description: 'Συνεδρία ψυχοθεραπείας', duration: 50, price: 50 },
          { name: 'Συνεδρία Ζεύγους', description: 'Θεραπεία ζεύγους', duration: 60, price: 70 },
        ],
      },
    ],
  },
  {
    specialty: 'GASTROENTEROLOGIST',
    profession: 'Γαστρεντερολόγος',
    categories: [
      {
        name: 'Γαστρεντερολογία',
        services: [
          { name: 'Γαστρεντερολογική Εξέταση', description: 'Κλινική εκτίμηση πεπτικού', duration: 30, price: 60 },
          { name: 'Γαστροσκόπηση', description: 'Ενδοσκόπηση ανώτερου πεπτικού', duration: 45, price: 150 },
        ],
      },
    ],
  },
  {
    specialty: 'UROLOGIST',
    profession: 'Ουρολόγος',
    categories: [
      {
        name: 'Ουρολογία',
        services: [
          { name: 'Ουρολογική Εξέταση', description: 'Κλινική ουρολογική εκτίμηση', duration: 30, price: 60 },
          { name: 'Υπέρηχος Ουροποιητικού', description: 'Έλεγχος νεφρών & κύστης', duration: 30, price: 70 },
        ],
      },
    ],
  },
  {
    specialty: 'OTOLARYNGOLOGIST',
    profession: 'Ωτορινολαρυγγολόγος',
    categories: [
      {
        name: 'ΩΡΛ',
        services: [
          { name: 'ΩΡΛ Εξέταση', description: 'Έλεγχος ώτων, ρινός, λάρυγγα', duration: 30, price: 50 },
          { name: 'Ακοόγραμμα', description: 'Έλεγχος ακοής', duration: 30, price: 45 },
        ],
      },
    ],
  },
  {
    specialty: 'PULMONOLOGIST',
    profession: 'Πνευμονολόγος',
    categories: [
      {
        name: 'Πνευμονολογία',
        services: [
          { name: 'Πνευμονολογική Εξέταση', description: 'Κλινικός έλεγχος αναπνευστικού', duration: 30, price: 60 },
          { name: 'Σπιρομέτρηση', description: 'Έλεγχος αναπνευστικής λειτουργίας', duration: 25, price: 50 },
        ],
      },
    ],
  },
  {
    specialty: 'RHEUMATOLOGIST',
    profession: 'Ρευματολόγος',
    categories: [
      {
        name: 'Ρευματολογία',
        services: [
          { name: 'Ρευματολογική Εξέταση', description: 'Εκτίμηση αρθρώσεων & αυτοάνοσων', duration: 40, price: 70 },
          { name: 'Έγχυση Άρθρωσης', description: 'Τοπική ενδαρθρική έγχυση', duration: 20, price: 80 },
        ],
      },
    ],
  },
  {
    specialty: 'ORTHODONTIST',
    profession: 'Ορθοδοντικός',
    categories: [
      {
        name: 'Ορθοδοντική',
        services: [
          { name: 'Ορθοδοντική Εκτίμηση', description: 'Αρχική εκτίμηση & σχέδιο', duration: 40, price: 40 },
          { name: 'Τοποθέτηση Σιδεράκια', description: 'Εφαρμογή σταθερών μηχανισμών', duration: 60, price: 250 },
          { name: 'Έλεγχος / Ενεργοποίηση', description: 'Μηνιαίος έλεγχος ορθοδοντικού', duration: 30, price: 50 },
        ],
      },
    ],
  },
];

// ── Greek cities with coordinates (for locations) ──────────────────────────
const CITIES = [
  { name: 'Αθήνα', area: 'Κολωνάκι', lat: 37.9795, lng: 23.7448 },
  { name: 'Θεσσαλονίκη', area: 'Κέντρο', lat: 40.6334, lng: 22.9442 },
  { name: 'Πάτρα', area: 'Κέντρο', lat: 38.2466, lng: 21.7346 },
  { name: 'Ηράκλειο', area: 'Κέντρο', lat: 35.3387, lng: 25.1442 },
  { name: 'Λάρισα', area: 'Κέντρο', lat: 39.639, lng: 22.4191 },
  { name: 'Βόλος', area: 'Παραλία', lat: 39.3622, lng: 22.942 },
  { name: 'Ιωάννινα', area: 'Κέντρο', lat: 39.665, lng: 20.8537 },
  { name: 'Χανιά', area: 'Παλιά Πόλη', lat: 35.5138, lng: 24.018 },
];

const STREETS = ['Ερμού', 'Τσιμισκή', 'Ακαδημίας', 'Σταδίου', 'Αγίου Δημητρίου', 'Βασιλίσσης Σοφίας', 'Παπαναστασίου', 'Ηρώων Πολυτεχνείου'];

// ── 20 doctors: name, gender, latin slug base ───────────────────────────────
const NAMES = [
  { full: 'Νίκος Παπαδάκης', gender: 'MALE', slug: 'nikos-papadakis' },
  { full: 'Μαρία Γεωργίου', gender: 'FEMALE', slug: 'maria-georgiou' },
  { full: 'Δημήτρης Αντωνίου', gender: 'MALE', slug: 'dimitris-antoniou' },
  { full: 'Ελένη Νικολάου', gender: 'FEMALE', slug: 'eleni-nikolaou' },
  { full: 'Γιώργος Βασιλείου', gender: 'MALE', slug: 'giorgos-vasileiou' },
  { full: 'Σοφία Κωνσταντίνου', gender: 'FEMALE', slug: 'sofia-konstantinou' },
  { full: 'Κώστας Δημητρίου', gender: 'MALE', slug: 'kostas-dimitriou' },
  { full: 'Αναστασία Παππά', gender: 'FEMALE', slug: 'anastasia-pappa' },
  { full: 'Ανδρέας Μακρής', gender: 'MALE', slug: 'andreas-makris' },
  { full: 'Χριστίνα Ιωάννου', gender: 'FEMALE', slug: 'christina-ioannou' },
  { full: 'Παναγιώτης Σταύρου', gender: 'MALE', slug: 'panagiotis-stavrou' },
  { full: 'Κατερίνα Αλεξίου', gender: 'FEMALE', slug: 'katerina-alexiou' },
  { full: 'Θανάσης Ρούσσος', gender: 'MALE', slug: 'thanasis-roussos' },
  { full: 'Δέσποινα Καρρά', gender: 'FEMALE', slug: 'despoina-karra' },
  { full: 'Μιχάλης Φωτίου', gender: 'MALE', slug: 'michalis-fotiou' },
  { full: 'Ιωάννα Λάμπρου', gender: 'FEMALE', slug: 'ioanna-lamprou' },
  { full: 'Στέφανος Βλάχος', gender: 'MALE', slug: 'stefanos-vlachos' },
  { full: 'Βασιλική Σπυρίδου', gender: 'FEMALE', slug: 'vasiliki-spyridou' },
  { full: 'Αλέξανδρος Μηνάς', gender: 'MALE', slug: 'alexandros-minas' },
  { full: 'Ζωή Παυλίδου', gender: 'FEMALE', slug: 'zoi-pavlidou' },
];

async function main() {
  console.log('🌱 Seeding 20 doctors...\n');

  for (let i = 0; i < NAMES.length; i++) {
    const person = NAMES[i];
    const tpl = TEMPLATES[i % TEMPLATES.length];
    const titlePrefix = person.gender === 'FEMALE' ? 'Δρ.' : 'Δρ.';
    const email = `seed.doctor${i + 1}@bookpro.gr`;
    const slug = `${person.slug}-${i + 1}`;

    // Idempotent reset
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } }); // cascades to all relations
    }

    const hashed = await bcrypt.hash('password123', 12);
    const city = CITIES[i % CITIES.length];
    const acceptsEopyy = i % 2 === 0;
    const acceptsGessy = i % 3 === 0;

    // 1) User + DoctorProfile
    const doctor = await prisma.user.create({
      data: {
        id: uuidv4(),
        email,
        password: hashed,
        role: 'DOCTOR',
        full_name: person.full,
        business_name: `${titlePrefix} ${person.full} — ${tpl.profession}`,
        bio: `${tpl.profession} με πολυετή εμπειρία στην ${city.name}. ${acceptsEopyy ? 'Συμβεβλημένος με ΕΟΠΥΥ. ' : ''}Εξυπηρέτηση με ραντεβού.`,
        address: `${STREETS[i % STREETS.length]} ${10 + i}, ${city.name}`,
        booking_url_slug: slug,
        timezone: 'Europe/Athens',
        buffer_minutes: i % 2 === 0 ? 0 : 10,
        doctor_profile: {
          create: {
            id: uuidv4(),
            specialty: tpl.specialty as any,
            latitude: city.lat,
            longitude: city.lng,
            accepts_eopyy: acceptsEopyy,
            accepts_gessy: acceptsGessy,
            phone: `+30 21${i % 10} 0${100000 + i}`,
            education: `Ιατρική Σχολή ΕΚΠΑ — Ειδικότητα ${tpl.profession}`,
            gender: person.gender as any,
            verification_status: 'APPROVED',
            terms_accepted: true,
          },
        },
      },
    });

    // 2) Service categories + services
    const allServices: { id: string; price: number }[] = [];
    for (let c = 0; c < tpl.categories.length; c++) {
      const cat = tpl.categories[c];
      const category = await prisma.service_categories.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          name: cat.name,
          order: c,
        },
      });

      for (const svc of cat.services) {
        const service = await prisma.services.create({
          data: {
            id: uuidv4(),
            profile_id: doctor.id,
            category_id: category.id,
            name: svc.name,
            description: svc.description,
            duration_minutes: svc.duration,
            price: svc.price,
            is_active: true,
          },
        });
        allServices.push({ id: service.id, price: svc.price });
      }
    }

    // 3) Two locations
    const locA = await prisma.locations.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        name: `Ιατρείο ${city.name} (${city.area})`,
        address: `${STREETS[i % STREETS.length]} ${10 + i}, ${city.name}`,
        lat: city.lat,
        lng: city.lng,
        phone: `+30 21${i % 10} 0${100000 + i}`,
        timezone: 'Europe/Athens',
        is_active: true,
        order: 0,
      },
    });

    const cityB = CITIES[(i + 1) % CITIES.length];
    const locB = await prisma.locations.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        name: `Ιατρείο ${cityB.name} (${cityB.area})`,
        address: `${STREETS[(i + 1) % STREETS.length]} ${20 + i}, ${cityB.name}`,
        lat: cityB.lat,
        lng: cityB.lng,
        phone: `+30 23${i % 10} 0${200000 + i}`,
        timezone: 'Europe/Athens',
        is_active: true,
        order: 1,
      },
    });

    // 4) location_services pivot — all services at both locations (locB has +€10 override)
    for (const s of allServices) {
      await prisma.location_services.create({
        data: { id: uuidv4(), location_id: locA.id, service_id: s.id, is_active: true },
      });
      await prisma.location_services.create({
        data: {
          id: uuidv4(),
          location_id: locB.id,
          service_id: s.id,
          price_override: s.price + 10,
          is_active: true,
        },
      });
    }

    // 5) Working hours
    // Default schedule (location_id = null): Mon–Fri 09:00–17:00
    // day_of_week: 0=Sun ... 6=Sat
    const weekdays = [1, 2, 3, 4, 5];
    for (const day of weekdays) {
      await prisma.working_hours.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          location_id: null,
          day_of_week: day,
          start_time: time('09:00'),
          end_time: time('17:00'),
          is_enabled: true,
        },
      });
    }

    // Location A: Mon–Fri, morning 09:00–13:00 + afternoon 17:00–21:00
    for (const day of weekdays) {
      await prisma.working_hours.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          location_id: locA.id,
          day_of_week: day,
          start_time: time('09:00'),
          end_time: time('13:00'),
          is_enabled: true,
        },
      });
      await prisma.working_hours.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          location_id: locA.id,
          day_of_week: day,
          start_time: time('17:00'),
          end_time: time('21:00'),
          is_enabled: true,
        },
      });
    }

    // Location B: Tue/Thu/Sat 10:00–14:00
    for (const day of [2, 4, 6]) {
      await prisma.working_hours.create({
        data: {
          id: uuidv4(),
          profile_id: doctor.id,
          location_id: locB.id,
          day_of_week: day,
          start_time: time('10:00'),
          end_time: time('14:00'),
          is_enabled: true,
        },
      });
    }

    // 6) A sample blocked slot at location A (next Friday lunch)
    const friday = new Date();
    friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7 || 7));
    await prisma.blocked_time.create({
      data: {
        id: uuidv4(),
        profile_id: doctor.id,
        location_id: locA.id,
        date: new Date(`${friday.toISOString().slice(0, 10)}T00:00:00Z`),
        start_time: time('13:00'),
        end_time: time('14:00'),
        reason: 'Διάλειμμα',
      },
    });

    console.log(
      `✅ ${String(i + 1).padStart(2, '0')}/20  ${doctor.business_name} — ${tpl.profession} — /${slug}`,
    );
  }

  console.log('\n🎉 Seed ολοκληρώθηκε!');
  console.log('─────────────────────────────');
  console.log('📧 Emails:   seed.doctor1@bookpro.gr … seed.doctor20@bookpro.gr');
  console.log('🔑 Password: password123');
  console.log('🔗 Booking:  http://localhost:3000/book/<slug>');
  console.log('─────────────────────────────');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
