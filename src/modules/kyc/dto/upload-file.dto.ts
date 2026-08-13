import { KycFileType } from '@prisma/client';
import { IsEnum } from 'class-validator';

/** The multipart field carrying which document slot this upload fills. */
export class UploadFileDto {
  @IsEnum(KycFileType)
  fileType: KycFileType;
}
