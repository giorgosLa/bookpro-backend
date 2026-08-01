import { VerificationDocumentType, VerificationStatus } from '@prisma/client';

export const REQUIRED_DOCUMENTS: VerificationDocumentType[] = [
  'REGISTRATION_CERTIFICATE',
  'ID_FRONT',
];

export const DOCUMENT_LABELS: Record<VerificationDocumentType, string> = {
  REGISTRATION_CERTIFICATE: 'Πιστοποιητικό εγγραφής (Ιατρικό Συμβούλιο / ΠΙΣ)',
  ID_FRONT: 'Ταυτότητα — μπροστά',
  ID_BACK: 'Ταυτότητα — πίσω',
  DEGREE: 'Πτυχίο Ιατρικής',
  SPECIALTY_TITLE: 'Τίτλος ειδικότητας',
  GHS_CONTRACT: 'Βεβαίωση παρόχου ΓεΣΥ',
  MALPRACTICE_INSURANCE: 'Ασφάλεια αστικής ευθύνης',
  OTHER: 'Άλλο έγγραφο',
};

export const EDITABLE_STATUSES: VerificationStatus[] = ['DRAFT', 'NEEDS_MORE_INFO'];

export const VERIFICATION_VALID_MONTHS = 12;

export const REVIEW_CHECKLIST: { id: string; label: string }[] = [
  { id: 'identity_match', label: 'Το όνομα στην ταυτότητα ταιριάζει με το προφίλ' },
  { id: 'registration_current', label: 'Το πιστοποιητικό εγγραφής είναι τρέχοντος έτους' },
  { id: 'registry_hit', label: 'Βρέθηκε στο μητρώο (ΓεΣΥ / Ιατρικό Συμβούλιο)' },
  { id: 'specialty_match', label: 'Η ειδικότητα συμφωνεί με τα έγγραφα' },
  { id: 'phone_callback', label: 'Τηλεφωνική επιβεβαίωση σε δημόσια καταχωρημένο αριθμό' },
  { id: 'no_duplicate', label: 'Κανένα έγγραφο δεν έχει χρησιμοποιηθεί από άλλον λογαριασμό' },
];
