import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a new Pennytor account',
    description:
      'Register a new user account. A verification email with an OTP will be sent. ' +
      'Rate limit: 5 requests per 60 seconds.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'Account created successfully. Verification email sent.',
    schema: {
      example: {
        message: 'If this email is available, you will receive a confirmation shortly.',
        userId: 'clx1234567890abcdef',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email already registered',
    schema: {
      example: {
        statusCode: 409,
        path: '/api/auth/register',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: 'If this email is available, you will receive a confirmation shortly.',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many registration attempts',
  })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log into an existing account',
    description: 'Authenticate with email and password to receive an access token.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid email or password / Unverified email / Locked account',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many login attempts',
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a newly created account via emailed OTP',
    description:
      'Confirm the email address by submitting the 6-digit OTP. ' +
      'Rate limit: 10 requests per 60 seconds.',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
    schema: {
      example: {
        message: 'Email verified successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid, expired, or exhausted OTP',
    schema: {
      example: {
        statusCode: 400,
        path: '/api/auth/verify-email',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: 'Incorrect verification code',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many verification attempts',
  })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.authService.verifyEmail(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Resend email verification OTP',
    description:
      'Request a new OTP to be sent to the email address. ' +
      'Returns 200 even if the email is not found (enumeration-safe). ' +
      'Rate limit: 3 requests per 60 seconds.',
  })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP resent (or silently ignored if email not found)',
    schema: {
      example: {
        message: 'If this email is registered, a new code has been sent.',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many resend requests',
  })
  resendOtp(@Body() dto: ResendOtpDto, @Req() req: Request) {
    return this.authService.resendOtp(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Send a password reset email if the address is registered and active. ' +
      'Always returns the same generic response (enumeration-safe). ' +
      'Rate limit: 3 requests per 60 seconds.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description:
      'Generic success message (does not reveal whether the email exists)',
    schema: {
      example: {
        message:
          "If this email is registered, you'll receive a reset link shortly.",
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many forgot-password requests',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set a new password using a reset token',
    description:
      'Submit the token from the reset email along with the new password. ' +
      'All failures return the same generic error (enumeration-safe). ' +
      'Rate limit: 5 requests per 60 seconds.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful',
    schema: {
      example: {
        message: 'Password reset successful. You can now log in.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired reset link',
    schema: {
      example: {
        statusCode: 400,
        path: '/api/auth/reset-password',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: 'Invalid or expired reset link',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many reset-password attempts',
  })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
