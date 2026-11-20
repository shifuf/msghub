import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class PairDeviceDto {
  @IsString() @Matches(/^[a-f0-9]{16}$/i) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(512) registrationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) appKey!: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(64) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(100) osVersion?: string;
  @IsOptional() @IsBoolean() notificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() channelEnabled?: boolean;
  @IsOptional() @IsBoolean() connected?: boolean;
}

export class DeviceHeartbeatDto {
  @IsString() @IsNotEmpty() @MaxLength(512) registrationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) appKey!: string;
  @IsOptional() @IsString() @MaxLength(64) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(100) osVersion?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() notificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() channelEnabled?: boolean;
  @IsOptional() @IsBoolean() connected?: boolean;
}

export class DeviceReceiptDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) receivedToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(512) registrationId!: string;
  @IsBoolean() displayed!: boolean;
}

export class CreateDevicePairingCodeDto {
  @IsString() @IsNotEmpty() @MaxLength(128) channelId!: string;
}
