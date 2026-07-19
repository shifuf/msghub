import { IsObject } from 'class-validator';

export class ImportBackupDto {
  @IsObject()
  data: Record<string, unknown>;
}
