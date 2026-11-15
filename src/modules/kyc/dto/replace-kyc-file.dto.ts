import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reason for replacing a KYC document, required so the audit trail records
 * WHY verified evidence was swapped (support ticket, blurry upload, …).
 */
export class ReplaceKycFileDto {
    @IsString()
  @IsNotEmpty({ message: 'A reason is required to replace a document' })
  @MinLength(3, { message: 'Reason must be at least 3 characters' })
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  reason!: string;
}
