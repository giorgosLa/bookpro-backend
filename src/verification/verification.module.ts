import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { AdminVerificationController } from './admin-verification.controller';
import { VerificationService } from './verification.service';
import { SecureDocumentsService } from '@/common/storage/secure-documents.service';
import { AuditInterceptor } from '@/admin/audit.interceptor';
import { EmailModule } from '@/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [VerificationController, AdminVerificationController],
  providers: [VerificationService, SecureDocumentsService, AuditInterceptor],
  exports: [VerificationService],
})
export class VerificationModule {}
