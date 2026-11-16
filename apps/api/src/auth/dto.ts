import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;
}

export class ChangePasswordDto {
  @IsString()
  oldPassword: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  newPassword: string;
}

export class TotpSetupDto {
  @IsString()
  password: string;
}

export class TotpCodeDto {
  @Matches(/^\d{6}$/)
  code: string;
}

export class TotpDisableDto extends TotpCodeDto {
  @IsString()
  password: string;
}
