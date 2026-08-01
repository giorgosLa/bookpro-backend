import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { DecideVerificationDto } from './dto/decide-verification.dto';
import { RecordCheckDto } from './dto/record-check.dto';
import { ReviewProgressDto } from './dto/review-progress.dto';
import { AdminGuard } from '@/common/guards/admin.guard';
import { AuditInterceptor } from '@/admin/audit.interceptor';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

type Admin = { id: string; email: string };

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/doctors')
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get(':id/dossier')
  @ApiOperation({ summary: 'Πλήρης φάκελος επαλήθευσης γιατρού' })
  getDossier(@Param('id', ParseUUIDPipe) id: string) {
    return this.verification.getDossierForAdmin(id);
  }

  @Post(':id/dossier/open')
  @ApiOperation({ summary: 'Ανάληψη φακέλου για έλεγχο (PENDING → IN_REVIEW)' })
  open(@CurrentUser() admin: Admin, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.openForReview(admin.id, admin.email, id);
  }

  @Patch(':id/dossier/progress')
  @ApiOperation({ summary: 'Αποθήκευση checklist, σημειώσεων και κρίσης ανά έγγραφο' })
  saveProgress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewProgressDto) {
    return this.verification.saveReviewProgress(id, dto);
  }

  @Post(':id/dossier/checks')
  @ApiOperation({ summary: 'Καταγραφή τηλεφωνικής επιβεβαίωσης ή ελέγχου μητρώου' })
  recordCheck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordCheckDto) {
    return this.verification.recordCheck(id, dto);
  }

  @Post(':id/dossier/decision')
  @ApiOperation({ summary: 'Απόφαση: έγκριση, απόρριψη, αίτημα συμπληρωματικών, ανάκληση' })
  decide(
    @CurrentUser() admin: Admin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideVerificationDto,
  ) {
    return this.verification.decide(admin.id, admin.email, id, dto);
  }

  @Get('documents/:documentId/url')
  @ApiOperation({ summary: 'Υπογεγραμμένο URL εγγράφου (5 λεπτά) — η προβολή καταγράφεται' })
  async signDocument(
    @CurrentUser() admin: Admin,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: { ip?: string; headers?: Record<string, string> },
  ) {
    const signed = await this.verification.signDocument(documentId);
    await this.verification.recordDocumentAccess(
      admin,
      documentId,
      req.ip,
      req.headers?.['user-agent'],
    );
    return signed;
  }
}
