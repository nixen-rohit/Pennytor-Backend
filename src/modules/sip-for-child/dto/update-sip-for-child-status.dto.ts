import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';

export class UpdateSIPForChildStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
