import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Verification')
@ApiBearerAuth()
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('me')
  @ApiOperation({ summary: 'Τρέχουσα αίτηση επαλήθευσης του γιατρού' })
  getMine(@CurrentUser() user: { id: string }) {
    return this.verification.getMyDossier(user.id);
  }

  @Post('me/documents')
  @ApiOperation({ summary: 'Ανέβασμα δικαιολογητικού (base64) σε ιδιωτική αποθήκευση' })
  upload(@CurrentUser() user: { id: string }, @Body() dto: UploadDocumentDto) {
    return this.verification.uploadDocument(user.id, dto);
  }

  @Delete('me/documents/:id')
  @ApiOperation({ summary: 'Διαγραφή δικαιολογητικού πριν την υποβολή' })
  remove(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.deleteDocument(user.id, id);
  }

  @Get('me/documents/:id/url')
  @ApiOperation({ summary: 'Προσωρινό υπογεγραμμένο URL για προεπισκόπηση (5 λεπτά)' })
  signMine(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.signDocument(id, user.id);
  }

  @Post('me/submit')
  @ApiOperation({ summary: 'Υποβολή αίτησης για έλεγχο' })
  submit(@CurrentUser() user: { id: string }) {
    return this.verification.submit(user.id);
  }
}
