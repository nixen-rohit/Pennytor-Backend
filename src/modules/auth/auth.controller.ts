import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/api',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new Pennytor account' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('check-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check whether an email is already registered',
    description: 'Returns { available: boolean }. Used by the register form to show email availability in real time.',
  })
  @ApiResponse({ status: 200, description: 'Email availability result' })
  checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log into an existing account' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials / Unverified email / Locked',
  })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ctx = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.login(dto, ctx);
    const { refreshToken, ...rest } = result.data;

    // Set the refresh token as an HttpOnly cookie — never in a JSON body
    const response = req.res!;
    response.cookie(REFRESH_COOKIE, refreshToken, REFRESH_OPTIONS);

    return { message: result.message, data: rest };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a newly created account via emailed OTP' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.authService.verifyEmail(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Refresh access token using the HttpOnly refresh token cookie',
    description:
      'The refresh token is read from the "refresh_token" HttpOnly cookie, never from the request body.',
  })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, description: 'Tokens refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() _dto: RefreshDto, @Req() req: Request) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      return { statusCode: 401, message: 'Refresh token not provided' };
    }

    const ctx = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const { accessToken, refreshToken } = await this.authService.refresh(
      rawToken,
      ctx,
    );

    const response = req.res!;
    response.cookie(REFRESH_COOKIE, refreshToken, REFRESH_OPTIONS);

    return { data: { accessToken } };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out the current session (or all sessions)',
    description:
      'Requires a valid access token in the Authorization header. ' +
      'Set body.all = true to revoke every session for this user.',
  })
  @ApiBody({ type: LogoutDto })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(@Body() dto: LogoutDto, @Req() req: Request) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    const user = req.user as { id: string };

    const ctx = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authService.logout(
      rawToken,
      dto.all === true,
      user.id,
      ctx,
    );

    const response = req.res!;
    response.clearCookie(REFRESH_COOKIE, { path: '/api' });

    return result;
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend email verification OTP' })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({ status: 200, description: 'OTP resent or silently ignored' })
  resendOtp(@Body() dto: ResendOtpDto, @Req() req: Request) {
    return this.authService.resendOtp(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Generic success message' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired reset link' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password for the authenticated user',
    description:
      'Requires a valid access token. Revokes all other sessions on success.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = req.user as { id: string };
    return this.authService.changePassword(user.id, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
