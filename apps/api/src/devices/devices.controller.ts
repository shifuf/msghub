import { Body, Controller, Delete, Get, Headers, Header, Param, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';
import { CreateDevicePairingCodeDto, DeviceHeartbeatDto, DeviceReceiptDto, PairDeviceDto } from './device.dto';
import { DevicesService } from './devices.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/devices')
export class AdminDevicesController {
  constructor(private devices: DevicesService) {}
  @Get() @Header('Cache-Control', 'no-store') async list() { return ok(await this.devices.list()); }
  @Post('pair-codes') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 8, ttl: 60000 } })
  async issuePairCode(@Body() dto: CreateDevicePairingCodeDto, @Request() req: any) { return ok(await this.devices.issuePairingCode(dto.channelId, req.user.id)); }
  @Delete(':id') async revoke(@Param('id') id: string, @Request() req: any) { return ok(await this.devices.revoke(id, req.user.id)); }
}

@Controller('device')
export class PublicDevicesController {
  constructor(private devices: DevicesService) {}
  @Post('pair') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 8, ttl: 60000 } })
  async pair(@Body() dto: PairDeviceDto) { return ok(await this.devices.pair(dto)); }
  @Post('heartbeat') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async heartbeat(@Headers('authorization') authorization: string | undefined, @Body() dto: DeviceHeartbeatDto) { return ok(await this.devices.heartbeat(authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined, dto)); }
  @Post('receipts') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async receipt(@Headers('authorization') authorization: string | undefined, @Body() dto: DeviceReceiptDto) { return ok(await this.devices.receipt(dto, authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined)); }
}
