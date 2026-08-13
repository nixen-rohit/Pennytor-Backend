import { KycApplicationStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Admin decisions a review can take. */
const ALLOWED_STATUSES: KycApplicationStatus[] = [
  KycApplicationStatus.VERIFIED,
  KycApplicationStatus.REJECTED,
  KycApplicationStatus.UNDER_REVIEW,
];

export class UpdateKycStatusDto {
  @IsEnum(KycApplicationStatus)
  @IsIn(ALLOWED_STATUSES)
  status: KycApplicationStatus;

  /**
   * Required when rejecting: the reason is stored on the application and
   * emailed to the user so they know what to fix before resubmitting.
   */
  @ValidateIf((o) => o.status === KycApplicationStatus.REJECTED)
  @IsNotEmpty({ message: 'A rejection reason is required' })
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  note?: string;
}
