import { DepositStatus, Prisma } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export type FinanceType = 'DEPOSIT' | 'WITHDRAWAL';
export type FinanceSortBy = 'createdAt' | 'submittedAt' | 'amount';
export type FinanceSortOrder = 'asc' | 'desc';

/**
 * Server-side query for the merged finance feed. DepositStatus and
 * WithdrawalStatus share the same four values, so one enum validates both.
 */
export class ListFinanceQueryDto {
  @IsOptional()
  @IsEnum(['DEPOSIT', 'WITHDRAWAL'])
  type?: FinanceType;

  @IsOptional()
  @IsEnum(DepositStatus)
  status?: DepositStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'submittedAt', 'amount'])
  sortBy?: FinanceSortBy = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: FinanceSortOrder = 'desc';
}

/**
 * Order keys as a Prisma orderBy array (one field per entry — this client
 * rejects multi-field orderBy objects; id breaks ties).
 */
export function toOrderBy(
  sortBy: FinanceSortBy,
  sortOrder: FinanceSortOrder,
): Prisma.DepositRequestOrderByWithRelationInput[] {
  return [{ [sortBy]: sortOrder }, { id: sortOrder }];
}