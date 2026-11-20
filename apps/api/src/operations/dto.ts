import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class BackupConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) intervalHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) retentionCount?: number;
  @IsOptional() @IsBoolean() verifyAfterBackup?: boolean;
}

export class VerifyBackupDto {
  @IsUUID('4') backupId: string;
}
