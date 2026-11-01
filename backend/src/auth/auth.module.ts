import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { JwtGuard } from './jwt.guard';
import { MeStatsService } from './me-stats.service';

@Global()
@Module({
  imports: [JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: process.env.JWT_SECRET || 'dev-secret', signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '30d') as any } }) })],
  controllers: [AuthController, MeController],
  providers: [JwtGuard, MeStatsService],
  exports: [JwtGuard],
})
export class AuthModule {}
